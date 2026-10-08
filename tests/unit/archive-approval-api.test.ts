import { afterEach, expect, it, vi } from 'vitest';
import { ArchiveRoutes, archiveSourceSchema } from '@daclify/modules/archive';
import { RuntimeTableSchemas } from '@daclify/core-protocol/sdk';
import { Name } from '@wharfkit/antelope';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
const dao = {
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1 as const,
  },
  id = '00000000-0000-4000-8000-000000000001',
  source = archiveSourceSchema('ordinary-poll-votes'),
  input = {
    manifestCommitment: 'cd'.repeat(32),
    descriptorCommitment: 'ef'.repeat(32),
    backupCommitment: 'ad'.repeat(32),
    retentionSeconds: 90 * 86400,
  };
function fixture() {
  const anchor = RuntimeTableSchemas.archives.parse({
    id: '1',
    dao_id: '1',
    manifest: {
      format_version: 1,
      chain_id: dao.chainId,
      runtime: dao.contract,
      dao_id: '1',
      source: 'decide',
      code_hash: source.codeHash,
      abi_hash: source.rawAbiHash,
      block_number: 1,
      block_id: '00000001' + 'ab'.repeat(28),
      timestamp: '2026-01-01T00:00:00.000Z',
      families: [
        {
          kind: 'ordinary-poll-votes',
          parent_id: '7',
          table: 'votes',
          scope: Name.from(dao.contract).value.toString(),
          schema_hash: source.schemaHash,
          records: '0',
          chunks: [],
        },
      ],
      files: [],
    },
    manifest_cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    manifest_bytes: 188,
    manifest_commitment: input.manifestCommitment,
    descriptor_commitment: input.descriptorCommitment,
    backup_commitment: input.backupCommitment,
    verifier: 'relay',
    retention_seconds: input.retentionSeconds,
    attested_at: 1700000000,
    approved_by: '0',
    approved_at: 0,
    revoked: false,
    attestation_transaction: 'aa'.repeat(32),
    approval_transaction: '00'.repeat(32),
  });
  return ArchiveRoutes.attest.response.parse({
    id,
    dao,
    state: 'verified',
    maximumStoredBytes: '4096',
    heldBytes: '0',
    verifiedChunks: 0,
    totalChunks: 0,
    retentionSeconds: input.retentionSeconds,
    anchor,
    manifest: { cid: anchor.manifest_cid, bytes: 188, commitment: input.manifestCommitment },
    pruningAuthorized: false,
    backupSupported: true,
    backup: {
      formatVersion: 1,
      storeId: 'fixture-backup',
      keyId: 'fixture-key',
      commitment: input.backupCommitment,
      manifestCommitment: input.manifestCommitment,
      bytes: '2048',
      verifiedAt: '2026-10-08T12:00:00.000Z',
    },
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('binds the exact immutable native commitments and delay before exposing an approval intent', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const status = fixture(),
    fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(status));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.archiveAttest(dao, id, input)).toEqual(status);
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));
  if (!status.anchor) throw new Error('Fixture requires native anchor');
  for (const wrong of [
    { ...status, dao: { ...dao, contract: 'daoother' } },
    { ...status, anchor: { ...status.anchor, retention_seconds: 365 * 86400 } },
    { ...status, anchor: { ...status.anchor, backup_commitment: 'ae'.repeat(32) } },
  ]) {
    fetcher.mockResolvedValueOnce(Response.json(wrong));
    await expect(api.archiveAttest(dao, id, input)).rejects.toThrow('DAO_REFERENCE');
  }
});
