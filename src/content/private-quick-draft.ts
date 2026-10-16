import { z } from 'zod';
import {
  AccountSchema,
  DaoRefSchema,
  IdSchema,
  NativeAccountSchema,
  type DaoRef,
} from '@daclify/core-protocol';
import { QuickBallotDefinitionSchema, quickQuestionReference } from '@daclify/modules';
import { QuickBallotActionSchemas } from '@daclify/modules/quick-ballots';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
const opening = QuickBallotActionSchemas.open;
const schema = z.discriminatedUnion('stage', [
  z.strictObject({
    stage: z.literal('content'),
    fields: opening.omit({ definition: true, key: true, possession: true, grants: true }),
    settings: opening.shape.definition
      .omit({ question: true, explanation: true })
      .extend({
        protocol: z.literal(2),
        all_accounts: z.literal(false),
        audience: z.array(IdSchema).length(1),
        readers: QuickBallotDefinitionSchema.shape.readers,
      }),
  }),
  z.strictObject({
    stage: z.literal('opening'),
    fields: opening.extend({ definition: QuickBallotDefinitionSchema }),
  }),
]);
export type PrivateQuickDraft = z.infer<typeof schema>;
function key(dao: DaoRef, source: string, memberId: string) {
  return JSON.stringify([
    'daclify.private-quick-draft.v1',
    resolveApiUrl('/'),
    AccountSchema.parse(useWorkspace().account).id,
    DaoRefSchema.parse(dao),
    NativeAccountSchema.parse(source),
    IdSchema.parse(memberId),
  ]);
}
function parse(dao: DaoRef, memberId: string, value: unknown) {
  const draft = schema.parse(value),
    fields = draft.fields;
  if (
    fields.runtime !== dao.contract ||
    fields.dao_id !== dao.daoId ||
    fields.member_id !== memberId
  )
    throw Error('DAO_REFERENCE');
  IdSchema.parse(fields.ballot_id);
  const settings = draft.stage === 'content' ? draft.settings : draft.fields.definition;
  if (
    settings.protocol !== 2 ||
    settings.all_accounts ||
    settings.audience.length !== 1 ||
    settings.audience[0] !== dao.daoId
  )
    throw Error('QUICK_QUESTION_AUDIENCE');
  if (
    draft.stage === 'opening' &&
    quickQuestionReference(draft.fields.definition)?.documentId !== fields.ballot_id
  )
    throw Error('QUICK_QUESTION_PARENT');
  return draft;
}
export function loadPrivateQuickDraft(dao: DaoRef, source: string, memberId: string) {
  const saved = sessionStorage.getItem(key(dao, source, memberId));
  if (!saved) return;
  if (saved.length > 32768) throw Error('PRIVATE_RECORD_FORMAT');
  return parse(dao, memberId, JSON.parse(saved));
}
export function savePrivateQuickDraft(
  dao: DaoRef,
  source: string,
  memberId: string,
  value: unknown,
) {
  const draft = parse(dao, memberId, value),
    serialized = JSON.stringify(draft);
  if (serialized.length > 32768) throw Error('PRIVATE_RECORD_FORMAT');
  sessionStorage.setItem(key(dao, source, memberId), serialized);
  return draft;
}
export function clearPrivateQuickDraft(dao: DaoRef, source: string, memberId: string) {
  sessionStorage.removeItem(key(dao, source, memberId));
}
