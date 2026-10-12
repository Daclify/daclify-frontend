import { expect, it } from 'vitest';
import { RecoveryKitSchema, ProfileContextSchema } from '@daclify/core-protocol';
import { decryptProfile } from '@daclify/core-protocol/profiles';
import {
  createVault,
  recoverVault,
  unlockVault,
  sealProfileForAudience,
  openProfileWithGrant,
} from '../../src/auth/vault';
const password = 'synthetic profile recovery password';
const context = () =>
  ProfileContextSchema.parse({
    version: 2,
    chainId: 'ab'.repeat(32),
    runtime: 'daclifycore',
    daoId: '1',
    memberId: '1',
    profileRevision: crypto.randomUUID(),
  });
it('uses the existing single kit and a surviving owner envelope to recover encrypted profile contents', async () => {
  const vault = await createVault(password);
  const kit = RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: vault.localEnvelope,
    recoveryEnvelope: vault.recoveryEnvelope,
    signingPublicKey: vault.signingPublicKey,
    encryptionPublicKey: vault.encryptionPublicKey,
  });
  const prepared = await sealProfileForAudience(
    new TextEncoder().encode('synthetic private profile'),
    context(),
    vault.encryptionPublicKey,
  );
  expect(prepared.grants).toHaveLength(1);
  const grant = prepared.grants[0];
  if (!grant) throw new Error('FIXTURE_GRANT');
  const recovered = await recoverVault(kit.recoveryEnvelope, vault.recoveryCredential);
  expect(
    new TextDecoder().decode(
      await openProfileWithGrant(prepared.cipher, grant, recovered.encryptionPrivateKey),
    ),
  ).toBe('synthetic private profile');
  expect(RecoveryKitSchema.parse(kit)).toEqual(kit);
  expect(Object.keys(kit).sort()).toEqual([
    'encryptionPublicKey',
    'localEnvelope',
    'recoveryEnvelope',
    'signingPublicKey',
    'version',
  ]);
});
it('cannot reconstruct a deleted random profile key from the same kit and chain ciphertext', async () => {
  const vault = await createVault(password);
  const prepared = await sealProfileForAudience(
    new TextEncoder().encode('synthetic deleted profile'),
    context(),
    vault.encryptionPublicKey,
  );
  const secrets = await unlockVault(vault.localEnvelope, password);
  const grant = prepared.grants[0];
  if (!grant) throw new Error('FIXTURE_GRANT');
  expect(
    await openProfileWithGrant(prepared.cipher, grant, secrets.encryptionPrivateKey),
  ).toBeTruthy();
  prepared.grants.splice(0);
  const recovered = await recoverVault(vault.recoveryEnvelope, vault.recoveryCredential);
  const scalar = Uint8Array.from(
    atob(recovered.encryptionPrivateKey.d.replaceAll('-', '+').replaceAll('_', '/')),
    (character) => character.charCodeAt(0),
  );
  await expect(decryptProfile(prepared.cipher, scalar, prepared.cipher.context)).rejects.toThrow(
    'PROFILE_DECRYPTION',
  );
  await expect(
    openProfileWithGrant(prepared.cipher, undefined, recovered.encryptionPrivateKey),
  ).rejects.toThrow('PROFILE_KEY_UNAVAILABLE');
});
it('defaults to the owner and admits only explicitly selected distinct keys within the recipient bound', async () => {
  const owner = await createVault(password),
    recipient = await createVault(password);
  const ctx = context();
  const prepared = await sealProfileForAudience(
    new TextEncoder().encode('selected audience'),
    ctx,
    owner.encryptionPublicKey,
    [owner.encryptionPublicKey, recipient.encryptionPublicKey],
  );
  expect(prepared.grants).toHaveLength(2);
  const grant = prepared.grants.find(
    (value) => value.recipientEncryptionKey.x === recipient.encryptionPublicKey.x,
  );
  const secret = await unlockVault(recipient.localEnvelope, password);
  expect(
    new TextDecoder().decode(
      await openProfileWithGrant(prepared.cipher, grant, secret.encryptionPrivateKey),
    ),
  ).toBe('selected audience');
  const ownerGrant = prepared.grants[0];
  if (!ownerGrant) throw new Error('FIXTURE_GRANT');
  await expect(
    openProfileWithGrant(prepared.cipher, ownerGrant, secret.encryptionPrivateKey),
  ).rejects.toThrow('PROFILE_KEY_CONTEXT');
});
