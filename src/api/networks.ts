export type DeployedNetwork = 'production' | 'testnet';
import {
  DirectoryEntrySchema,
  daoPaymentKey,
  type DaoRef,
  type DirectoryEntry,
} from '@daclify/core-protocol';
let operator: DirectoryEntry | null = null;
export function currentOperator(): DirectoryEntry | null {
  return operator;
}
export function approveOperator(entry: DirectoryEntry): void {
  const value = DirectoryEntrySchema.parse(entry);
  if (value.portal.mode !== 'daclify') throw new Error('OPERATOR_INCOMPATIBLE');
  operator = value;
  sessionStorage.setItem(
    'daclify.operator',
    JSON.stringify({ entry: value, network: selectedNetwork(), expires: Date.now() + 3600000 }),
  );
}
export function assertOperatorDao(dao: DaoRef): void {
  if (operator && daoPaymentKey(operator.reference) !== daoPaymentKey(dao))
    throw new Error('OPERATOR_DAO');
}
export function closeOperator(): void {
  operator = null;
  sessionStorage.removeItem('daclify.operator');
}
let rejectedOperator = false;
export function operatorContextRejected(): boolean {
  return rejectedOperator;
}
async function restoreOperator(): Promise<void> {
  const raw = sessionStorage.getItem('daclify.operator');
  if (!raw) return;
  rejectedOperator = false;
  try {
    const record: unknown = JSON.parse(raw);
    if (
      typeof record !== 'object' ||
      record === null ||
      !('entry' in record) ||
      !('expires' in record) ||
      typeof record.expires !== 'number' ||
      record.expires <= Date.now() ||
      !('network' in record) ||
      record.network !== selectedNetwork()
    )
      throw new Error('OPERATOR_INCOMPATIBLE');
    const saved = DirectoryEntrySchema.parse(record.entry);
    if (saved.portal.mode !== 'daclify') throw new Error('OPERATOR_INCOMPATIBLE');
    const { verifyRegisteredOperator } = await import('./operators');
    operator = await verifyRegisteredOperator(saved);
  } catch {
    closeOperator();
    rejectedOperator = true;
  }
}

export interface DeployedEndpoints {
  production: string;
  testnet: string;
}

let endpoints: DeployedEndpoints | null = null;
let developmentOrigin: string | null = null;

export function configureNetworks(value: DeployedEndpoints | null): void {
  endpoints = value;
  developmentOrigin = null;
  operator = null;
  rejectedOperator = false;
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
  closeOperator();
}

export function csrfStorageKey(): string {
  if (operator?.portal.mode === 'daclify')
    return 'daclify.csrf.operator.' + new URL(operator.portal.apiOrigin).origin;
  if (developmentOrigin) return `daclify.csrf.dev.${developmentOrigin}`;
  const selected = selectedNetwork();
  return selected ? `daclify.csrf.${selected}` : 'daclify.csrf';
}

export function resolveApiUrl(path: string): string {
  if (operator?.portal.mode === 'daclify') return new URL(operator.portal.apiOrigin).origin + path;
  return resolveCentralApiUrl(path);
}
export function resolveCentralApiUrl(path: string): string {
  const selected = selectedNetwork();
  if (!selected || !endpoints) return `${developmentOrigin ?? ''}${path}`;
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
  const development = import.meta.env.DEV ? viteValue('VITE_API_ORIGIN') : undefined;
  if (development) {
    const origin = publicHttpsOrigin(development);
    configureNetworks(null);
    developmentOrigin = origin;
    await restoreOperator();
    return;
  }
  const deployed = viteNetworks();
  if (deployed) {
    configureNetworks(deployed);
    await restoreOperator();
    return;
  }
  const response = await fetch('/networks.json', { cache: 'no-store' });
  if (response.status === 404) {
    configureNetworks(null);
    await restoreOperator();
    return;
  }
  if (!response.ok) throw new Error('NETWORKS_INVALID');
  configureNetworks(parseNetworkFile(await response.json()));
  await restoreOperator();
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
