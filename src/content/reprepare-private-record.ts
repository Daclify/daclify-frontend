import { z } from 'zod';
import {
  AccountSchema,
  HostedIntentSchema,
  PrivateRecordPayloadSchema,
  daoPaymentKey,
  type DaoRef,
  type PrivateRecordPayload,
} from '@daclify/core-protocol';
import { api, ApiFailure } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import {
  recoveryContextGuard,
  vaultUnlocked,
  preparePrivateEpoch,
  verifyPrivateEpochs,
} from '../auth/session';
import { privateRecordAccess, readPrivateRecord } from './private-records';
import {
  pendingPrivateRecord,
  publishPrivateRecord,
  sendPrivateAction,
} from './publish-private-record';
// Callers reconcile their exact native parent first and retain its logical ID across re-preparation.
export async function repreparePrivateRecord(
  dao: DaoRef,
  memberId: string,
  expected: { kind: PrivateRecordPayload['kind']; source: string; recordId: string },
  documentId = expected.recordId,
) {
  if (!vaultUnlocked.value) throw Error('VAULT_LOCKED');
  const account = AccountSchema.parse(useWorkspace().account),
    guard = recoveryContextGuard(account);
  const check = () => {
    guard();
    if (!vaultUnlocked.value) throw Error('VAULT_LOCKED');
  };
  const summary = await api.dao(dao.daoId);
  let records = await api.content(dao.daoId);
  check();
  if (daoPaymentKey(summary.reference) !== daoPaymentKey(dao) || summary.privacy === 'public')
    throw Error('DAO_REFERENCE');
  privateRecordAccess(dao, memberId, records).check();
  let replacement: Parameters<typeof publishPrivateRecord>[6];
  const pending = await pendingPrivateRecord(dao, memberId, records);
  check();
  const latest = records.documents
    .filter((row) => row.document_id === documentId)
    .sort((a, b) => b.version - a.version)[0];
  let payload: PrivateRecordPayload;
  if (pending) {
    if (pending.upload.documentId !== documentId) throw Error('PENDING_UPLOAD_FINISH');
    payload = pending.payload;
    if (
      payload.kind !== expected.kind ||
      payload.source !== expected.source ||
      payload.recordId !== expected.recordId
    )
      throw Error('PRIVATE_RECORD_CONTEXT');
    if (pending.upload.keyEpoch !== summary.keyEpoch) {
      let status: Awaited<ReturnType<typeof api.reconcileUpload>> | undefined;
      try {
        status = await api.reconcileUpload(pending.upload.requestId);
      } catch (cause) {
        if (!(cause instanceof ApiFailure && cause.code === 'UPLOAD_UNKNOWN')) throw cause;
      }
      check();
      if (
        status &&
        (!status.document ||
          !['verified', 'published'].includes(status.state) ||
          JSON.stringify(HostedIntentSchema.strip().parse(status.document)) !==
            JSON.stringify(HostedIntentSchema.strip().parse(pending.upload)))
      )
        throw Error('UPLOAD_PENDING');
      const key = JSON.stringify([
        'daclify.retired-private-uploads.v1',
        resolveApiUrl('/'),
        account.id,
        dao,
      ]);
      const schema = z.array(z.uuid()).max(25),
        retired = schema.parse(JSON.parse(sessionStorage.getItem(key) ?? '[]'));
      if (status && !retired.includes(pending.upload.requestId))
        retired.push(pending.upload.requestId);
      sessionStorage.setItem(key, JSON.stringify(retired.slice(-25)));
      replacement = pending.upload;
    }
  } else {
    if (!latest) throw Error('PRIVATE_RECORD_PENDING');
    payload = await readPrivateRecord(
      dao,
      memberId,
      {
        documentId,
        version: latest.version,
        commitment: latest.commitment,
        keyEpoch: latest.key_epoch,
      },
      records,
      expected,
    );
  }
  check();
  PrivateRecordPayloadSchema.parse(payload);
  if (
    payload.kind !== expected.kind ||
    payload.source !== expected.source ||
    payload.recordId !== expected.recordId
  )
    throw Error('PRIVATE_RECORD_CONTEXT');
  if (!records.epochs.some((epoch) => epoch.epoch === summary.keyEpoch)) {
    const epoch = await preparePrivateEpoch(dao, memberId, summary.keyEpoch);
    check();
    try {
      await sendPrivateAction(
        dao,
        memberId,
        'commitepoch',
        {
          runtime: dao.contract,
          dao_id: dao.daoId,
          member_id: memberId,
          epoch: summary.keyEpoch,
          commitment: epoch.commitment,
          self_grant: epoch.selfGrant,
        },
        true,
      );
    } catch (cause) {
      records = await api.content(dao.daoId);
      check();
      if (
        !records.epochs.some(
          (row) => row.epoch === summary.keyEpoch && row.commitment === epoch.commitment,
        )
      )
        throw cause;
    }
    records = await api.content(dao.daoId);
    check();
  }
  await verifyPrivateEpochs(dao, memberId, [summary.keyEpoch], records);
  check();
  const version = latest
    ? latest.key_epoch === summary.keyEpoch
      ? latest.version
      : latest.version + 1
    : 1;
  const reference = await publishPrivateRecord(
    dao,
    memberId,
    documentId,
    pending?.upload.keyEpoch === summary.keyEpoch ? pending.upload.version : version,
    payload,
    true,
    replacement,
  );
  check();
  return { reference, payload };
}
