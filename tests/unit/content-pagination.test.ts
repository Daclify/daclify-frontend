import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
const dao = { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '7', interfaceVersion: 1 };
const page = (cursor: string | null) => ({
  dao,
  members: [],
  documents: [],
  keyGrants: [],
  epochs: [],
  next: { members: null, documents: cursor, keyGrants: null, epochs: null },
});
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('continues content pages with done cursors for completed collections', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(page('200')))
    .mockResolvedValueOnce(Response.json(page(null)));
  vi.stubGlobal('fetch', fetch);
  expect((await api.content('7')).next.documents).toBeNull();
  expect(fetch.mock.calls[1]?.[0]).toContain(
    'members=done&documents=200&keyGrants=done&epochs=done',
  );
});
it('rejects repeated, backwards or reactivated cursors and cross-DAO pages', async () => {
  for (const next of [
    page('200'),
    page('199'),
    { ...page(null), next: { ...page(null).next, members: '1' } },
    { ...page(null), dao: { ...dao, contract: 'other' } },
  ]) {
    vi.stubGlobal('sessionStorage', { getItem: () => null });
    configureNetworks(null);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page('200')))
      .mockResolvedValueOnce(Response.json(next));
    vi.stubGlobal('fetch', fetch);
    await expect(api.content('7')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  }
});
