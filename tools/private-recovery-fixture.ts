// Owned integration fixture: secret kit stays in a mode-0600 file, never stdout or process arguments.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { PrivateKey } from '@wharfkit/antelope';
import {
  DaoRefSchema,
  RecoveryKitSchema,
  contentDomain,
  epochGrantDomain,
} from '@daclify/core-protocol';
import {
  RuntimeTableSchemas,
  RuntimeActionSchemas,
  instructionDigest,
} from '@daclify/core-protocol/sdk';
import {
  createVault,
  recoverVault,
  createEpochGrant,
  openCommittedEpoch,
  sha256Hex,
} from '../src/auth/vault';
import {
  preparePrivateFile,
  decodeStoredBytes,
  verifyStoredFile,
  openPrivateFile,
} from '../src/content/files';
const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
const args = z
  .object({ mode: z.enum(['prepare', 'sign', 'verify']), directory: z.string(), dao: DaoRefSchema })
  .parse(input);
const directory = resolve(args.directory);
if (!directory.includes('/daclify-native-restore-'))
  throw new Error('OWNED_PRIVATE_FIXTURE_REQUIRED');
const path = resolve(directory, 'private-kit.json'),
  plaintext = new TextEncoder().encode('Native recovery drill private agreement');
if (args.mode === 'prepare') {
  const vault = await createVault('disposable recovery fixture password');
  const epoch = crypto.getRandomValues(new Uint8Array(32)),
    commitment = await sha256Hex(epoch);
  const grant = await createEpochGrant(
    vault.encryptionPublicKey,
    epoch,
    epochGrantDomain(args.dao, '1', '1'),
  );
  const file = await preparePrivateFile(
    plaintext,
    { version: 1, filename: 'private-agreement.txt', mediaType: 'text/plain' },
    epoch,
    contentDomain(args.dao, '7', 1, '1'),
  );
  writeFileSync(
    path,
    JSON.stringify({
      kit: {
        version: 1,
        localEnvelope: vault.localEnvelope,
        recoveryEnvelope: vault.recoveryEnvelope,
        signingPublicKey: vault.signingPublicKey,
        encryptionPublicKey: vault.encryptionPublicKey,
      },
      credential: vault.recoveryCredential,
    }),
    { mode: 0o600, flag: 'wx' },
  );
  process.stdout.write(
    JSON.stringify({
      signingKey: vault.signingPublicKey,
      encryptionKey: vault.encryptionPublicKey,
      commitment,
      grant,
      file,
    }),
  );
} else {
  const saved = z
    .object({ kit: RecoveryKitSchema, credential: z.string() })
    .parse(JSON.parse(readFileSync(path, 'utf8')));
  const keys = await recoverVault(saved.kit.recoveryEnvelope, saved.credential);
  if (args.mode === 'sign') {
    const { request } = z
      .object({ request: RuntimeActionSchemas.submit.shape.request })
      .parse(input);
    assert.equal(request.chain_id, args.dao.chainId);
    assert.equal(request.deployment, args.dao.contract);
    assert.equal(request.dao_id, args.dao.daoId);
    process.stdout.write(
      JSON.stringify({
        signature: PrivateKey.from(keys.signingKey)
          .signDigest(instructionDigest(request))
          .toString(),
      }),
    );
  } else {
    const value = z
      .object({
        document: RuntimeTableSchemas.documents,
        epoch: RuntimeTableSchemas.epochs,
        grant: RuntimeTableSchemas.keygrants,
        content: z.string(),
      })
      .parse(input);
    assert.equal(value.document.key_epoch, value.epoch.epoch);
    assert.equal(value.grant.epoch, value.epoch.epoch);
    assert.equal(value.grant.recipient, '1');
    const key = await openCommittedEpoch(
      keys.encryptionPrivateKey,
      JSON.parse(value.grant.envelope),
      epochGrantDomain(args.dao, value.epoch.epoch, '1'),
      value.epoch.commitment,
    );
    const stored = decodeStoredBytes(value.content);
    await verifyStoredFile(value.document, stored);
    const opened = await openPrivateFile(
      stored,
      key,
      contentDomain(
        args.dao,
        value.document.document_id,
        value.document.version,
        value.document.key_epoch,
      ),
    );
    assert.deepEqual(opened.bytes, plaintext);
    assert.equal(opened.metadata.filename, 'private-agreement.txt');
    const replacement = await createVault('disposable replacement fixture password'),
      wrong = await recoverVault(replacement.recoveryEnvelope, replacement.recoveryCredential);
    await assert.rejects(() =>
      openCommittedEpoch(
        wrong.encryptionPrivateKey,
        JSON.parse(value.grant.envelope),
        epochGrantDomain(args.dao, value.epoch.epoch, '1'),
        value.epoch.commitment,
      ),
    );
    process.stdout.write(
      JSON.stringify({
        originalKitDecrypted: true,
        replacementKitRejected: true,
        plaintextBytes: plaintext.length,
      }),
    );
  }
}
