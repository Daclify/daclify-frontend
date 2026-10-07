import { expect, it } from 'vitest';
import { DaoSummarySchema, UserMembershipSchema } from '@daclify/core-protocol';
import { directoryQuery, filterDirectory } from '../../src/state/directory';
const reference = {
  chainId: 'ab'.repeat(32),
  contract: 'runtime',
  daoId: '1',
  interfaceVersion: 1,
};
const dao = DaoSummarySchema.parse({
  reference,
  title: 'Ocean',
  description: 'Shared work',
  privacy: 'public',
  owner: 'owner',
  token: { chainId: reference.chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  members: 1,
  available: '0',
  reserved: '0',
  claims: '0',
  keyEpoch: '0',
  purpose: 'community',
});
const member = UserMembershipSchema.parse({
  dao: reference,
  memberId: '1',
  nonce: '0',
  active: true,
  admin: false,
  reviewer: false,
  credits: '0',
  claim: '0',
  stake: '0',
  nativeAccount: '',
  custody: 'user-controlled',
});
it('matches complete active membership references and restores bounded URL filters', () => {
  expect(directoryQuery({ q: 'ocean', purpose: 'community', mine: '1', sort: 'members' })).toEqual({
    q: 'ocean',
    purpose: 'community',
    mine: true,
    sort: 'members',
  });
  expect(filterDirectory([dao], [member], directoryQuery({ mine: '1' }))).toEqual([dao]);
  for (const changed of [
    { active: false },
    { dao: { ...reference, chainId: 'cd'.repeat(32) } },
    { dao: { ...reference, contract: 'other' } },
  ])
    expect(
      filterDirectory(
        [dao],
        [UserMembershipSchema.parse({ ...member, ...changed })],
        directoryQuery({ mine: '1' }),
      ),
    ).toEqual([]);
  expect(filterDirectory([dao], [], directoryQuery({ q: 'work' }))).toEqual([dao]);
  expect(directoryQuery({ q: ['bad'], purpose: 'invented', sort: 'private' })).toEqual({
    q: '',
    purpose: '',
    mine: false,
    sort: 'name',
  });
});
