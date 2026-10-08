import { expect, it } from 'vitest';
import { ABI, Serializer } from '@wharfkit/antelope';
import { contentDomain, epochGrantDomain } from '@daclify/core-protocol';
import { RuntimeTableSchemas, runtimeAbi } from '@daclify/core-protocol/sdk';
import {
  archiveSourceSchema,
  buildArchiveTree,
  encodeArchiveChunk,
  decodeArchiveChunk,
  decodeReleasedArchiveRow,
} from '@daclify/modules/archive';
import {
  createVault,
  recoverVault,
  createEpochGrant,
  openCommittedEpoch,
  sha256Hex,
} from '../../src/auth/vault';
import {
  preparePrivateFile,
  decodeStoredBytes,
  verifyStoredFile,
  openPrivateFile,
} from '../../src/content/files';
it('decrypts a verified archived private file with the original recovered kit and rejects replacement keys, another grant domain and damaged bytes', async () => {
  const dao = {
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1 as const,
  };
  const original = await createVault('archive original disposable password'),
    replacement = await createVault('archive replacement disposable password');
  const epoch = crypto.getRandomValues(new Uint8Array(32)),
    commitment = await sha256Hex(epoch),
    grantDomain = epochGrantDomain(dao, '3', '1');
  const grant = await createEpochGrant(original.encryptionPublicKey, epoch, grantDomain),
    domain = contentDomain(dao, '7', 2, '3');
  const plaintext = new TextEncoder().encode('Private archived agreement'),
    metadata = { version: 1 as const, filename: 'private-agreement.txt', mediaType: 'text/plain' };
  const prepared = await preparePrivateFile(plaintext, metadata, epoch, domain),
    stored = decodeStoredBytes(prepared.content);
  const document = RuntimeTableSchemas.documents.parse({
    id: '5',
    document_id: '7',
    version: 2,
    author: '1',
    cid: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    metadata: '{}',
    commitment: prepared.commitment,
    bytes: prepared.bytes,
    envelope_version: 1,
    key_epoch: '3',
  });
  const source = archiveSourceSchema('document-versions'),
    archiveDomain = {
      format_version: 1 as const,
      chain_id: dao.chainId,
      runtime: dao.contract,
      dao_id: dao.daoId,
      source: dao.contract,
      code_hash: source.codeHash,
      abi_hash: source.rawAbiHash,
      schema_hash: source.schemaHash,
      table: 'documents',
      scope: dao.daoId,
      chunk_ordinal: 0,
      leaf_count: 1,
    };
  const rows = [
      {
        primaryKey: document.id,
        packed: Serializer.encode({
          abi: ABI.from(runtimeAbi),
          type: source.rowType,
          object: document,
        }).hexString,
      },
    ],
    tree = buildArchiveTree(archiveDomain, rows),
    chunk = encodeArchiveChunk(archiveDomain, rows);
  const verified = decodeArchiveChunk(chunk, archiveDomain, tree.root),
    recoveredRow = verified[0];
  if (!recoveredRow) throw new Error('Missing verified document');
  const decoded = decodeReleasedArchiveRow(archiveDomain, recoveredRow, document.document_id);
  if (decoded.kind !== 'document-versions') throw new Error('Wrong recovered family');
  const restoredDocument = RuntimeTableSchemas.documents.parse(decoded.value);
  expect(restoredDocument).toEqual(document);
  await verifyStoredFile(restoredDocument, stored);
  const keys = await recoverVault(original.recoveryEnvelope, original.recoveryCredential),
    key = await openCommittedEpoch(keys.encryptionPrivateKey, grant, grantDomain, commitment);
  expect(await openPrivateFile(stored, key, domain)).toEqual({ metadata, bytes: plaintext });
  // A former member retaining the old kit still possesses the original decryption key.
  expect(
    await openCommittedEpoch(keys.encryptionPrivateKey, grant, grantDomain, commitment),
  ).toEqual(epoch);
  const replacementKeys = await recoverVault(
    replacement.recoveryEnvelope,
    replacement.recoveryCredential,
  );
  await expect(
    openCommittedEpoch(replacementKeys.encryptionPrivateKey, grant, grantDomain, commitment),
  ).rejects.toThrow();
  await expect(
    openCommittedEpoch(
      keys.encryptionPrivateKey,
      grant,
      epochGrantDomain(dao, '3', '2'),
      commitment,
    ),
  ).rejects.toThrow();
  const damaged = stored.slice();
  damaged[damaged.length - 1] = (damaged.at(-1) ?? 0) ^ 1;
  await expect(verifyStoredFile(restoredDocument, damaged)).rejects.toThrow('DOCUMENT_INTEGRITY');
  const corruptChunk = chunk.slice();
  corruptChunk[corruptChunk.length - 1] = (corruptChunk.at(-1) ?? 0) ^ 1;
  expect(() => decodeArchiveChunk(corruptChunk, archiveDomain, tree.root)).toThrow();
});
