import { expect, it } from 'vitest';
import { PrivateKey } from '@wharfkit/antelope';
import { DaoContentSchema, type DaoContent } from '@daclify/core-protocol';
import { planPrivateAccess, privateSuccessors } from '../../src/auth/private-access';

const dao = { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 };
function member(id: string, join = '1', admin = false, active = true, custody = 0) {
  return {
    id,
    native_account: '',
    signing_key: PrivateKey.generate('K1').toPublic().toString(),
    encryption_key: '{}',
    custody,
    nonce: '0',
    credits: '0',
    active,
    admin,
    reviewer: false,
    stake: '0',
    claim: '0',
    join_epoch: join,
  };
}
function grant(id: string, epoch: string, recipient: string) {
  return { id, epoch, recipient, grantor: '1', envelope: '{}' };
}
function records(): DaoContent {
  return DaoContentSchema.parse({
    dao,
    documents: [],
    members: [
      member('1', '1', true),
      member('2', '2', true),
      member('3', '1', false, false),
      member('4', '1', false, true, 1),
    ],
    epochs: [
      { epoch: '1', commitment: '11'.repeat(32), creator: '1' },
      { epoch: '2', commitment: '22'.repeat(32), creator: '1' },
    ],
    keyGrants: [grant('1', '1', '1'), grant('2', '2', '1')],
  });
}
it('prepares only missing, eligible member grants and never invents keys the administrator lacks', () => {
  const content = records();
  expect(
    planPrivateAccess(content, '1', 'full-history', 'encrypted-user-controlled').grants.map((g) => [
      g.recipient.id,
      g.epoch,
    ]),
  ).toEqual([
    ['2', '1'],
    ['2', '2'],
  ]);
  content.keyGrants = [grant('1', '2', '1'), grant('2', '2', '2')];
  const plan = planPrivateAccess(content, '1', 'full-history', 'encrypted-user-controlled');
  expect(plan.grants).toEqual([]);
  expect(plan.pending).toEqual([
    { recipient: '1', epoch: '1' },
    { recipient: '2', epoch: '1' },
  ]);
});
it('obeys from-join history and managed-custody policy, including large numeric epochs', () => {
  const content = records();
  expect(
    planPrivateAccess(content, '1', 'from-join', 'encrypted-managed-allowed').grants.map((g) => [
      g.recipient.id,
      g.epoch,
    ]),
  ).toEqual([
    ['2', '2'],
    ['4', '1'],
    ['4', '2'],
  ]);
  const first = content.epochs[0],
    second = content.epochs[1],
    recipient = content.members[1];
  if (!first || !second || !recipient) throw new Error('Missing private-access fixture');
  first.epoch = '9007199254740992';
  second.epoch = '9007199254740993';
  recipient.join_epoch = '9007199254740993';
  content.keyGrants = [grant('1', '9007199254740992', '1'), grant('2', '9007199254740993', '1')];
  expect(
    planPrivateAccess(content, '1', 'from-join', 'encrypted-user-controlled').grants.map(
      (g) => g.epoch,
    ),
  ).toEqual(['9007199254740993']);
});
it('requires an active administrator with every recorded epoch grant for succession', () => {
  const content = records();
  expect(privateSuccessors(content, '1')).toEqual([]);
  content.keyGrants.push(grant('3', '1', '2'), grant('4', '2', '2'));
  expect(privateSuccessors(content, '1').map((m) => m.id)).toEqual(['2']);
  const recipient = content.members[1];
  if (!recipient) throw new Error('Missing successor fixture');
  recipient.active = false;
  expect(privateSuccessors(content, '1')).toEqual([]);
});
