import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
import { Catalog, CONTRACT_VERSION } from '@daclify/modules';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
const dao = { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '7', interfaceVersion: 1 };
const empty = {
  dao,
  available: false,
  module: null,
  registrations: [],
  changes: [],
  acceptances: [],
  acceptedAdoptionIds: [],
  ballots: [],
  votes: [],
  next: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
});
it('keeps verified history readable while member actions are disabled', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const manifest = Catalog.find((item) => item.id === 'decide');
  if (!manifest) throw new Error('FIXTURE_MANIFEST');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          ...empty,
          available: true,
          module: {
            manifest,
            deployment: {
              id: 'decide',
              account: 'decide',
              version: CONTRACT_VERSION,
              codeHash: ModuleCodeHashes.decide,
            },
            enabled: false,
            installed: true,
            compatible: true,
            codeVerified: true,
            actions: [],
            grants: [],
          },
        }),
      ),
  );
  expect((await api.governingDocuments('7')).available).toBe(true);
});
it('reads a bounded document page and sends only validated query fields', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  const fetch = vi.fn().mockResolvedValue(Response.json(empty));
  vi.stubGlobal('fetch', fetch);
  expect((await api.governingDocuments('7', { memberId: '2', after: '26' })).available).toBe(false);
  expect(fetch.mock.calls[0]?.[0]).toContain('/v1/daos/7/governing-documents?after=26&memberId=2');
});
it('rejects cross-DAO document pages', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  configureNetworks(null);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ ...empty, dao: { ...dao, daoId: '8' } })),
  );
  await expect(api.governingDocuments('7', {})).rejects.toThrow('DAO_REFERENCE');
});
