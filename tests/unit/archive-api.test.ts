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
