import { ABI, Serializer, Checksum256 } from '@wharfkit/antelope';
import { CID } from 'multiformats/cid';
import { create } from 'multiformats/hashes/digest';
import {
  planQuickBallotArchive,
  archiveSourceSchema,
  encodeArchiveChunk,
  archiveManifestForPlan,
  encodeArchiveManifest,
  archiveAttestation,
  archiveRecoveryId,
} from '@daclify/modules/archive';
import { quickvoteAbi } from '@daclify/modules/quick-ballots';
import { QuickBallotArchiveSchema } from '@daclify/modules';
import type { quickBallotFixture } from './quick-ballot';

export function quickArchiveFixture(
  f: ReturnType<typeof quickBallotFixture>,
  readerGrants = ['ab'],
) {
  const grants = { id: f.ballot.id, dao_id: f.ballot.dao_id, grants: readerGrants };
  return (['quick-ballot-responses', 'quick-ballot-grants'] as const).map((kind) => {
    const schema = archiveSourceSchema(kind),
      type = kind === 'quick-ballot-responses' ? 'quick_response' : 'quick_grant';
    const rows = (kind === 'quick-ballot-responses' ? f.responses : [grants]).map((row) => ({
      primaryKey: row.id,
      packed: Serializer.encode({ abi: ABI.from(quickvoteAbi), type, object: row }).hexString,
    }));
    const plan = planQuickBallotArchive({
      dao: { chainId: f.chainId, contract: f.runtime, daoId: f.ballot.dao_id, interfaceVersion: 1 },
      source: { account: f.source, codeHash: schema.codeHash, abiHash: schema.rawAbiHash },
      sourceUpdatedAt: new Date(0).toISOString(),
      snapshot: {
        blockNumber: 1,
        blockId: '00000001' + 'ab'.repeat(28),
        timestamp: new Date((f.ballot.closed_at + 30 * 86400) * 1000).toISOString(),
      },
      kind,
      ballot: f.ballot,
      rows,
    });
    const chunks = plan.families
      .flatMap((family) => family.chunks)
      .map((chunk) => {
        const bytes = encodeArchiveChunk(chunk.domain, chunk.rows),
          digest = Checksum256.hash(bytes);
        return {
          cid: CID.createV1(0x55, create(0x12, digest.array)).toString(),
          bytes: bytes.length,
          commitment: digest.toString(),
          content: Buffer.from(bytes).toString('base64'),
        };
      });
    const manifest = archiveManifestForPlan(
        plan,
        chunks.map(({ cid, bytes, commitment }) => ({ cid, bytes, commitment })),
      ),
      bytes = encodeArchiveManifest(manifest),
      digest = Checksum256.hash(bytes);
    const bundle = {
      id: archiveRecoveryId(digest.toString()),
      manifest,
      manifestFile: {
        cid: CID.createV1(0x55, create(0x12, digest.array)).toString(),
        bytes: bytes.length,
        commitment: digest.toString(),
        content: Buffer.from(bytes).toString('base64'),
      },
      chunks: chunks.map(({ cid, content }) => ({ cid, content })),
    };
    const attestation = archiveAttestation(
      bundle,
      {
        formatVersion: 1,
        storeId: 'test-backup',
        keyId: 'fixture',
        commitment: '55'.repeat(32),
        manifestCommitment: digest.toString(),
        bytes: '4096',
        verifiedAt: plan.snapshot.timestamp,
      },
      90 * 86400,
    );
    return QuickBallotArchiveSchema.parse({
      bundle,
      anchor: {
        ...attestation,
        id: kind === 'quick-ballot-responses' ? '1' : '2',
        descriptor_commitment: manifest.descriptorCommitment,
        verifier: 'gateway',
        attestation_transaction: '44'.repeat(32),
        approval_transaction: '00'.repeat(32),
        attested_at: f.ballot.closed_at + 30 * 86400,
        approved_by: '0',
        approved_at: 0,
        revoked: false,
      },
    });
  });
}
