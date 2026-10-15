import { afterEach, expect, it, vi } from 'vitest';
import { DaoRefSchema } from '@daclify/core-protocol';
import { ModuleApiRoutes } from '@daclify/modules';
import { api } from '../../src/api/client';
import { loadManagedRegister } from '../../src/content/legal-templates/managed';
const dao = DaoRefSchema.parse({
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '1',
  interfaceVersion: 1,
});
const page = () =>
  ModuleApiRoutes.documents.response.parse({
    dao,
    available: true,
    module: null,
    registrations: [],
    changes: [],
    acceptances: [],
    acceptedAdoptionIds: [],
    ballots: [],
    votes: [],
    next: null,
  });
afterEach(() => vi.restoreAllMocks());
it('finishes bounded discovery before asserting absence', async () => {
  const first = { ...page(), next: '2' },
    second = page();
  const read = vi
    .spyOn(api, 'governingDocuments')
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  expect((await loadManagedRegister(dao)).next).toBeNull();
  expect(read.mock.calls[1]).toEqual(['1', { after: '2' }]);
});
it('rejects failed, foreign, looping and policy-changing pages', async () => {
  const read = vi.spyOn(api, 'governingDocuments');
  read
    .mockResolvedValueOnce({ ...page(), next: '2' })
    .mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'));
  await expect(loadManagedRegister(dao)).rejects.toThrow('SERVICE_UNAVAILABLE');
  read.mockResolvedValueOnce({ ...page(), dao: { ...dao, daoId: '2' } });
  await expect(loadManagedRegister(dao)).rejects.toThrow('DAO_REFERENCE');
  read
    .mockResolvedValueOnce({ ...page(), next: '2' })
    .mockResolvedValueOnce({ ...page(), next: '2' });
  await expect(loadManagedRegister(dao)).rejects.toThrow('CHAIN_RESPONSE_INVALID');
  read
    .mockResolvedValueOnce({ ...page(), next: '2' })
    .mockResolvedValueOnce({ ...page(), policyRevision: '2' });
  await expect(loadManagedRegister(dao)).rejects.toThrow('DOCUMENT_REVIEW_STALE');
});
it('finds a constitution on a later page and enforces the native register bound', async () => {
  const row = {
    id: '1',
    dao_id: '1',
    document_id: '7',
    category: 0,
    approval: 0,
    track_acceptance: true,
    revision: '1',
    adopted_id: '1',
    pending_id: '0',
  };
  const read = vi
    .spyOn(api, 'governingDocuments')
    .mockResolvedValueOnce({ ...page(), next: '2' })
    .mockResolvedValueOnce({ ...page(), registrations: [row] });
  expect((await loadManagedRegister(dao)).registrations[0]?.document_id).toBe('7');
  const rows = Array.from({ length: 64 }, (_, index) => ({
    ...row,
    id: String(index + 1),
    document_id: String(index + 1),
    category: 1,
  }));
  read
    .mockResolvedValueOnce({ ...page(), registrations: rows, next: '65' })
    .mockResolvedValueOnce({
      ...page(),
      registrations: [{ ...row, id: '65', document_id: '65', category: 1 }],
    });
  await expect(loadManagedRegister(dao)).rejects.toThrow('CHAIN_RESPONSE_INVALID');
});
