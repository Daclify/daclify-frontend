import { afterEach, expect, it, vi } from 'vitest';
import {
  DaoSummarySchema,
  DirectoryEntrySchema,
  NetworkSchema,
  VERSION,
} from '@daclify/core-protocol';
import { RuntimeCodeHash, RuntimeRawAbiHash } from '@daclify/core-protocol/sdk';
import { connectOperator } from '../../src/api/operators';
import {
  configureNetworks,
  approveOperator,
  assertOperatorDao,
  currentOperator,
  closeOperator,
  loadDeployedNetworks,
  operatorContextRejected,
} from '../../src/api/networks';
const entry = DirectoryEntrySchema.parse({
  reference: { chainId: 'ab'.repeat(32), contract: 'daoone', daoId: '1', interfaceVersion: 1 },
  title: 'Independent',
  description: '',
  purpose: 'community',
  privacy: 'public',
  operator: 'Own server',
  codeHash: RuntimeCodeHash,
  abiHash: RuntimeRawAbiHash,
  portal: { mode: 'daclify', apiOrigin: 'https://operator.example' },
  source: 'hub-registry',
  verification: 'owner-registered',
});
const source = NetworkSchema.parse({
  chainId: entry.reference.chainId,
  rpcUrl: 'https://rpc.example',
  runtime: 'daclifycore',
  hub: 'daclifyhub',
  environment: 'testnet',
  interfaceVersion: 1,
  coreVersion: VERSION,
  capabilities: [],
});
const values = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
});
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
afterEach(() => {
  values.clear();
  closeOperator();
  configureNetworks(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('refuses wrong code before requesting an independent API', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  await expect(connectOperator({ ...entry, codeHash: 'cd'.repeat(32) })).rejects.toThrow(
    'OPERATOR_INCOMPATIBLE',
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(currentOperator()).toBeNull();
});
it('drops a removed registration on reload without sending credentials to the old endpoint', async () => {
  values.set(
    'daclify.operator',
    JSON.stringify({ entry, network: null, expires: Date.now() + 3600000 }),
  );
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_API_ORIGIN', 'https://central.example');
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) =>
      Response.json(
        String(input).endsWith('/network') ? source : { entries: [], skipped: 0, next: null },
      ),
    );
  await loadDeployedNetworks();
  expect(currentOperator()).toBeNull();
  expect(operatorContextRejected()).toBe(true);
  expect(values.has('daclify.operator')).toBe(false);
  expect(
    fetch.mock.calls.every(
      ([url, options]) =>
        String(url).startsWith('https://central.example') && options?.credentials === 'omit',
    ),
  ).toBe(true);
});

it('does not restore an operator from a central service outside the deployment network', async () => {
  values.set(
    'daclify.operator',
    JSON.stringify({ entry, network: 'testnet', expires: Date.now() + 3600000 }),
  );
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_NETWORK', 'testnet');
  vi.stubEnv('VITE_API_TESTNET', 'https://central.example');
  vi.stubEnv('VITE_API_PRODUCTION', 'https://mainnet.example');
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ ...source, environment: 'mainnet' }));

  await loadDeployedNetworks();

  expect(currentOperator()).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    'https://central.example/v1/network',
    expect.objectContaining({ credentials: 'omit' }),
  );
});

it('requires explicit Hub selection before another DAO can be signed or read', () => {
  approveOperator(entry);
  expect(() => assertOperatorDao(entry.reference)).not.toThrow();
  expect(() => assertOperatorDao({ ...entry.reference, daoId: '2' })).toThrow('OPERATOR_DAO');
  expect(() => assertOperatorDao({ ...entry.reference, contract: 'daclifycore' })).toThrow(
    'OPERATOR_DAO',
  );
});

it('checks paged central registration and trusted chain pins before selecting an operator', async () => {
  configureNetworks({ production: 'https://central.example', testnet: 'https://testnet.example' });
  const dao = DaoSummarySchema.parse({
    reference: entry.reference,
    title: 'Independent',
    description: '',
    purpose: 'community',
    privacy: 'public',
    owner: 'alice',
    token: {
      chainId: entry.reference.chainId,
      contract: 'eosio.token',
      symbol: 'TLOS',
      precision: 4,
    },
    members: 1,
    available: '0',
    reserved: '0',
    claims: '0',
    keyEpoch: '0',
  });
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = String(input);
    expect(options?.credentials).toBe('omit');
    if (url === 'https://central.example/v1/network') return Response.json(source);
    if (url === 'https://central.example/v1/hub/directory')
      return Response.json({ entries: [], skipped: 0, next: '1' });
    if (url === 'https://central.example/v1/hub/directory?after=1')
      return Response.json({ entries: [entry], skipped: 0, next: null });
    if (url === 'https://operator.example/v1/network')
      return Response.json({ ...source, runtime: entry.reference.contract });
    if (url === 'https://rpc.example/v1/chain/get_info')
      return Response.json({ chain_id: source.chainId });
    if (url === 'https://rpc.example/v1/chain/get_raw_abi')
      return Response.json({ code_hash: RuntimeCodeHash, abi_hash: RuntimeRawAbiHash });
    if (url === 'https://operator.example/v1/daos/1') return Response.json(dao);
    throw new Error('Unexpected operator test request');
  });
  await connectOperator(entry);
  expect(currentOperator()?.reference).toEqual(entry.reference);
  expect(fetch).toHaveBeenCalledTimes(7);
});
