import {
  AccountSchema,
  PrivateMetadataSchema,
  daoPaymentKey,
  type CreationOrderView,
} from '@daclify/core-protocol';
import { api } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { recoveryContextGuard, vaultUnlocked } from '../auth/session';
import { openPrivateFounder } from './private-identity-setup';
import { publishPrivateRecord, sendPrivateAction } from './publish-private-record';

export async function installPrivateIdentity(order: CreationOrderView) {
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
  const reference = await publishPrivateRecord(dao, '1', setup.documentId, 1, payload, true);
  check();
  const snapshot = await api.privateIdentity(dao);
  check();
  const metadata = PrivateMetadataSchema.parse(snapshot.metadata);
  if (metadata.privateIdentity) {
    if (JSON.stringify(metadata.privateIdentity) !== JSON.stringify(reference))
      throw Error('PRIVATE_METADATA_CHANGED');
    return;
  }
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
  const published = await api.privateIdentity(dao);
  check();
  if (JSON.stringify(published.reference) !== JSON.stringify(reference))
    throw Error('PRIVATE_RECORD_PENDING');
}
