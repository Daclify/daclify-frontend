import { z } from 'zod';
import {
  AccountSchema,
  IdSchema,
  NativeAccountSchema,
  DaoRefSchema,
  PrivateRecordReferenceSchema,
  type DaoRef,
} from '@daclify/core-protocol';
import { PayrollActionSchemas } from '@daclify/modules/sdk';
import { useWorkspace } from '../state/workspace';
import { resolveApiUrl } from '../api/networks';
const schema = z.discriminatedUnion('stage', [
  z.strictObject({
    stage: z.literal('content'),
    contentVersion: z.int().min(1).max(4294967295).optional(),
    fields: PayrollActionSchemas.commitpriv.omit({ label: true }),
  }),
  z.strictObject({
    stage: z.literal('committing'),
    contentVersion: z.int().min(1).max(4294967295).optional(),
    fields: PayrollActionSchemas.commitpriv,
  }),
]);
export type PrivatePayrollDraft = z.infer<typeof schema>;
function key(dao: DaoRef, source: string, memberId: string) {
  return JSON.stringify([
    'daclify.private-payroll-draft.v1',
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
  IdSchema.parse(fields.schedule_id);
  if (draft.stage === 'committing') {
    const label = draft.fields.label;
    PrivateRecordReferenceSchema.parse({
      documentId: label.document_id,
      version: label.version,
      commitment: label.commitment,
      keyEpoch: label.key_epoch,
    });
    if (
      label.document_id !== fields.schedule_id ||
      (draft.contentVersion !== undefined && label.version !== draft.contentVersion)
    )
      throw Error('PRIVATE_PAYROLL_PARENT');
  }
  return draft;
}
export function loadPrivatePayrollDraft(dao: DaoRef, source: string, memberId: string) {
  const saved = sessionStorage.getItem(key(dao, source, memberId));
  if (!saved) return;
  if (saved.length > 4096) throw Error('PRIVATE_RECORD_FORMAT');
  return parse(dao, memberId, JSON.parse(saved));
}
export function savePrivatePayrollDraft(
  dao: DaoRef,
  source: string,
  memberId: string,
  value: unknown,
) {
  const draft = parse(dao, memberId, value);
  const serialized = JSON.stringify(draft);
  if (serialized.length > 4096) throw Error('PRIVATE_RECORD_FORMAT');
  sessionStorage.setItem(key(dao, source, memberId), serialized);
  return draft;
}
export function clearPrivatePayrollDraft(dao: DaoRef, source: string, memberId: string) {
  sessionStorage.removeItem(key(dao, source, memberId));
}
