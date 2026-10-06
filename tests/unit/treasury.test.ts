import { describe, it, expect } from 'vitest';
import { DaoSummarySchema, UserMembershipSchema } from '@daclify/core-protocol';
import { prepareExit, prepareExternalEvidence } from '../../src/content/treasury.js';
const dao = DaoSummarySchema.parse({
  reference: { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
  title: 'Treasury fixture',
  description: '',
  privacy: 'public',
  owner: 'alice',
  token: { chainId: 'ab'.repeat(32), contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  members: 1,
  available: '0',
  reserved: '0',
  claims: '9007199254740993',
  keyEpoch: '1',
});
const member = UserMembershipSchema.parse({
  dao: dao.reference,
  memberId: '1',
  nonce: '9',
  active: false,
  admin: false,
  reviewer: false,
  credits: '0',
  claim: '9007199254740993',
  stake: '10000',
  nativeAccount: '',
  custody: 'user-controlled',
});
describe('signed treasury exit preparation', () => {
  it('preserves integer precision and permits an inactive member to prepare an existing claim withdrawal', () => {
    const action = prepareExit(dao, member, 'withdraw', 'alice', '900719925474.0993');
    expect(action.quantity).toBe('900719925474.0993 TLOS');
    expect(action.member_id).toBe('1');
  });
  it('keeps stake and claim amounts separate', () => {
    expect(prepareExit(dao, member, 'unstake', 'bob', '1.0000').quantity).toBe('1.0000 TLOS');
    expect(() => prepareExit(dao, member, 'unstake', 'bob', '1.0001')).toThrow(
      'INSUFFICIENT_EXIT_BALANCE',
    );
  });
  it('rejects nonpositive amounts and the runtime as payout destination', () => {
    for (const amount of ['0', '-1'])
      expect(() => prepareExit(dao, member, 'withdraw', 'alice', amount)).toThrow();
    expect(() => prepareExit(dao, member, 'withdraw', 'daclifycore', '1')).toThrow(
      'PAYOUT_DESTINATION',
    );
  });
  it('records the obligation’s recipient and amount on an external statement', () => {
    const action = prepareExternalEvidence(
      dao,
      { ...member, admin: true },
      { id: '7', recipient: '2', quantity: '1.0000 TLOS', status: 1 },
      'telos',
      'payer.account',
      'cd'.repeat(32),
    );
    expect(action.obligation_id).toBe('7');
    expect(action.recipient).toBe('2');
    expect(action.quantity).toBe('1.0000 TLOS');
    expect(action.chain).toBe('telos');
    expect(() =>
      prepareExternalEvidence(
        dao,
        member,
        { id: '7', recipient: '2', quantity: '1.0000 TLOS', status: 1 },
        'telos',
        'alice',
        'cd'.repeat(32),
      ),
    ).toThrow('ADMIN_REQUIRED');
    expect(() =>
      prepareExternalEvidence(
        dao,
        { ...member, admin: true },
        { id: '7', recipient: '2', quantity: '1.0000 TLOS', status: 0 },
        'telos',
        'alice',
        'cd'.repeat(32),
      ),
    ).toThrow('EVIDENCE_STATE');
    expect(() =>
      prepareExternalEvidence(
        dao,
        { ...member, admin: true },
        { id: '7', recipient: '2', quantity: '1.0000 TLOS', status: 1 },
        'telos mainnet',
        'alice',
        'cd'.repeat(32),
      ),
    ).toThrow('EVIDENCE_CHAIN');
    expect(() =>
      prepareExternalEvidence(
        dao,
        { ...member, admin: true },
        { id: '7', recipient: '2', quantity: '1.0000 TLOS', status: 1 },
        'telos',
        'alice',
        'CD'.repeat(32),
      ),
    ).toThrow();
  });
  it('requires the matching complete DAO membership', () => {
    expect(() =>
      prepareExit(
        dao,
        { ...member, dao: { ...member.dao, contract: 'daclifytwo' } },
        'withdraw',
        'alice',
        '1',
      ),
    ).toThrow('DAO_REFERENCE');
  });
});
