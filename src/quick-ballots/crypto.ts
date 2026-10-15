import { z } from 'zod';
import {
  QuickBallotSnapshotSchema,
  QuickBallotResultInputSchema,
  QuickBallotArchiveSchema,
} from '@daclify/modules';
import { recoverQuickBallotHistory } from '@daclify/modules/archive';
import {
  quickTallyContext,
  verifyQuickBallotSnapshot,
  verifyQuickBallotResult,
  QuickBallotTableSchemas,
} from '@daclify/modules/quick-ballots';
import {
  createBallotKey,
  encryptBallotChoice,
  decryptBallotChoice,
  proveBallotTally,
} from '@daclify/modules/quick-ballot-proof';
const hash = z.string().regex(/^[0-9a-f]{64}$/),
  key = z.string().regex(/^[0-9a-f]{192}$/);
export const QuickCryptoInputSchema = z.discriminatedUnion('task', [
  z.strictObject({ task: z.literal('key'), context: hash }),
  z.strictObject({ task: z.literal('inspect'), detail: QuickBallotResultInputSchema }),
  z.strictObject({
    task: z.literal('vote'),
    context: hash,
    key,
    choice: z.union([z.literal(0), z.literal(1)]),
  }),
  z.strictObject({
    task: z.literal('tally'),
    snapshot: QuickBallotSnapshotSchema,
    secret: hash,
    archives: z.array(QuickBallotArchiveSchema).max(2).default([]),
    grants: QuickBallotTableSchemas.qgrants.nullable().default(null),
  }),
]);
export const QuickCryptoOutputSchema = z.discriminatedUnion('task', [
  z.strictObject({
    task: z.literal('inspect'),
    result: z
      .strictObject({
        up: z.int().min(0).max(5000),
        down: z.int().min(0).max(5000),
        count: z.int().min(0).max(5000),
      })
      .nullable(),
  }),
  z.strictObject({
    task: z.literal('key'),
    secret: hash,
    publicKey: key,
    proof: z.string().regex(/^[0-9a-f]{128}$/),
  }),
  z.strictObject({
    task: z.literal('vote'),
    ciphertext: z.string().regex(/^[0-9a-f]{384}$/),
    proof: z.string().regex(/^[0-9a-f]{256}$/),
  }),
  z.strictObject({
    task: z.literal('tally'),
    up: z.int().min(0).max(5000),
    down: z.int().min(0).max(5000),
    proof: z.string().regex(/^[0-9a-f]{128}$/),
  }),
]);
export const QuickCryptoProgressSchema = z.strictObject({
  kind: z.literal('progress'),
  stage: z.enum(['verify', 'decrypt', 'prove']),
  done: z.int().min(0).max(5000),
  total: z.int().min(0).max(5000),
});
export function runQuickCrypto(
  value: unknown,
  progress: (value: z.infer<typeof QuickCryptoProgressSchema>) => void = () => {},
) {
  const input = QuickCryptoInputSchema.parse(value);
  if (input.task === 'inspect')
    return QuickCryptoOutputSchema.parse({
      task: 'inspect',
      result: verifyQuickBallotResult(input.detail),
    });
  if (input.task === 'key')
    return QuickCryptoOutputSchema.parse({ task: 'key', ...createBallotKey(input.context) });
  if (input.task === 'vote')
    return QuickCryptoOutputSchema.parse({
      task: 'vote',
      ...encryptBallotChoice(input.context, input.key, input.choice),
    });
  progress({ kind: 'progress', stage: 'verify', done: 0, total: input.snapshot.responses.length });
  const snapshot = input.archives.length
      ? recoverQuickBallotHistory({
          ...input.snapshot,
          archives: input.archives,
          grants: input.grants,
        }).snapshot
      : verifyQuickBallotSnapshot(input.snapshot),
    { ballot } = snapshot;
  let up = 0,
    read = 0;
  for (const response of snapshot.responses) {
    if (response.active) up += decryptBallotChoice(input.secret, response.ciphertext);
    ++read;
    if (read % 25 === 0)
      progress({
        kind: 'progress',
        stage: 'decrypt',
        done: read,
        total: snapshot.responses.length,
      });
  }
  progress({ kind: 'progress', stage: 'prove', done: read, total: read });
  const context = quickTallyContext({
    chainId: snapshot.chainId,
    runtime: snapshot.runtime,
    ballotId: ballot.id,
    definitionHash: ballot.definition_hash,
    root: ballot.response_root,
    count: String(ballot.count),
    aggregate: ballot.aggregate,
  });
  const proof = proveBallotTally(
    context,
    input.secret,
    ballot.aggregate,
    BigInt(ballot.count),
    BigInt(up),
  );
  verifyQuickBallotResult({
    chainId: snapshot.chainId,
    runtime: snapshot.runtime,
    source: snapshot.source,
    ballot: { ...ballot, up, final_proof: proof, verified: true },
  });
  return QuickCryptoOutputSchema.parse({ task: 'tally', up, down: ballot.count - up, proof });
}
