import {
  AccountSchema,
  DaoRefSchema,
  IdSchema,
  PrivateRecordPayloadSchema,
  HostedUploadSchema,
  HostedIntentSchema,
  type DaoContent,
  daoPaymentKey,
  type DaoRef,
  type PrivateRecordReference,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction, RuntimeActionSchemas } from '@daclify/core-protocol/sdk';
import { api, ApiFailure } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import {
  recoveryContextGuard,
  vaultUnlocked,
  encryptDaoJson,
  encryptDaoFile,
  openPreparedDaoFile,
  relayInstruction,
  relayWithVault,
} from '../auth/session';
import { readPrivateRecord, privateRecordAccess } from './private-records';

type PrivateAction = 'commitepoch' | 'putjson' | 'putdoc' | 'setmeta' | 'setagentdesc';
export async function sendPrivateAction(
  dao: DaoRef,
  memberId: string,
  action: PrivateAction,
  data: unknown,
  root = false,
) {
  const account = AccountSchema.parse(useWorkspace().account),
    check = recoveryContextGuard(account);
  const members = await api.memberships();
  check();
  if (!vaultUnlocked.value) throw Error('VAULT_LOCKED');
  const member = members.find(
    (row) =>
      row.memberId === memberId && row.active && daoPaymentKey(row.dao) === daoPaymentKey(dao),
  );
  if (!member || (root && member.signingKey !== account.signingKey)) throw Error('MEMBER_REQUIRED');
  const payload = RuntimeActionSchemas[action].parse(data);
  if (
    payload.runtime !== dao.contract ||
    payload.dao_id !== dao.daoId ||
    payload.member_id !== memberId
  )
    throw Error('DAO_REFERENCE');
  const request = makeInstruction(
    dao,
    memberId,
    member.nonce,
    Math.floor(Date.now() / 1000) + 300,
    dao.contract,
    action,
    encodeAction(action, payload),
  );
  check();
  await (root ? relayWithVault(request) : relayInstruction(request));
  check();
}

function pendingKey(dao: DaoRef) {
  return JSON.stringify([
    'daclify.pending-private-record.v1',
    resolveApiUrl('/'),
    AccountSchema.parse(useWorkspace().account).id,
    dao,
  ]);
}
export async function pendingPrivateRecord(dao: DaoRef, memberId: string, records: DaoContent) {
  const { check } = privateRecordAccess(dao, memberId, records),
    saved = sessionStorage.getItem(pendingKey(dao));
  if (!saved) return;
  const upload = HostedUploadSchema.parse(JSON.parse(saved));
  if (daoPaymentKey(upload.dao) !== daoPaymentKey(dao)) throw Error('DAO_REFERENCE');
  const opened = await openPreparedDaoFile(memberId, records, upload);
  check();
  if (opened.metadata.mediaType !== 'application/json') throw Error('PRIVATE_RECORD_FORMAT');
  const payload = PrivateRecordPayloadSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(opened.bytes)),
  );
  return { upload, payload };
}
export async function publishPrivateRecord(
  dao: DaoRef,
  memberId: string,
  documentId: string,
  version: number,
  value: unknown,
  root = false,
): Promise<PrivateRecordReference> {
  dao = DaoRefSchema.parse(dao);
  IdSchema.parse(memberId);
  IdSchema.parse(documentId);
  const payload = PrivateRecordPayloadSchema.parse(value),
    serialized = JSON.stringify(payload);
  const account = AccountSchema.parse(useWorkspace().account),
    guard = recoveryContextGuard(account);
  const check = () => {
    guard();
    if (!vaultUnlocked.value) throw Error('VAULT_LOCKED');
  };
  let content = await api.content(dao.daoId);
  check();
  const checkContent = () => privateRecordAccess(dao, memberId, content).check();
  checkContent();
  const pending = await pendingPrivateRecord(dao, memberId, content);
  check();
  if (
    pending &&
    (pending.upload.documentId !== documentId ||
      pending.upload.version !== version ||
      JSON.stringify(pending.payload) !== serialized)
  )
    throw Error('PENDING_UPLOAD_FINISH');
  async function existing() {
    const found = content.documents.find(
      (row) => row.document_id === documentId && row.version === version,
    );
    if (!found) return;
    const reference = {
      documentId,
      version,
      commitment: found.commitment,
      keyEpoch: found.key_epoch,
    };
    const opened = await readPrivateRecord(dao, memberId, reference, content, payload);
    check();
    if (JSON.stringify(opened) !== serialized) throw Error('DOCUMENT_VERSION');
    return reference;
  }
  const prior = await existing();
  if (prior) {
    if (pending) sessionStorage.removeItem(pendingKey(dao));
    return prior;
  }
  if (!useWorkspace().network?.capabilities.includes('private-records-v1'))
    throw Error('PRIVATE_IDENTITY_UNSUPPORTED');
  const summary = await api.dao(dao.daoId);
  check();
  if (
    daoPaymentKey(summary.reference) !== daoPaymentKey(dao) ||
    summary.privacy === 'public' ||
    summary.keyEpoch === '0'
  )
    throw Error('PRIVATE_DAO_REQUIRED');
  const epoch = summary.keyEpoch,
    actor = { runtime: dao.contract, dao_id: dao.daoId, member_id: memberId };
  if (pending && pending.upload.keyEpoch !== epoch) throw Error('PENDING_UPLOAD_FINISH');
  const encrypted = pending
    ? ''
    : await encryptDaoJson(dao, memberId, documentId, version, epoch, content, serialized);
  check();
  if (!pending && new TextEncoder().encode(encrypted).length <= 4096) {
    await sendPrivateAction(
      dao,
      memberId,
      'putjson',
      {
        ...actor,
        document_id: documentId,
        version,
        value: encrypted,
        envelope_version: 1,
        key_epoch: epoch,
      },
      root,
    );
  } else {
    let upload = pending?.upload;
    if (!upload) {
      const prepared = await encryptDaoFile(
        dao,
        memberId,
        documentId,
        version,
        epoch,
        content,
        new TextEncoder().encode(serialized),
        { version: 1, filename: 'private-record.json', mediaType: 'application/json' },
      );
      check();
      upload = HostedUploadSchema.parse({
        ...prepared,
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        dao,
        documentId,
        version,
        keyEpoch: epoch,
      });
      sessionStorage.setItem(pendingKey(dao), JSON.stringify(upload));
    }
    let receipt;
    if (pending) {
      try {
        receipt = (await api.reconcileUpload(upload.requestId)).document;
      } catch (cause) {
        if (!(cause instanceof ApiFailure && cause.code === 'UPLOAD_UNKNOWN')) throw cause;
      }
    }
    if (!receipt) receipt = await api.upload(upload);
    check();
    if (!receipt) throw Error('UPLOAD_PENDING');
    if (
      JSON.stringify(HostedIntentSchema.strip().parse(receipt)) !==
      JSON.stringify(HostedIntentSchema.strip().parse(upload))
    )
      throw Error('UPLOAD_RECEIPT');
    await sendPrivateAction(
      dao,
      memberId,
      'putdoc',
      {
        ...actor,
        document_id: documentId,
        version,
        cid: receipt.cid,
        metadata: receipt.metadata,
        commitment: receipt.commitment,
        bytes: receipt.bytes,
        envelope_version: 1,
        key_epoch: epoch,
      },
      root,
    );
  }
  content = await api.content(dao.daoId);
  check();
  checkContent();
  const reference = await existing();
  if (!reference) throw Error('PRIVATE_RECORD_PENDING');
  sessionStorage.removeItem(pendingKey(dao));
  return reference;
}
