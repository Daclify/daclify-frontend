import { z } from 'zod';
import {
  AccountSchema,
  DaoRefSchema,
  IdSchema,
  NativeAccountSchema,
  type DaoRef,
} from '@daclify/core-protocol';
import { BallotMetadataV4Schema } from '@daclify/modules';
import { DecideActionSchemas } from '@daclify/modules/sdk';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
const DraftSchema = z.strictObject({
  stage: z.enum(['content', 'opening']),
  contentVersion: z.int().min(1).max(4294967295).optional(),
  action: z.enum(['open', 'openpoll']),
  fields: DecideActionSchemas.open,
});
export type PrivateBallotDraft = z.infer<typeof DraftSchema>;
function key(dao: DaoRef, source: string, memberId: string) {
  return JSON.stringify([
    'daclify.private-ballot-draft.v1',
    resolveApiUrl('/'),
    AccountSchema.parse(useWorkspace().account).id,
    DaoRefSchema.parse(dao),
    NativeAccountSchema.parse(source),
    IdSchema.parse(memberId),
  ]);
}
function parse(dao: DaoRef, memberId: string, value: unknown) {
  const draft = DraftSchema.parse(value),
    fields = draft.fields;
  if (
    fields.runtime !== dao.contract ||
    fields.dao_id !== dao.daoId ||
    fields.member_id !== memberId
  )
    throw Error('PRIVATE_BALLOT_CONTEXT');
  if (draft.stage === 'content') {
    if (fields.metadata !== '') throw Error('PRIVATE_BALLOT_CONTEXT');
  } else {
    const metadata = BallotMetadataV4Schema.parse(JSON.parse(fields.metadata));
    if (
      metadata.privateContent.documentId !== fields.ballot_id ||
      (draft.contentVersion !== undefined &&
        metadata.privateContent.version !== draft.contentVersion) ||
      metadata.options.length !== fields.choices ||
      metadata.semantics !== (draft.action === 'open' ? 'proposal' : 'poll')
    )
      throw Error('PRIVATE_BALLOT_CONTEXT');
  }
  if (new TextEncoder().encode(JSON.stringify(draft)).length > 8192)
    throw Error('BALLOT_METADATA_SIZE');
  return draft;
}
export function loadPrivateBallotDraft(dao: DaoRef, source: string, memberId: string) {
  const saved = sessionStorage.getItem(key(dao, source, memberId));
  return saved ? parse(dao, memberId, JSON.parse(saved)) : undefined;
}
export function savePrivateBallotDraft(
  dao: DaoRef,
  source: string,
  memberId: string,
  value: unknown,
) {
  const draft = parse(dao, memberId, value);
  sessionStorage.setItem(key(dao, source, memberId), JSON.stringify(draft));
  return draft;
}
export function clearPrivateBallotDraft(dao: DaoRef, source: string, memberId: string) {
  sessionStorage.removeItem(key(dao, source, memberId));
}
