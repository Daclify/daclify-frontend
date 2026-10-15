import { expect, it } from 'vitest';
import { verifyBallotKey, verifyBallotChoice } from '@daclify/modules/quick-ballot-proof';
import { runQuickCrypto } from '../../src/quick-ballots/crypto';
import { quickBallotFixture } from '../helpers/quick-ballot';
import { quickArchiveFixture } from '../helpers/quick-archive';
it('generates real encryption and validity proofs in the worker implementation without returning plaintext choices', () => {
  const key = runQuickCrypto({ task: 'key', context: '11'.repeat(32) });
  if (key.task !== 'key') throw Error('FIXTURE_KEY');
  expect(verifyBallotKey('11'.repeat(32), key.publicKey, key.proof)).toBe(true);
  const vote = runQuickCrypto({
    task: 'vote',
    context: '22'.repeat(32),
    key: key.publicKey,
    choice: 1,
  });
  if (vote.task !== 'vote') throw Error('FIXTURE_VOTE');
  expect(verifyBallotChoice('22'.repeat(32), key.publicKey, vote.ciphertext, vote.proof)).toBe(
    true,
  );
  expect(vote).not.toHaveProperty('choice');
  expect(vote).not.toHaveProperty('secret');
  expect(() =>
    runQuickCrypto({ task: 'vote', context: '22'.repeat(32), key: key.publicKey, choice: 2 }),
  ).toThrow();
});
it('recovers pruned encrypted rows and proves a late tally against the permanent native header', () => {
  const f = quickBallotFixture(true),
    archives = quickArchiveFixture(f);
  const snapshot = {
    chainId: f.chainId,
    runtime: f.runtime,
    source: f.source,
    ballot: { ...f.ballot, pruned: true },
    responses: [],
  };
  expect(
    runQuickCrypto({ task: 'tally', snapshot, secret: f.secret, archives, grants: null }),
  ).toMatchObject({ task: 'tally', up: 1, down: 1 });
  expect(() =>
    runQuickCrypto({
      task: 'tally',
      snapshot: { ...snapshot, ballot: { ...snapshot.ballot, response_root: 'ff'.repeat(32) } },
      secret: f.secret,
      archives,
      grants: null,
    }),
  ).toThrow();
});

it('inspects the public key and refuses a substituted definition before enabling a vote', async () => {
  const { quickBallotFixture } = await import('../helpers/quick-ballot');
  const f = quickBallotFixture(),
    detail = { chainId: f.chainId, runtime: f.runtime, source: f.source, ballot: f.ballot };
  expect(runQuickCrypto({ task: 'inspect', detail })).toEqual({ task: 'inspect', result: null });
  expect(() =>
    runQuickCrypto({
      task: 'inspect',
      detail: {
        ...detail,
        ballot: {
          ...f.ballot,
          definition: { ...f.ballot.definition, question: 'Changed question' },
        },
      },
    }),
  ).toThrow('QUICK_DEFINITION');
});
it('verifies every current row and produces the actual public proof of one up and one down', async () => {
  const { quickBallotFixture } = await import('../helpers/quick-ballot');
  const f = quickBallotFixture(true),
    snapshot = {
      chainId: f.chainId,
      runtime: f.runtime,
      source: f.source,
      ballot: f.ballot,
      responses: f.responses,
    };
  const result = runQuickCrypto({ task: 'tally', snapshot, secret: f.secret });
  expect(result).toMatchObject({ task: 'tally', up: 1, down: 1 });
  expect(() =>
    runQuickCrypto({
      task: 'tally',
      snapshot: { ...snapshot, responses: snapshot.responses.slice(1) },
      secret: f.secret,
    }),
  ).toThrow('QUICK_SNAPSHOT');
  expect(() => runQuickCrypto({ task: 'tally', snapshot, secret: '11'.repeat(32) })).toThrow();
});
