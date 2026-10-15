import { daoPaymentKey, type DaoRef } from '@daclify/core-protocol';
import type { GoverningDocumentPage } from '@daclify/modules';
import type { DecideActions } from '@daclify/modules/sdk';
import { api } from '../../api/client';
import type { PublishedDocumentReference } from '../files';
export type ManagedDocumentCandidate = {
  reference: PublishedDocumentReference;
  category: DecideActions['regdoc']['category'];
  approval: DecideActions['regdoc']['approval'];
  trackAcceptance: boolean;
};
// Absence is meaningful only after the complete native register (at most 64 rows).
export async function loadManagedRegister(
  dao: DaoRef,
  memberId?: string,
): Promise<GoverningDocumentPage> {
  let result: GoverningDocumentPage | undefined, after: string | undefined;
  for (let pageNumber = 0; pageNumber < 64; pageNumber++) {
    const page = await api.governingDocuments(dao.daoId, {
      ...(after ? { after } : {}),
      ...(memberId ? { memberId } : {}),
    });
    if (
      daoPaymentKey(page.dao) !== daoPaymentKey(dao) ||
      [...page.registrations, ...page.changes, ...page.acceptances].some(
        (row) => row.dao_id !== dao.daoId,
      )
    )
      throw new Error('DAO_REFERENCE');
    if (
      result &&
      (page.policyRevision !== result.policyRevision ||
        JSON.stringify(page.module) !== JSON.stringify(result.module) ||
        page.available !== result.available)
    )
      throw new Error('DOCUMENT_REVIEW_STALE');
    if (page.next && BigInt(page.next) <= BigInt(after ?? '0'))
      throw new Error('CHAIN_RESPONSE_INVALID');
    result = result
      ? {
          ...page,
          registrations: [...result.registrations, ...page.registrations],
          changes: [...result.changes, ...page.changes],
          ballots: [...result.ballots, ...page.ballots],
          ballotDefinitions: [...result.ballotDefinitions, ...page.ballotDefinitions],
          votes: [...result.votes, ...page.votes],
          acceptedAdoptionIds: [...result.acceptedAdoptionIds, ...page.acceptedAdoptionIds],
        }
      : page;
    const rows = result.registrations;
    if (
      rows.length > 64 ||
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      new Set(rows.map((row) => row.document_id)).size !== rows.length ||
      rows.filter((row) => row.category === 0).length > 1
    )
      throw new Error('CHAIN_RESPONSE_INVALID');
    if (!page.next) return result;
    after = page.next;
  }
  throw new Error('CHAIN_RESPONSE_INVALID');
}
