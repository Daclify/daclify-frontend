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
}

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
  return {
    request: (args) => Promise.resolve(Reflect.apply(request, value, [args])),
  };
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
