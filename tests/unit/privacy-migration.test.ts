import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  DaoRefSchema,
  DaoSummarySchema,
  GovernanceStateSchema,
  PrivateRecordRoutes,
} from '@daclify/core-protocol';
import { ModuleStateSchema } from '@daclify/modules';
import { api } from '../../src/api/client';
import {
  previewPrivacyMigration,
  applyPrivacyMigrationItem,
} from '../../src/content/privacy-migration';
import { lockVault } from '../../src/auth/session';
const dao = DaoRefSchema.parse({
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore1',
  daoId: '7',
  interfaceVersion: 1,
});
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  lockVault();
  vi.restoreAllMocks();
  setActivePinia(undefined);
});
function fixture() {
  vi.spyOn(api, 'dao').mockResolvedValue(
    DaoSummarySchema.parse({
      reference: dao,
      title: 'Old public title',
      description: 'Old public mission',
      privacy: 'encrypted-user-controlled',
      owner: 'alice',
      token: { chainId: dao.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
      members: 2,
      available: '123',
      reserved: '456',
      claims: '789',
      keyEpoch: '1',
    }),
  );
  vi.spyOn(api, 'privateIdentity').mockResolvedValue(
    PrivateRecordRoutes.identity.response.parse({
      dao,
      reference: null,
      metadata: { schemaVersion: 1, title: 'Old public title', description: 'Old public mission' },
      metadataCommitment: 'cd'.repeat(32),
    }),
  );
  vi.spyOn(api, 'governance').mockResolvedValue(
    GovernanceStateSchema.parse({
      dao,
      policy: null,
      actors: [],
      sessions: [],
      guardian: null,
      budget: null,
    }),
  );
  vi.spyOn(api, 'moduleState').mockResolvedValue(
    ModuleStateSchema.parse({
      dao,
      modules: [],
      ballots: [],
      votes: [],
      projects: [],
      milestones: [],
      schedules: [],
      entries: [],
      controls: [],
    }),
  );
  return vi.spyOn(api, 'relay');
}
it('previews public descriptive successors without signing or changing financial state', async () => {
  const relay = fixture();
  const preview = await previewPrivacyMigration(dao);
  expect(preview.items).toMatchObject([
    {
      kind: 'dao-identity',
      id: '7',
      payload: { body: { title: 'Old public title', description: 'Old public mission' } },
    },
  ]);
  expect(preview.publicState).toMatchObject({ available: '123', reserved: '456', claims: '789' });
  expect(preview.historicalDisclosure).toBe(true);
  expect(preview.next).toBeNull();
  expect(relay).not.toHaveBeenCalled();
  const item = preview.items[0];
  if (!item) throw Error('preview missing');
  await expect(applyPrivacyMigrationItem(dao, '1', item)).rejects.toThrow('VAULT_LOCKED');
  expect(relay).not.toHaveBeenCalled();
});
it('rejects cross-deployment projections instead of constructing a migration', async () => {
  fixture();
  const other = await api.governance('7');
  vi.spyOn(api, 'governance').mockResolvedValue({
    ...other,
    dao: { ...dao, contract: 'othercore' },
  });
  await expect(previewPrivacyMigration(dao)).rejects.toThrow('DAO_REFERENCE');
});
it('bounds preview pages and validates a cursor without using it as authority', async () => {
  fixture();
  const state = await api.governance('7');
  state.actors = Array.from({ length: 30 }, (_, index) => ({
    id: String(index + 1),
    kind: 1,
    operator_label: 'Old public operator ' + index,
    revoked: false,
    credential_epoch: '1',
  }));
  vi.spyOn(api, 'governance').mockResolvedValue(state);
  const first = await previewPrivacyMigration(dao);
  expect(first.items).toHaveLength(25);
  expect(first.next).not.toBeNull();
  if (!first.next) throw Error('cursor missing');
  const next = await previewPrivacyMigration(dao, first.next);
  expect(next.items).toHaveLength(6);
  expect(next.next).toBeNull();
  await expect(
    previewPrivacyMigration(
      dao,
      JSON.stringify({ offset: 0, payrollOnly: false, authorize: true }),
    ),
  ).rejects.toThrow();
});
