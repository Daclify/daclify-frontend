import { ABI, Bytes, Checksum256, Serializer } from '@wharfkit/antelope';
import { QuickBallotRowSchema, QuickBallotResponseSchema } from '@daclify/modules';
import {
  quickvoteAbi,
  quickBallotDefinitionHash,
  quickKeyContext,
  quickResponseContext,
} from '@daclify/modules/quick-ballots';
import {
  createBallotKey,
  encryptBallotChoice,
  addBallotCiphertexts,
} from '@daclify/modules/quick-ballot-proof';
function hash(parts: Uint8Array[]) {
  return Checksum256.hash(new Uint8Array(parts.flatMap((part) => [...part]))).toString();
}
const pack = (object: string, type: string) => Serializer.encode({ object, type }).array;
export function quickBallotFixture(closed = false, selectedDaos: string[] = []) {
  const domain = { chainId: '11'.repeat(32), runtime: 'daclifycore1', source: 'quickvote' },
    id = '7';
  const definition = {
    protocol: 1 as const,
    question: 'Should we plant more trees?',
    explanation: 'An advisory question.',
    all_accounts: selectedDaos.length === 0,
    audience: selectedDaos,
    closes: 0,
    readers: [{ member_id: '1', encryption_key: 'fixture-reader' }],
  };
  const definitionHash = quickBallotDefinitionHash({
      ...domain,
      ballotId: id,
      daoId: '1',
      creatorId: '1',
      definition,
    }),
    context = { chainId: domain.chainId, runtime: domain.runtime, ballotId: id, definitionHash };
  const key = createBallotKey(quickKeyContext(context));
  const responses = [0, 1].map((choice, index) => {
    const identity = String(index + 2).repeat(64),
      revision = '1';
    const encrypted = encryptBallotChoice(
      quickResponseContext({ ...context, identity, revision }),
      key.publicKey,
      choice,
    );
    return QuickBallotResponseSchema.parse({
      id: String(index + 1),
      dao_id: '1',
      ballot_id: id,
      identity,
      revision,
      active: true,
      ...encrypted,
      receipt: '',
      updated_at: 2,
    });
  });
  const aggregate = responses.reduce(
    (sum, row) => addBallotCiphertexts(sum, row.ciphertext),
    '00'.repeat(192),
  );
  let root = hash([
    pack('daclify.quick-ballot.responses.v1', 'string'),
    Bytes.from(domain.chainId).array,
    pack(domain.runtime, 'name'),
    pack(domain.source, 'name'),
    pack(id, 'uint64'),
    Bytes.from(definitionHash).array,
    pack('2', 'uint64'),
    pack(aggregate, 'bytes'),
    pack('2', 'uint64'),
  ]);
  for (const row of responses)
    root = hash([
      Bytes.from(root).array,
      Serializer.encode({ abi: ABI.from(quickvoteAbi), type: 'quick_response', object: row }).array,
    ]);
  const ballot = QuickBallotRowSchema.parse({
    id,
    dao_id: '1',
    creator_id: '1',
    opened_at: 1,
    definition,
    definition_hash: definitionHash,
    key: key.publicKey,
    key_proof: key.proof,
    aggregate,
    count: 2,
    identities: 2,
    closed_at: closed ? 3 : 0,
    scan_cursor: closed ? '2' : '0',
    scan_rows: closed ? 2 : 0,
    scan_count: closed ? 2 : 0,
    scan_aggregate: closed ? '' : '00'.repeat(192),
    response_root: closed ? root : '00'.repeat(32),
    prepared: closed,
    up: 0,
    final_proof: '00'.repeat(64),
    verified: false,
    pruned: false,
  });
  return { ...domain, ballot, responses, secret: key.secret };
}
