import { expect, it } from 'vitest';
import { Checksum256, Name } from '@wharfkit/antelope';
import {
  createArchiveManifest,
  encodeArchiveManifest,
  archiveSourceSchema,
  verifyArchiveBundle,
} from '@daclify/modules/archive';
const source = archiveSourceSchema('ordinary-poll-votes');
function fixture() {
  const manifest = createArchiveManifest({
    schemaVersion: 1,
    dao: { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
    source: { account: 'decide', codeHash: source.codeHash, abiHash: source.rawAbiHash },
    snapshot: {
      blockNumber: 1,
      blockId: '00000001' + 'ab'.repeat(28),
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    families: [
      {
        kind: 'ordinary-poll-votes',
        parentId: '7',
        table: 'votes',
        scope: Name.from('daclifycore').value.toString(),
        schemaHash: source.schemaHash,
        records: '0',
        chunks: [],
      },
    ],
    files: [],
  });
  const bytes = encodeArchiveManifest(manifest);
  return {
    id: '00000000-0000-4000-8000-000000000001',
    manifest,
    manifestFile: {
      cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      bytes: bytes.length,
      commitment: Checksum256.hash(bytes).toString(),
      content: Buffer.from(bytes).toString('base64'),
    },
    chunks: [],
  };
}
it('verifies a standalone empty-poll recovery bundle without database access', () => {
  const bundle = fixture();
  expect(verifyArchiveBundle(bundle, bundle.manifestFile.commitment)).toEqual(bundle);
});
it('rejects corrupt manifest bytes, mismatched metadata and incomplete chunk coverage', () => {
  const bundle = fixture();
  expect(() =>
    verifyArchiveBundle(
      {
        ...bundle,
        manifestFile: {
          ...bundle.manifestFile,
          content: Buffer.from('corrupt').toString('base64'),
        },
      },
      bundle.manifestFile.commitment,
    ),
  ).toThrow();
  expect(() =>
    verifyArchiveBundle(
      {
        ...bundle,
        manifest: { ...bundle.manifest, dao: { ...bundle.manifest.dao, daoId: '2' } },
      },
      bundle.manifestFile.commitment,
    ),
  ).toThrow();
  expect(() =>
    verifyArchiveBundle(
      {
        ...bundle,
        chunks: [
          { cid: bundle.manifestFile.cid, content: Buffer.from('unexpected').toString('base64') },
        ],
      },
      bundle.manifestFile.commitment,
    ),
  ).toThrow('ARCHIVE_CONTENTS_INCOMPLETE');
});
