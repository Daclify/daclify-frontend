import {
  PrivateMetadataSchema,
  PrivateRecordPayloadSchema,
  type DaoRef,
  type PrivateRecordReference,
} from '@daclify/core-protocol';
import { api } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { recoveryContextGuard } from '../auth/session';
import {
  publishPrivateRecord,
  sendPrivateAction,
  pendingPrivateRecord,
} from './publish-private-record';
import { readPrivateRecord } from './private-records';

export async function updatePrivateIdentity(
  dao: DaoRef,
  memberId: string,
  previous: PrivateRecordReference,
  body: unknown,
) {
  const account = useWorkspace().account;
  if (!account) throw Error('AUTH_REQUIRED');
  const check = recoveryContextGuard(account),
    snapshot = await api.privateIdentity(dao);
  check();
  const metadata = PrivateMetadataSchema.parse(snapshot.metadata);
  if (JSON.stringify(metadata.privateIdentity) !== JSON.stringify(previous))
    throw Error('PRIVATE_METADATA_CHANGED');
  const payload = PrivateRecordPayloadSchema.parse({
    schemaVersion: 1,
    kind: 'dao-identity',
    source: dao.contract,
    recordId: dao.daoId,
    body,
  });
  if (payload.kind !== 'dao-identity') throw Error('PRIVATE_RECORD_CONTEXT');
  const records = await api.content(dao.daoId),
    pending = await pendingPrivateRecord(dao, memberId, records);
  check();
  const latest = records.documents
    .filter((row) => row.document_id === previous.documentId)
    .sort((a, b) => b.version - a.version)[0];
  const summary = await api.dao(dao.daoId);
  check();
  let version = Math.max(previous.version, latest?.version ?? 0) + 1;
  if (pending) version = pending.upload.version;
  else if (latest && latest.version > previous.version) {
    const opened = await readPrivateRecord(
      dao,
      memberId,
      {
        documentId: latest.document_id,
        version: latest.version,
        commitment: latest.commitment,
        keyEpoch: latest.key_epoch,
      },
      records,
      payload,
    );
    check();
    if (latest.key_epoch === summary.keyEpoch && JSON.stringify(opened) === JSON.stringify(payload))
      version = latest.version;
  }
  const reference = await publishPrivateRecord(
    dao,
    memberId,
    previous.documentId,
    version,
    payload,
  );
  check();
  const assets = Object.values(payload.body.branding ?? {}).filter((ref) => ref !== undefined),
    unique = assets.filter(
      (ref, i) =>
        assets.findIndex(
          (other) => other.documentId === ref.documentId && other.version === ref.version,
        ) === i,
    );
  const next = PrivateMetadataSchema.parse({
    ...metadata,
    privateIdentity: reference,
    privateAssets: unique,
  });
  const current = await api.dao(dao.daoId);
  check();
  if (reference.keyEpoch !== current.keyEpoch) throw Error('PRIVATE_EPOCH_CHANGED');
  if (
    unique.some(
      (ref) =>
        ref.keyEpoch !== current.keyEpoch &&
        !metadata.privateAssets?.some((old) => JSON.stringify(old) === JSON.stringify(ref)),
    )
  )
    throw Error('PRIVATE_ASSET_EPOCH_CHANGED');
  await sendPrivateAction(dao, memberId, 'setmeta', {
    runtime: dao.contract,
    dao_id: dao.daoId,
    member_id: memberId,
    metadata: JSON.stringify(next),
    expected: snapshot.metadataCommitment,
  });
  const published = await api.privateIdentity(dao);
  check();
  if (JSON.stringify(published.reference) !== JSON.stringify(reference))
    throw Error('PRIVATE_RECORD_PENDING');
  return reference;
}
