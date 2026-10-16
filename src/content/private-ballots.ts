import type { DaoContent } from '@daclify/core-protocol';
import {
  readBallotMetadata,
  verifyBallotDefinition,
  prepareBallotVote,
} from '@daclify/modules/sdk';
import { readPrivateRecord } from './private-records';
export async function readPrivateBallot(
  input: Parameters<typeof verifyBallotDefinition>[0] & { memberId: string; records: DaoContent },
) {
  verifyBallotDefinition(input);
  const reference = readBallotMetadata(input.ballot.metadata, input.ballot.choices)?.privateContent;
  if (!reference) throw Error('PRIVATE_BALLOT_CONTEXT');
  const payload = await readPrivateRecord(input.dao, input.memberId, reference, input.records, {
    kind: 'ballot-content',
    source: input.decide,
    recordId: input.ballot.id,
  });
  if (payload.kind !== 'ballot-content') throw Error('PRIVATE_BALLOT_CONTEXT');
  const reviewed = { reference, payload };
  prepareBallotVote({ ...input, choice: 0, privateContent: reviewed });
  return reviewed;
}
export type PrivateBallotRead = Awaited<ReturnType<typeof readPrivateBallot>>;
