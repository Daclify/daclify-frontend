import { NetworkSchema } from '@daclify/core-protocol';
import { useWorkspace } from '../../src/state/workspace';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  evmWallet,
  signEvmGovernance,
  signEvmMessage,
  type EvmProvider,
} from '../../src/auth/telos-evm';
import {
  dispatchInstruction,
  selectedSigner,
  refreshEvmAuthorization,
  canSignMember,
} from '../../src/auth/action-signer';
import { api, friendlyError } from '../../src/api/client';
import { makeInstruction, encodeAction, governanceTypedData } from '@daclify/core-protocol/sdk';
import { UserMembershipSchema } from '@daclify/core-protocol';
const address = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
  signature = '0x' + '11'.repeat(32) + '22'.repeat(32) + '1b';
const dao = {
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '1',
  interfaceVersion: 1 as const,
};
const request = makeInstruction(
  dao,
  '1',
  '0',
  100,
  'daclifycore',
  'unlinkevm',
  encodeAction('unlinkevm', { runtime: 'daclifycore', dao_id: '1', member_id: '1' }),
);
let currentAddress = address,
  chain = '0x29',
  complete: (value: unknown) => void;
let calls: { method: string; params?: readonly unknown[] }[];
const provider: EvmProvider = {
  request: async (args) => {
    calls.push(args);
    if (args.method === 'eth_accounts') return [currentAddress];
    if (args.method === 'eth_chainId') return chain;
    return new Promise((resolve) => {
      complete = resolve;
    });
  },
};
beforeEach(() => {
  setActivePinia(createPinia());
  calls = [];
  currentAddress = address;
  chain = '0x29';
  vi.stubGlobal('location', { href: 'https://app.example.test/dao/1/decide' });
  evmWallet.value = { provider, chainId: 41, address };
  selectedSigner.value = 'evm';
});
afterEach(() => {
  evmWallet.value = undefined;
  selectedSigner.value = 'vault';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function pending() {
  for (
    let i = 0;
    i < 10 && !calls.some((c) => c.method.endsWith('sign') || c.method === 'eth_signTypedData_v4');
    i++
  )
    await Promise.resolve();
  expect(
    calls.some((c) => c.method === 'personal_sign' || c.method === 'eth_signTypedData_v4'),
  ).toBe(true);
}
it('asks for the exact independently tested typed governance fields and uses a separate personal-sign format', async () => {
  const operation = signEvmGovernance(request, { chainId: 41, address, epoch: '1' });
  await pending();
  const typed = calls.find((c) => c.method === 'eth_signTypedData_v4');
  expect(typed?.params).toEqual([
    address,
    JSON.stringify(governanceTypedData(request, { chainId: 41, address, epoch: '1' })),
  ]);
  complete(signature);
  await expect(operation).resolves.toBe(signature);
  calls = [];
  const login = signEvmMessage('A');
  await pending();
  expect(calls.find((c) => c.method === 'personal_sign')?.params).toEqual(['0x41', address]);
  complete(signature);
  await expect(login).resolves.toBe(signature);
});
it.each(['account', 'chain', 'route', 'disconnect', 'network'] as const)(
  'rejects a %s change while a wallet approval is pending',
  async (change) => {
    const operation = signEvmMessage('reviewed intent');
    await pending();
    if (change === 'account') currentAddress = '0x' + '33'.repeat(20);
    if (change === 'chain') chain = '0x28';
    if (change === 'network')
      useWorkspace().network = NetworkSchema.parse({
        chainId: 'cd'.repeat(32),
        runtime: 'daclifycore',
        rpcUrl: 'https://native.example.test',
        hub: null,
        environment: 'local',
        interfaceVersion: 1,
        coreVersion: '0.5.0-alpha.1',
        capabilities: [],
      });
    if (change === 'route') globalThis.location.href = 'https://app.example.test/dao/2';
    if (change === 'disconnect') evmWallet.value = undefined;
    complete(signature);
    await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  },
);
it('does not relay after the selected wallet changes during a governance prompt', async () => {
  vi.spyOn(api, 'evmBinding').mockResolvedValue({
    binding: {
      member_id: '1',
      chain_id: '41',
      address: address.slice(2),
      epoch: '1',
      active: true,
    },
  });
  const relay = vi.spyOn(api, 'relayEvm');
  const operation = dispatchInstruction(request);
  await pending();
  currentAddress = '0x' + '33'.repeat(20);
  complete(signature);
  await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  expect(relay).not.toHaveBeenCalled();
});
it('preserves explicit wallet cancellation without retrying or relaying', async () => {
  evmWallet.value = {
    provider: {
      request: async ({ method }) => {
        if (method === 'eth_accounts') return [address];
        if (method === 'eth_chainId') return '0x29';
        throw { code: 4001 };
      },
    },
    chainId: 41,
    address,
  };
  await expect(signEvmMessage('login intent')).rejects.toMatchObject({ code: 4001 });
});
it('does not relay a wallet approval after the user switches signing mode', async () => {
  vi.spyOn(api, 'evmBinding').mockResolvedValue({
    binding: {
      member_id: '1',
      chain_id: '41',
      address: address.slice(2),
      epoch: '1',
      active: true,
    },
  });
  const relay = vi.spyOn(api, 'relayEvm');
  const operation = dispatchInstruction(request);
  await pending();
  selectedSigner.value = 'vault';
  complete(signature);
  await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  expect(relay).not.toHaveBeenCalled();
});

it('checks the original app context again after asynchronous binding lookup before asking the wallet', async () => {
  let finish: (value: Awaited<ReturnType<typeof api.evmBinding>>) => void = () => {
    throw new Error('BINDING_NOT_STARTED');
  };
  vi.spyOn(api, 'evmBinding').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const signed = vi.fn(async ({ method }: { method: string }) =>
    method === 'eth_accounts' ? [address] : method === 'eth_chainId' ? '0x29' : signature,
  );
  evmWallet.value = { provider: { request: signed }, chainId: 41, address };
  vi.spyOn(api, 'relayEvm').mockResolvedValue({ transactionId: 'ab'.repeat(32) });
  const operation = dispatchInstruction(request);
  globalThis.location.href = 'https://app.example.test/dao/2';
  finish({
    binding: {
      member_id: '1',
      chain_id: '41',
      address: address.slice(2),
      epoch: '1',
      active: true,
    },
  });
  await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  expect(signed).not.toHaveBeenCalled();
});

it('explains a rejected wallet context without exposing internal error details', () => {
  expect(friendlyError(new Error('WALLET_CONTEXT_CHANGED'))).toContain('Review the current action');
  expect(friendlyError(new Error('private diagnostic'))).not.toContain('private diagnostic');
});

const member = UserMembershipSchema.parse({
  dao,
  memberId: '1',
  nonce: '0',
  active: true,
  admin: false,
  reviewer: false,
  credits: '0',
  claim: '0',
  stake: '0',
  nativeAccount: '',
  custody: 'user-controlled',
});
const activeBinding = {
  binding: { member_id: '1', chain_id: '41', address: address.slice(2), epoch: '1', active: true },
};
it('does not let an older authorization lookup overwrite a newer revocation', async () => {
  let finish: (value: Awaited<ReturnType<typeof api.evmBinding>>) => void = () => {
    throw new Error('NOT_PENDING');
  };
  vi.spyOn(api, 'evmBinding')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ binding: null });
  const older = refreshEvmAuthorization(member);
  await refreshEvmAuthorization(member);
  finish(activeBinding);
  await older;
  expect(canSignMember(member)).toBe(false);
});
it('ignores binding data from the wallet that disconnected during lookup', async () => {
  let finish: (value: Awaited<ReturnType<typeof api.evmBinding>>) => void = () => {
    throw new Error('NOT_PENDING');
  };
  vi.spyOn(api, 'evmBinding').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = refreshEvmAuthorization(member);
  const replacement = { provider, chainId: 41 as const, address };
  evmWallet.value = replacement;
  finish(activeBinding);
  await pending;
  expect(canSignMember(member)).toBe(false);
});
