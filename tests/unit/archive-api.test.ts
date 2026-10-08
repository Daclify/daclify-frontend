import { afterEach, expect, it, vi } from 'vitest';
import { ArchiveRoutes, archiveSourceSchema } from '@daclify/modules/archive';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
const dao = {
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1 as const,
  },
  source = archiveSourceSchema('ordinary-poll-votes');
const request = { dao, ballotIds: ['7'], retentionSeconds: 90 * 86400 };
const result = {
  dao,
  source: { account: 'decide', codeHash: source.codeHash, abiHash: source.rawAbiHash },
  snapshot: {
    blockNumber: 1,
    blockId: '00000001' + 'ab'.repeat(28),
    timestamp: '2026-01-01T00:00:00.000Z',
  },
  pruningAuthorized: false,
  grossRamBytes: '0',
  families: [],
  blocked: [{ parentId: '7', reason: 'retention' }],
};
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('uses the installed archive producer schema with authenticated requests and exact DAO binding', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.archivePreview(request)).toEqual(result);
  expect(fetcher.mock.calls[0]?.[0]).toContain(ArchiveRoutes.preview.path);
  expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
  expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
});
it('rejects foreign results, fake prune authorization and shorter retention', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  for (const bad of [
    { ...result, dao: { ...dao, contract: 'daoother' } },
    { ...result, pruningAuthorized: true },
  ]) {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(bad)));
    await expect(api.archivePreview(request)).rejects.toThrow();
  }
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  await expect(api.archivePreview({ ...request, retentionSeconds: 1 })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('requests only the reviewed manifest backup and refuses another DAO or backup commitment', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const id = '00000000-0000-4000-8000-000000000001',
    commitment = 'cd'.repeat(32),
    status = {
      id,
      dao,
      state: 'verified',
      maximumStoredBytes: '4096',
      heldBytes: '0',
      verifiedChunks: 0,
      totalChunks: 0,
      manifest: {
        cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        bytes: 188,
        commitment,
      },
      pruningAuthorized: false,
      backupSupported: true,
      backup: {
        formatVersion: 1,
        storeId: 'fixture-backup',
        keyId: 'fixture-key',
        commitment: 'ef'.repeat(32),
        manifestCommitment: commitment,
        bytes: '2048',
        verifiedAt: '2026-10-08T12:00:00.000Z',
      },
    };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(status));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.archiveBackup(dao, id, commitment)).toEqual(
    ArchiveRoutes.backup.response.parse(status),
  );
  expect(fetcher.mock.calls[0]?.[0]).toContain(ArchiveRoutes.backup.path.replace(':id', id));
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
    JSON.stringify({ expectedManifestCommitment: commitment }),
  );
  for (const wrong of [
    { ...status, dao: { ...dao, contract: 'daoother' } },
    { ...status, backup: { ...status.backup, manifestCommitment: 'ab'.repeat(32) } },
  ]) {
    fetcher.mockResolvedValueOnce(Response.json(wrong));
    await expect(api.archiveBackup(dao, id, commitment)).rejects.toThrow('DAO_REFERENCE');
  }
});
it('keeps legacy poll requests unchanged and accepts bounded document selections without guessing fields', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ ...result, blocked: [{ parentId: '3', reason: 'referenced-version' }] }),
    );
  vi.stubGlobal('fetch', fetcher);
  const selection = { dao, documentRows: ['3'], retentionSeconds: 7776000 };
  expect((await api.archivePreview(selection)).blocked[0]?.reason).toBe('referenced-version');
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(selection));
  expect(() => ArchiveRoutes.preview.input.parse({ ...selection, ballotIds: ['7'] })).toThrow();
  expect(() =>
    ArchiveRoutes.preview.input.parse({ ...selection, documentRows: ['3', '3'] }),
  ).toThrow();
  expect(ArchiveRoutes.preview.input.parse(request)).toEqual(request);
});
