import { expect, it } from 'vitest';
import { GovernanceStateSchema } from '@daclify/core-protocol';
import { PrivateKey } from '@wharfkit/antelope';
import { executiveStatus } from '../../src/auth/executives';
const key = PrivateKey.generate('K1').toPublic().toString();
const reference = {
  chainId: 'ab'.repeat(32),
  contract: 'daclifycore',
  daoId: '1',
  interfaceVersion: 1,
};
function state(paired = 1) {
  return GovernanceStateSchema.parse({
    dao: reference,
    policy: null,
    actors: [],
    sessions: [],
    guardian: null,
    budget: null,
    executivePolicy: {
      dao_id: '1',
      inactivity_seconds: 60,
      quorum_bps: 10000,
      revision: '1',
      last_election_start: 0,
    },
    executives: [
      { member_id: '1', last_active: 100, office_epoch: '1', election_id: '0' },
      ...(paired === 2
        ? [{ member_id: '2', last_active: 100, office_epoch: '1', election_id: '0' }]
        : []),
    ],
    executiveMembers: Array.from({ length: paired }, (_, i) => ({
      id: String(i + 1),
      native_account: i === 0 ? 'alice' : 'bob',
      signing_key: key,
      encryption_key: 'key',
      custody: 0,
      nonce: '0',
      credits: '0',
      active: true,
      admin: i === 0,
      reviewer: false,
      stake: '0',
      claim: '0',
      join_epoch: '1',
    })),
    nativeGovernance: {
      dao_id: '1',
      contracts: [],
      service_key: key,
      handed_over: true,
      signers: paired === 2 ? ['alice', 'bob'] : ['alice'],
      threshold: paired,
      admin_members: Array.from({ length: paired }, (_, i) => String(i + 1)),
    },
  });
}
it('protects the final paired executive even after inactivity', () => {
  expect(executiveStatus(state(), '1', 200)).toMatchObject({
    lastPaired: true,
    pairedCount: 1,
    activeCount: 0,
  });
});
it('allows departure while another eligible paired executive remains', () => {
  expect(executiveStatus(state(2), '1', 110)).toMatchObject({
    lastPaired: false,
    pairedCount: 2,
    activeCount: 2,
  });
});
it('does not give ordinary members executive powers from pairing', () => {
  expect(executiveStatus(state(), '3', 110)).toMatchObject({
    lastPaired: false,
    office: undefined,
  });
});
it('keeps legacy DAOs usable without inventing executive roles', () => {
  const old = GovernanceStateSchema.parse({
    dao: reference,
    policy: null,
    actors: [],
    sessions: [],
    guardian: null,
    budget: null,
  });
  expect(executiveStatus(old, '1', 110)).toMatchObject({
    lastPaired: false,
    pairedCount: 0,
    activeCount: 0,
  });
});
