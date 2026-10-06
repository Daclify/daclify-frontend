import { afterEach, describe, expect, it } from 'vitest';
import {
  chooseNetwork,
  configureNetworks,
  csrfStorageKey,
  parseNetworkFile,
  resolveApiUrl,
  selectedNetwork,
} from '../../src/api/networks';

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const storage = memory();
Object.assign(globalThis, { localStorage: storage, sessionStorage: memory() });

afterEach(() => {
  storage.clear();
  configureNetworks(null);
});

describe('deployed network selection', () => {
  it('keeps local requests on the relative API and the existing csrf key', () => {
    configureNetworks(null);
    expect(selectedNetwork()).toBeNull();
    expect(resolveApiUrl('/v1/network')).toBe('/v1/network');
    expect(csrfStorageKey()).toBe('daclify.csrf');
  });

  it('switches a deployed build between the production and testnet origins', () => {
    configureNetworks(
      parseNetworkFile({
        production: 'https://api.example',
        testnet: 'https://testnet-api.example',
      }),
    );
    expect(selectedNetwork()).toBe('production');
    expect(resolveApiUrl('/v1/network')).toBe('https://api.example/v1/network');
    expect(csrfStorageKey()).toBe('daclify.csrf.production');
    chooseNetwork('testnet');
    expect(resolveApiUrl('/v1/me')).toBe('https://testnet-api.example/v1/me');
    expect(csrfStorageKey()).toBe('daclify.csrf.testnet');
    expect(storage.getItem('daclify.network')).toBe('testnet');
  });

  it('rejects a network file that is not a pair of public https origins', () => {
    expect(parseNetworkFile({ mode: 'local' })).toBeNull();
    expect(() =>
      parseNetworkFile({ production: 'http://api.example', testnet: 'https://test.example' }),
    ).toThrow('NETWORKS_INVALID');
    expect(() =>
      parseNetworkFile({
        production: 'https://user:secret@api.example',
        testnet: 'https://test.example',
      }),
    ).toThrow('NETWORKS_INVALID');
  });
});
