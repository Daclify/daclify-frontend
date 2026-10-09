import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/api/client';
import {
  chooseNetwork,
  configureNetworks,
  csrfStorageKey,
  loadDeployedNetworks,
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  storage.clear();
  configureNetworks(null);
});

describe('deployed network selection', () => {
  it('connects a development build directly to one HTTPS API and isolates its CSRF token', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_API_ORIGIN', 'https://testnet-api.example');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    storage.setItem('daclify.network', 'production');
    await loadDeployedNetworks();
    expect(fetch).not.toHaveBeenCalled();
    expect(selectedNetwork()).toBeNull();
    expect(resolveApiUrl('/v1/me')).toBe('https://testnet-api.example/v1/me');
    expect(csrfStorageKey()).toBe('daclify.csrf.dev.https://testnet-api.example');
    expect(() => chooseNetwork('production')).toThrow('NETWORKS_UNCONFIGURED');
  });

  it('ignores the development API override in a deployed build', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_API_ORIGIN', 'https://unexpected-api.example');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          production: 'https://api.example',
          testnet: 'https://testnet-api.example',
        }),
      ),
    );
    await loadDeployedNetworks();
    expect(resolveApiUrl('/v1/me')).toBe('https://api.example/v1/me');
  });

  it('uses deployment env settings before the network file and retains network switching', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_API_PRODUCTION', 'https://api.example');
    vi.stubEnv('VITE_API_TESTNET', 'https://testnet-api.example');
    const fetch = vi.fn().mockResolvedValue(Response.json({ mode: 'local' }));
    vi.stubGlobal('fetch', fetch);

    await loadDeployedNetworks();

    expect(fetch).not.toHaveBeenCalled();
    expect(resolveApiUrl('/v1/me')).toBe('https://api.example/v1/me');
    expect(csrfStorageKey()).toBe('daclify.csrf.production');
    chooseNetwork('testnet');
    expect(resolveApiUrl('/v1/me')).toBe('https://testnet-api.example/v1/me');
    expect(csrfStorageKey()).toBe('daclify.csrf.testnet');
  });

  it('keeps the direct development API override ahead of deployment env settings', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_API_ORIGIN', 'https://developer-api.example');
    vi.stubEnv('VITE_API_PRODUCTION', 'https://api.example');
    vi.stubEnv('VITE_API_TESTNET', 'https://testnet-api.example');
    vi.stubGlobal('fetch', vi.fn());

    await loadDeployedNetworks();

    expect(resolveApiUrl('/v1/me')).toBe('https://developer-api.example/v1/me');
    expect(selectedNetwork()).toBeNull();
    expect(csrfStorageKey()).toBe('daclify.csrf.dev.https://developer-api.example');
  });

  it.each([
    { production: 'https://api.example', testnet: undefined },
    { production: undefined, testnet: 'https://testnet-api.example' },
    { production: 'http://api.example', testnet: 'https://testnet-api.example' },
    { production: 'https://api.example/v1', testnet: 'https://testnet-api.example' },
    { production: 'https://user:secret@api.example', testnet: 'https://testnet-api.example' },
    { production: 'https://api.example', testnet: 'https://testnet-api.example?query=1' },
    { production: 'https://api.example', testnet: 'https://testnet-api.example#fragment' },
  ])(
    'rejects incomplete or invalid deployment env settings: %j',
    async ({ production, testnet }) => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('VITE_API_PRODUCTION', production);
      vi.stubEnv('VITE_API_TESTNET', testnet);
      const fetch = vi.fn().mockResolvedValue(Response.json({ mode: 'local' }));
      vi.stubGlobal('fetch', fetch);

      await expect(loadDeployedNetworks()).rejects.toThrow('NETWORKS_INVALID');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('retains local proxy mode when deployment env settings are absent', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_API_PRODUCTION', undefined);
    vi.stubEnv('VITE_API_TESTNET', undefined);
    const fetch = vi.fn().mockResolvedValue(Response.json({ mode: 'local' }));
    vi.stubGlobal('fetch', fetch);

    await loadDeployedNetworks();

    expect(fetch).toHaveBeenCalledWith('/networks.json', { cache: 'no-store' });
    expect(resolveApiUrl('/v1/me')).toBe('/v1/me');
    expect(selectedNetwork()).toBeNull();
  });

  it.each([
    'http://api.example',
    'https://api.example/v1',
    'https://user:secret@api.example',
    'https://api.example?query=1',
  ])('rejects an invalid development API origin: %s', async (origin) => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_API_ORIGIN', origin);
    vi.stubGlobal('fetch', vi.fn());
    await expect(loadDeployedNetworks()).rejects.toThrow('NETWORKS_INVALID');
  });
  it('does not accept a response after the selected API changes while the request is pending', async () => {
    configureNetworks({
      production: 'https://api.example',
      testnet: 'https://testnet-api.example',
    });
    let finish: (response: Response) => void = () => {
      throw new Error('NOT_PENDING');
    };
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = api.signInOptions();
    chooseNetwork('testnet');
    finish(
      Response.json({
        telegram: { configured: false, username: null, oidc: false, miniApp: false },
        email: { delivery: 'unavailable' },
        passkey: { rpId: 'app.example' },
      }),
    );
    await expect(pending).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  });
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
