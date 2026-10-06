export type DeployedNetwork = 'production' | 'testnet';

export interface DeployedEndpoints {
  production: string;
  testnet: string;
}

let endpoints: DeployedEndpoints | null = null;

export function configureNetworks(value: DeployedEndpoints | null): void {
  endpoints = value;
}

export function selectedNetwork(): DeployedNetwork | null {
  if (!endpoints) return null;
  const stored = globalThis.localStorage.getItem('daclify.network');
  if (stored === 'testnet' || stored === 'production') return stored;
  return 'production';
}

export function chooseNetwork(name: DeployedNetwork): void {
  if (!endpoints) throw new Error('NETWORKS_UNCONFIGURED');
  globalThis.localStorage.setItem('daclify.network', name);
}

export function csrfStorageKey(): string {
  const selected = selectedNetwork();
  return selected ? `daclify.csrf.${selected}` : 'daclify.csrf';
}

export function resolveApiUrl(path: string): string {
  const selected = selectedNetwork();
  if (!selected || !endpoints) return path;
  return `${endpoints[selected]}${path}`;
}

export function parseNetworkFile(value: unknown): DeployedEndpoints | null {
  if (typeof value !== 'object' || value === null) throw new Error('NETWORKS_INVALID');
  if ('mode' in value && value.mode === 'local' && Object.keys(value).length === 1) return null;
  if (!('production' in value) || !('testnet' in value) || Object.keys(value).length !== 2) {
    throw new Error('NETWORKS_INVALID');
  }
  return {
    production: publicHttpsOrigin(value.production),
    testnet: publicHttpsOrigin(value.testnet),
  };
}

export async function loadDeployedNetworks(): Promise<void> {
  const response = await fetch('/networks.json', { cache: 'no-store' });
  if (response.status === 404) {
    configureNetworks(viteNetworks());
    return;
  }
  if (!response.ok) throw new Error('NETWORKS_INVALID');
  configureNetworks(parseNetworkFile(await response.json()));
}

function viteNetworks(): DeployedEndpoints | null {
  const production = viteValue('VITE_API_PRODUCTION');
  const testnet = viteValue('VITE_API_TESTNET');
  if (!production && !testnet) return null;
  return parseNetworkFile({ production, testnet });
}

function viteValue(name: string): string | undefined {
  const env: unknown = import.meta.env;
  if (typeof env !== 'object' || env === null) return undefined;
  const value = Object.fromEntries(Object.entries(env))[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function publicHttpsOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new Error('NETWORKS_INVALID');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('NETWORKS_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('NETWORKS_INVALID');
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('NETWORKS_INVALID');
  }
  return url.origin;
}
