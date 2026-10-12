import { it, expect } from 'vitest';
import { PrivateKey } from '@wharfkit/antelope';
import { DaoContentSchema, PrivateAccessPolicySchema } from '@daclify/core-protocol';
import { validatePrivateHandover } from '../../src/auth/private-handover';
const dao = { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 };
const member = (id: string, join = '1') => ({
  id,
  join_epoch: join,
  native_account: '',
  signing_key: PrivateKey.generate('K1').toPublic().toString(),
  encryption_key: '{}',
  custody: 0,
  nonce: '0',
  credits: '0',
  active: true,
  admin: true,
  reviewer: false,
  stake: '0',
  claim: '0',
});
const content = () =>
  DaoContentSchema.parse({
    dao,
    documents: [],
    members: [member('1'), member('2')],
    epochs: [{ epoch: '1', commitment: 'ab'.repeat(32), creator: '1' }],
    keyGrants: [{ id: '1', epoch: '1', recipient: '2', grantor: '1', envelope: '{}' }],
  });
const policy = () =>
  PrivateAccessPolicySchema.parse({
    dao,
    privacy: 'encrypted-user-controlled',
    historyPolicy: 'full-history',
    keyEpoch: '1',
  });
it('requires current complete context, an eligible successor and explicit recovery confirmation', () => {
  const c = content(),
    p = policy();
  expect(() => validatePrivateHandover(c, p, '1', '2', true)).not.toThrow();
  expect(() => validatePrivateHandover(c, p, '1', '2', false)).toThrow('PRIVATE_HANDOVER_REQUIRED');
  c.keyGrants = [];
  expect(() => validatePrivateHandover(c, p, '1', '2', true)).toThrow('PRIVATE_HANDOVER_REQUIRED');
});
it('refuses stale policy, truncated pages and forbidden earlier history', () => {
  const c = content(),
    p = policy();
  p.dao.daoId = '2';
  expect(() => validatePrivateHandover(c, p, '1', '2', true)).toThrow('PRIVATE_ACCESS_CONTEXT');
  p.dao.daoId = '1';
  c.next = { members: '2', documents: null, epochs: null, keyGrants: null };
  expect(() => validatePrivateHandover(c, p, '1', '2', true)).toThrow('PRIVATE_ACCESS_INCOMPLETE');
});
