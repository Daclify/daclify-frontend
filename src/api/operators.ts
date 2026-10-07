import {
  DirectoryEntrySchema,
  DirectoryRoutes,
  NetworkSchema,
  VERSION,
  ChainIdSchema,
  daoPaymentKey,
  type DirectoryEntry,
  type Network,
} from '@daclify/core-protocol';
import { RuntimeCodeHash, RuntimeRawAbiHash } from '@daclify/core-protocol/sdk';
import { z } from 'zod';
import { approveOperator, resolveCentralApiUrl } from './networks';
export async function validateOperator(value: DirectoryEntry, source: Network): Promise<void> {
  const entry = DirectoryEntrySchema.parse(value);
  if (
    entry.portal.mode !== 'daclify' ||
    entry.reference.chainId !== source.chainId ||
    entry.codeHash !== RuntimeCodeHash ||
    entry.abiHash !== RuntimeRawAbiHash
  )
    throw new Error('OPERATOR_INCOMPATIBLE');
  const origin = new URL(entry.portal.apiOrigin).origin;
  const rpc = new URL(source.rpcUrl);
  if (
    rpc.username ||
    rpc.password ||
    rpc.search ||
    rpc.hash ||
    (rpc.protocol !== 'https:' &&
      !(rpc.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(rpc.hostname)))
  )
    throw new Error('OPERATOR_INCOMPATIBLE');
  const [api, info, raw] = await Promise.all([
    fetch(origin + '/v1/network', {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    }),
    fetch(source.rpcUrl + '/v1/chain/get_info', {
      credentials: 'omit',
      redirect: 'error',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    }),
    fetch(source.rpcUrl + '/v1/chain/get_raw_abi', {
      credentials: 'omit',
      redirect: 'error',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_name: entry.reference.contract }),
      signal: AbortSignal.timeout(10000),
    }),
  ]);
  if (!api.ok || !info.ok || !raw.ok) throw new Error('OPERATOR_UNAVAILABLE');
  const network = NetworkSchema.parse(await api.json()),
    chain = z.object({ chain_id: ChainIdSchema }).parse(await info.json()),
    code = z.object({ code_hash: ChainIdSchema, abi_hash: ChainIdSchema }).parse(await raw.json());
  if (
    network.chainId !== source.chainId ||
    network.runtime !== entry.reference.contract ||
    network.environment !== source.environment ||
    network.coreVersion !== VERSION ||
    chain.chain_id !== source.chainId ||
    code.code_hash !== entry.codeHash ||
    code.abi_hash !== entry.abiHash
  )
    throw new Error('OPERATOR_INCOMPATIBLE');
  const daoResponse = await fetch(origin + '/v1/daos/' + entry.reference.daoId, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!daoResponse.ok) throw new Error('OPERATOR_UNAVAILABLE');
  const { ApiRoutes } = await import('@daclify/core-protocol');
  const dao = ApiRoutes.dao.response.parse(await daoResponse.json());
  if (daoPaymentKey(dao.reference) !== daoPaymentKey(entry.reference))
    throw new Error('OPERATOR_INCOMPATIBLE');
}

export async function verifyRegisteredOperator(value: DirectoryEntry): Promise<DirectoryEntry> {
  const saved = DirectoryEntrySchema.parse(value);
  if (
    saved.portal.mode !== 'daclify' ||
    saved.codeHash !== RuntimeCodeHash ||
    saved.abiHash !== RuntimeRawAbiHash
  )
    throw new Error('OPERATOR_INCOMPATIBLE');
  const central = resolveCentralApiUrl('/');
  const publicRead = async (path: string): Promise<unknown> => {
    const response = await fetch(central.replace(/\/$/, '') + path, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('OPERATOR_UNAVAILABLE');
    return response.json();
  };
  const source = NetworkSchema.parse(await publicRead('/v1/network'));
  let after: string | undefined, entry: DirectoryEntry | undefined;
  const seen = new Set<string>();
  do {
    const page = DirectoryRoutes.hubDirectory.response.parse(
      await publicRead(DirectoryRoutes.hubDirectory.path + (after ? '?after=' + after : '')),
    );
    entry = page.entries.find((e) => daoPaymentKey(e.reference) === daoPaymentKey(saved.reference));
    if (entry) break;
    after = page.next ?? undefined;
    if (after && seen.has(after)) throw new Error('OPERATOR_INCOMPATIBLE');
    if (after) seen.add(after);
  } while (after);
  if (
    !entry ||
    entry.portal.mode !== 'daclify' ||
    entry.portal.apiOrigin !== saved.portal.apiOrigin
  )
    throw new Error('OPERATOR_INCOMPATIBLE');
  await validateOperator(entry, source);
  if (central !== resolveCentralApiUrl('/')) throw new Error('OPERATOR_INCOMPATIBLE');
  return entry;
}
export async function connectOperator(value: DirectoryEntry): Promise<void> {
  approveOperator(await verifyRegisteredOperator(value));
}
