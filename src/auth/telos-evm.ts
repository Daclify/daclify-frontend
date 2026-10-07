import { shallowRef } from 'vue';
import { EvmAddressSchema } from '@daclify/core-protocol';
import {
  canonicalEvmSignature,
  bindingTypedData,
  governanceTypedData,
} from '@daclify/core-protocol/sdk';
import type { DaoRef } from '@daclify/core-protocol';
import type { instruction, EvmBinding } from '@daclify/core-protocol/sdk';
import { useWorkspace } from '../state/workspace';

export const TELOS_EVM = {
  40: {
    chainId: 40,
    hex: '0x28',
    name: 'Telos EVM',
    rpc: 'https://mainnet.telos.net/evm',
    explorer: 'https://www.teloscan.io',
  },
  41: {
    chainId: 41,
    hex: '0x29',
    name: 'Telos EVM Testnet',
    rpc: 'https://testnet.telos.net/evm',
    explorer: 'https://testnet.teloscan.io',
  },
} as const;
export type TelosEvmChainId = keyof typeof TELOS_EVM;

export interface EvmProvider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?: (event: 'accountsChanged' | 'chainChanged', listener: () => void) => void;
  removeListener?: (event: 'accountsChanged' | 'chainChanged', listener: () => void) => void;
}
export const evmWallet = shallowRef<{
  provider: EvmProvider;
  chainId: TelosEvmChainId;
  address: string;
}>();
let dispose = () => {};

export function messageHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  let hex = '0x';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function readEvmProvider(value: unknown): EvmProvider | undefined {
  if (typeof value !== 'object' || value === null || !('request' in value)) return undefined;
  const request = value.request;
  if (typeof request !== 'function') return undefined;
  const on = 'on' in value ? value.on : undefined;
  const removeListener = 'removeListener' in value ? value.removeListener : undefined;
  return {
    request: (args) => Promise.resolve(Reflect.apply(request, value, [args])),
    ...(typeof on === 'function'
      ? {
          on: (event: 'accountsChanged' | 'chainChanged', listener: () => void) => {
            Reflect.apply(on, value, [event, listener]);
          },
        }
      : {}),
    ...(typeof removeListener === 'function'
      ? {
          removeListener: (event: 'accountsChanged' | 'chainChanged', listener: () => void) => {
            Reflect.apply(removeListener, value, [event, listener]);
          },
        }
      : {}),
  };
}
export async function connectEvm(chainId: TelosEvmChainId) {
  const provider = browserEvmProvider();
  if (!provider) throw new Error('EVM_WALLET_MISSING');
  const network = TELOS_EVM[chainId];
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: network.hex }],
    });
  } catch (cause) {
    if (providerCode(cause) !== 4902) throw cause;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: network.hex,
          chainName: network.name,
          nativeCurrency: { name: 'Telos', symbol: 'TLOS', decimals: 18 },
          rpcUrls: [network.rpc],
          blockExplorerUrls: [network.explorer],
        },
      ],
    });
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' }),
    address = EvmAddressSchema.parse(Array.isArray(accounts) ? accounts[0] : undefined);
  if ((await provider.request({ method: 'eth_chainId' })) !== network.hex)
    throw new Error('WALLET_CONTEXT_CHANGED');
  dispose();
  const changed = () => {
    evmWallet.value = undefined;
  };
  provider.on?.('accountsChanged', changed);
  provider.on?.('chainChanged', changed);
  dispose = () => {
    provider.removeListener?.('accountsChanged', changed);
    provider.removeListener?.('chainChanged', changed);
  };
  const wallet = { provider, chainId, address };
  evmWallet.value = wallet;
  return wallet;
}
export async function checkEvmContext(wallet: NonNullable<typeof evmWallet.value>): Promise<void> {
  const [accounts, chain] = await Promise.all([
    wallet.provider.request({ method: 'eth_accounts' }),
    wallet.provider.request({ method: 'eth_chainId' }),
  ]);
  if (
    wallet !== evmWallet.value ||
    chain !== TELOS_EVM[wallet.chainId].hex ||
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    accounts[0].toLowerCase() !== wallet.address.toLowerCase()
  )
    throw new Error('WALLET_CONTEXT_CHANGED');
}
async function signWallet(
  method: 'personal_sign' | 'eth_signTypedData_v4',
  message: string,
): Promise<string> {
  const wallet = evmWallet.value;
  if (!wallet) throw new Error('EVM_WALLET_MISSING');
  const state = useWorkspace(),
    accountId = state.account?.id,
    network = JSON.stringify([state.network?.chainId, state.network?.runtime]),
    location = globalThis.location?.href;
  await checkEvmContext(wallet);
  const result = await wallet.provider.request({
    method,
    params:
      method === 'personal_sign'
        ? [messageHex(message), wallet.address]
        : [wallet.address, message],
  });
  await checkEvmContext(wallet);
  if (
    network !== JSON.stringify([state.network?.chainId, state.network?.runtime]) ||
    location !== globalThis.location?.href ||
    accountId !== state.account?.id
  )
    throw new Error('WALLET_CONTEXT_CHANGED');
  if (typeof result !== 'string') throw new Error('EVM_SIGNATURE_INVALID');
  return canonicalEvmSignature(result);
}
export function signEvmMessage(message: string) {
  return signWallet('personal_sign', message);
}
export function signEvmGovernance(request: instruction, binding: EvmBinding) {
  return signWallet('eth_signTypedData_v4', JSON.stringify(governanceTypedData(request, binding)));
}
export function signEvmBinding(
  native: DaoRef,
  member: string,
  binding: EvmBinding,
  nonce: string,
  expires: number,
) {
  return signWallet(
    'eth_signTypedData_v4',
    JSON.stringify(bindingTypedData(native, member, binding, nonce, expires)),
  );
}

export function browserEvmProvider(): EvmProvider | undefined {
  const host: unknown = window;
  if (typeof host !== 'object' || host === null || !('ethereum' in host)) return undefined;
  return readEvmProvider(host.ethereum);
}

export function providerCode(cause: unknown): number | undefined {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'number'
  ) {
    return cause.code;
  }
  return undefined;
}
