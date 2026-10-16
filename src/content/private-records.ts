import {
  DaoRefSchema,
  EncryptionPublicKeySchema,
  IdSchema,
  NativeAccountSchema,
  PrivateRecordPayloadSchema,
  PrivateRecordReferenceSchema,
  daoPaymentKey,
  type DaoContent,
  type DaoRef,
  type PrivateRecordPayload,
  type PrivateRecordReference,
} from '@daclify/core-protocol';
import { recoveryContextGuard, vaultUnlocked } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { readDocumentForReview } from './document-review';
import { LEGAL_DOCUMENT_MAX_BYTES } from './legal-templates/render';

export async function readPrivateRecord(
  dao: DaoRef,
  memberId: string,
  reference: PrivateRecordReference,
  records: DaoContent,
  expected: { kind: PrivateRecordPayload['kind']; source: string; recordId: string },
): Promise<PrivateRecordPayload> {
  const scope = DaoRefSchema.parse(dao),
    identity = IdSchema.parse(memberId),
    ref = PrivateRecordReferenceSchema.parse(reference),
    parent = {
      kind: expected.kind,
      source: NativeAccountSchema.parse(expected.source),
      recordId: IdSchema.parse(expected.recordId),
    },
    account = useWorkspace().account;
  if (!account?.encryptionKey) throw new Error('AUTH_REQUIRED');
  const context = recoveryContextGuard(account);
  const check = () => {
    context();
    if (!vaultUnlocked.value) throw new Error('VAULT_LOCKED');
    if (daoPaymentKey(scope) !== daoPaymentKey(records.dao)) throw new Error('DAO_REFERENCE');
    const member = records.members.find((row) => row.id === identity && row.active);
    if (!member) throw new Error('MEMBER_REQUIRED');
    const key = EncryptionPublicKeySchema.parse(JSON.parse(member.encryption_key));
    if (key.x !== account.encryptionKey?.x || key.y !== account.encryptionKey.y)
      throw new Error('ACCOUNT_KEY_MISMATCH');
  };
  check();
  const found = records.documents.find(
    (row) => row.document_id === ref.documentId && row.version === ref.version,
  );
  if (
    !found ||
    found.envelope_version !== 1 ||
    found.key_epoch !== ref.keyEpoch ||
    found.commitment !== ref.commitment
  )
    throw new Error('PRIVATE_RECORD_REFERENCE');
  const opened = await readDocumentForReview(scope, identity, { ...found }, records, {
    previewMarkdown: false,
  });
  check();
  let text = opened.text;
  if (opened.file) {
    if (
      opened.file.bytes.length > LEGAL_DOCUMENT_MAX_BYTES ||
      opened.file.metadata.mediaType !== 'application/json'
    )
      throw new Error('PRIVATE_RECORD_FORMAT');
    text = new TextDecoder('utf-8', { fatal: true }).decode(opened.file.bytes);
  }
  const payload = PrivateRecordPayloadSchema.parse(JSON.parse(text));
  if (
    payload.kind !== parent.kind ||
    payload.source !== parent.source ||
    payload.recordId !== parent.recordId
  )
    throw new Error('PRIVATE_RECORD_CONTEXT');
  return payload;
}
