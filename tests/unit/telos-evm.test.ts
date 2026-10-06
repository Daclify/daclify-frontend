import { describe, expect, it } from 'vitest';
import { messageHex, readEvmProvider, TELOS_EVM } from '../../src/auth/telos-evm';

describe('Telos EVM wallet helper', () => {
  it('encodes a personal_sign message and recognises a provider', () => {
    expect(messageHex('A')).toBe('0x41');
    expect(TELOS_EVM[40].hex).toBe('0x28');
    expect(TELOS_EVM[41].hex).toBe('0x29');
    expect(readEvmProvider({})).toBeUndefined();
    const provider = readEvmProvider({
      request: (args: { method: string }) => args.method,
    });
    expect(provider).toBeDefined();
  });
});
