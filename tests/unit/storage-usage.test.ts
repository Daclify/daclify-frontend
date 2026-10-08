import { afterEach, expect, it, vi } from 'vitest';
import { ApiRoutes, DaoRefSchema } from '@daclify/core-protocol';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
const dao = DaoRefSchema.parse({
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '7',
  interfaceVersion: 1,
});
const usage = {
  dao,
  capacityBytes: '100000000',
  verifiedBytes: '22',
  reservedBytes: '0',
  totalBytes: '22',
  objects: 1,
  references: 2,
  cleanup: 'disabled',
};
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('reads producer-owned storage counters with an authenticated browser request', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(usage));
  vi.stubGlobal('fetch', fetcher);
  expect(await api.storageUsage(dao)).toEqual(usage);
  expect(fetcher.mock.calls[0]?.[0]).toContain(ApiRoutes.storageUsage.path.replace(':id', '7'));
  expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
});
it('rejects counters from another deployment and malformed negative values', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  for (const response of [
    { ...usage, dao: { ...dao, contract: 'other' } },
    { ...usage, verifiedBytes: '-1' },
  ]) {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)));
    await expect(api.storageUsage(dao)).rejects.toThrow();
  }
});
