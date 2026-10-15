import { expect, it } from 'vitest';
import { quickBallotFixture } from '../helpers/quick-ballot';
import { quickArchiveFixture } from '../helpers/quick-archive';
import { archivedQuickGrants } from '../../src/quick-ballots/archive';
it('recovers the fixed readers encrypted key grants without needing live vote rows', () => {
  const f = quickBallotFixture(true),
    archives = quickArchiveFixture(f),
    detail = { chainId: f.chainId, runtime: f.runtime, source: f.source, ballot: f.ballot };
  expect(archivedQuickGrants(detail, archives)).toEqual({
    id: f.ballot.id,
    dao_id: f.ballot.dao_id,
    grants: ['ab'],
  });
  expect(() => archivedQuickGrants({ ...detail, source: 'different' }, archives)).toThrow(
    'QUICK_ARCHIVE_DOMAIN',
  );
  expect(() =>
    archivedQuickGrants(
      detail,
      archives.map((value) => ({ ...value, anchor: { ...value.anchor, revoked: true } })),
    ),
  ).toThrow('QUICK_ARCHIVE_DOMAIN');
});
