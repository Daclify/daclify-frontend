import {
  AccountSchema,
  PrivateMetadataSchema,
  daoPaymentKey,
  type CreationOrderView,
  type PrivateRecordPayload,
  type PrivateRecordReference,
} from '@daclify/core-protocol';
import { api } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { recoveryContextGuard, vaultUnlocked } from '../auth/session';
import { openPrivateFounder, openPrivateFounderAgent } from './private-identity-setup';
import { readPrivateRecord } from './private-records';
import { repreparePrivateRecord } from './reprepare-private-record';
import {
  pendingPrivateRecord,
  publishPrivateRecord,
  sendPrivateAction,
} from './publish-private-record';

export async function installPrivateIdentity(order: CreationOrderView, reprepare = false) {
  const dao = order.dao,
    setup = order.setup.privateSetup,
    account = AccountSchema.parse(useWorkspace().account);
  if (order.state !== 'created' || !dao || setup?.stage !== 'founder' || setup.daoId !== dao.daoId)
    throw Error('PRIVATE_FOUNDER_REQUIRED');
  if (
    order.creator.signingKey !== account.signingKey ||
    JSON.stringify(order.creator.encryptionKey) !== JSON.stringify(account.encryptionKey)
  )
    throw Error('ACCOUNT_KEY_MISMATCH');
  const guard = recoveryContextGuard(account),
    check = () => {
      guard();
      if (!vaultUnlocked.value) throw Error('VAULT_LOCKED');
    };
  const payload = await openPrivateFounder(dao, setup, order.setup);
  check();
  let content = await api.content(dao.daoId);
  check();
  if (daoPaymentKey(content.dao) !== daoPaymentKey(dao)) throw Error('DAO_REFERENCE');
  const actor = { runtime: dao.contract, dao_id: dao.daoId, member_id: '1' };
  const committed = content.epochs.find((row) => row.epoch === '1');
  if (!committed) {
    await sendPrivateAction(
      dao,
      '1',
      'commitepoch',
      {
        ...actor,
        epoch: '1',
        commitment: setup.epochCommitment,
        self_grant: JSON.stringify(setup.selfGrant),
      },
      true,
    );
    content = await api.content(dao.daoId);
    check();
  }
  if (
    content.epochs.find((row) => row.epoch === '1')?.commitment !== setup.epochCommitment ||
    !content.keyGrants.some(
      (row) =>
        row.epoch === '1' &&
        row.recipient === '1' &&
        row.envelope === JSON.stringify(setup.selfGrant),
    )
  )
    throw Error('PRIVATE_INITIALIZATION_CHANGED');
  const staged = async (
    value: PrivateRecordPayload,
    documentId: string,
    attached: PrivateRecordReference | null,
  ) => {
    const records = await api.content(dao.daoId);
    check();
    if (attached) {
      if (attached.documentId !== documentId) throw Error('PRIVATE_INITIALIZATION_CHANGED');
      const opened = await readPrivateRecord(dao, '1', attached, records, value);
      check();
      if (JSON.stringify(opened) !== JSON.stringify(value))
        throw Error('PRIVATE_INITIALIZATION_CHANGED');
      return attached;
    }
    if (
      reprepare &&
      ((await pendingPrivateRecord(dao, '1', records)) ||
        records.documents.some((row) => row.document_id === documentId))
    ) {
      const prepared = await repreparePrivateRecord(dao, '1', value, documentId);
      check();
      if (JSON.stringify(prepared.payload) !== JSON.stringify(value))
        throw Error('PRIVATE_INITIALIZATION_CHANGED');
      return prepared.reference;
    }
    return publishPrivateRecord(dao, '1', documentId, 1, value, true);
  };
  const snapshot = await api.privateIdentity(dao);
  check();
  const metadata = PrivateMetadataSchema.parse(snapshot.metadata);
  const reference = await staged(payload, setup.documentId, metadata.privateIdentity);
  check();
  if (metadata.privateIdentity) {
    if (JSON.stringify(metadata.privateIdentity) !== JSON.stringify(reference))
      throw Error('PRIVATE_METADATA_CHANGED');
  } else {
    const current = await api.dao(dao.daoId);
    check();
    if (reference.keyEpoch !== current.keyEpoch) throw Error('PRIVATE_EPOCH_CHANGED');
    await sendPrivateAction(
      dao,
      '1',
      'setmeta',
      {
        ...actor,
        metadata: JSON.stringify({ ...metadata, privateIdentity: reference }),
        expected: snapshot.metadataCommitment,
      },
      true,
    );
  }
  const published = await api.privateIdentity(dao);
  check();
  if (JSON.stringify(published.reference) !== JSON.stringify(reference))
    throw Error('PRIVATE_RECORD_PENDING');
  if (setup.agentDescription) {
    const payload = await openPrivateFounderAgent(dao, setup, order.setup);
    check();
    const saved = await api.privateAgent(dao, '1');
    check();
    const reference = await staged(payload, setup.agentDescription.documentId, saved.reference);
    check();
    if (saved.reference) {
      if (JSON.stringify(saved.reference) !== JSON.stringify(reference))
        throw Error('PRIVATE_INITIALIZATION_CHANGED');
    } else
      await sendPrivateAction(
        dao,
        '1',
        'setagentdesc',
        {
          ...actor,
          subject: '1',
          reference: {
            document_id: reference.documentId,
            version: reference.version,
            commitment: reference.commitment,
            key_epoch: reference.keyEpoch,
          },
        },
        true,
      );
    const installed = await api.privateAgent(dao, '1');
    check();
    if (JSON.stringify(installed.reference) !== JSON.stringify(reference))
      throw Error('PRIVATE_RECORD_PENDING');
  }
}
