import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EpochGrantSchema, ContentEnvelopeSchema } from '@daclify/core-protocol';
import { PrivateKey } from '@wharfkit/antelope';
import {
  createVault,
  generateVaultPassword,
  unlockVault,
  recoverVault,
  sealContent,
  openContent,
  createEpochGrant,
  openEpochGrant,
  restoreRecoveryKit,
  openCommittedEpoch,
} from '../../src/auth/vault.js';
const password = 'long disposable fixture password';
describe('user-controlled signing and encryption vault', () => {
  it('keeps signing and encryption keys separate and stores only authenticated ciphertext', async () => {
    const vault = await createVault(password);
    expect(vault.signingPublicKey).toMatch(/^PUB_K1_/);
    expect(JSON.stringify(vault.localEnvelope)).not.toContain('PVT_K1_');
    expect(vault.encryptionPublicKey.kty).toBe('EC');
    const secrets = await unlockVault(vault.localEnvelope, password);
    expect(PrivateKey.from(secrets.signingKey).toPublic().toString()).toBe(vault.signingPublicKey);
  });
  it('restores the same keys on a fresh device using only the recovery credential and encrypted backup', async () => {
    const vault = await createVault(password);
    const local = await unlockVault(vault.localEnvelope, password);
    const recovered = await recoverVault(vault.recoveryEnvelope, vault.recoveryCredential);
    expect(recovered).toEqual(local);
  });
  it('rejects social identity strings or a wrong password as recovery credentials', async () => {
    const vault = await createVault(password);
    await expect(unlockVault(vault.localEnvelope, 'wrong password')).rejects.toThrow(
      'VAULT_UNLOCK_FAILED',
    );
    await expect(recoverVault(vault.recoveryEnvelope, 'social-user-id')).rejects.toThrow(
      'VAULT_UNLOCK_FAILED',
    );
  });
  it('rejects ciphertext tampering', async () => {
    const vault = await createVault(password);
    const changed = {
      ...vault.localEnvelope,
      ciphertext: vault.localEnvelope.ciphertext.slice(0, -4) + 'AAAA',
    };
    await expect(unlockVault(changed, password)).rejects.toThrow('VAULT_UNLOCK_FAILED');
  });
  it('rejects weak local unlock passwords', async () => {
    await expect(createVault('short')).rejects.toThrow('Use at least 12 characters');
  });
  it('generates a vault password that can be copied and used to create the vault', async () => {
    const generated = generateVaultPassword();
    expect(generated).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(generateVaultPassword()).not.toBe(generated);
    const vault = await createVault(generated);
    expect(await unlockVault(vault.localEnvelope, generated)).toBeTruthy();
  });
});
describe('private DAO content and epoch grants', () => {
  it('authenticates ciphertext to its DAO/version domain', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await sealContent(
      new TextEncoder().encode('private report'),
      key,
      'dao-1:document-2:v1',
    );
    expect(new TextDecoder().decode(await openContent(encrypted, key, 'dao-1:document-2:v1'))).toBe(
      'private report',
    );
    await expect(openContent(encrypted, key, 'dao-2:document-2:v1')).rejects.toThrow();
  });
  it('uses fresh nonces for every document version', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const first = await sealContent(new Uint8Array([1]), key, 'dao:version1');
    const second = await sealContent(new Uint8Array([1]), key, 'dao:version1');
    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });
  it('grants an epoch key only to the named recipient encryption key', async () => {
    const alice = await createVault(password);
    const bob = await createVault(password);
    const a = await unlockVault(alice.localEnvelope, password);
    const b = await unlockVault(bob.localEnvelope, password);
    const epoch = crypto.getRandomValues(new Uint8Array(32));
    const grant = await createEpochGrant(
      alice.encryptionPublicKey,
      epoch,
      'dao-1:epoch-2:member-1',
    );
    expect(await openEpochGrant(a.encryptionPrivateKey, grant, 'dao-1:epoch-2:member-1')).toEqual(
      epoch,
    );
    await expect(
      openEpochGrant(b.encryptionPrivateKey, grant, 'dao-1:epoch-2:member-1'),
    ).rejects.toThrow();
    await expect(
      openEpochGrant(a.encryptionPrivateKey, grant, 'dao-1:epoch-2:member-2'),
    ).rejects.toThrow();
  });
  it('does not revoke already disclosed history when an epoch rotates', async () => {
    const old = crypto.getRandomValues(new Uint8Array(32));
    const next = crypto.getRandomValues(new Uint8Array(32));
    const history = await sealContent(new Uint8Array([42]), old, 'dao:old');
    const future = await sealContent(new Uint8Array([43]), next, 'dao:new');
    expect(await openContent(history, old, 'dao:old')).toEqual(new Uint8Array([42]));
    await expect(openContent(future, old, 'dao:new')).rejects.toThrow();
  });
});

describe('fresh-device encrypted recovery ceremony', () => {
  it('re-encrypts the same signing and document keys under a new local password', async () => {
    const vault = await createVault(password);
    const kit = {
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: vault.signingPublicKey,
      encryptionPublicKey: vault.encryptionPublicKey,
    };
    const restored = await restoreRecoveryKit(
      kit,
      vault.recoveryCredential,
      'a new local password 2026',
    );
    expect(restored.signingPublicKey).toBe(vault.signingPublicKey);
    expect(await unlockVault(restored.localEnvelope, 'a new local password 2026')).toEqual(
      await unlockVault(vault.localEnvelope, password),
    );
    expect(restored.recoveryEnvelope).toEqual(vault.recoveryEnvelope);
    await expect(unlockVault(restored.localEnvelope, password)).rejects.toThrow(
      'VAULT_UNLOCK_FAILED',
    );
  });
  it('rejects a kit advertising another account public key', async () => {
    const vault = await createVault(password);
    const kit = {
      version: 1,
      localEnvelope: vault.localEnvelope,
      recoveryEnvelope: vault.recoveryEnvelope,
      signingPublicKey: PrivateKey.generate('K1').toPublic().toString(),
      encryptionPublicKey: vault.encryptionPublicKey,
    };
    await expect(restoreRecoveryKit(kit, vault.recoveryCredential, password)).rejects.toThrow(
      'VAULT_UNLOCK_FAILED',
    );
  });
  it('rejects an unknown plaintext key field in a recovery kit', async () => {
    const vault = await createVault(password);
    await expect(
      restoreRecoveryKit(
        { ...vault, version: 1, privateKey: 'plaintext' },
        vault.recoveryCredential,
        password,
      ),
    ).rejects.toThrow('VAULT_UNLOCK_FAILED');
  });
});

describe('committed DAO epoch keys', () => {
  it('authenticates a recovered epoch key against its on-chain commitment', async () => {
    const vault = await createVault(password);
    const secrets = await unlockVault(vault.localEnvelope, password);
    const epoch = crypto.getRandomValues(new Uint8Array(32));
    const grant = await createEpochGrant(
      vault.encryptionPublicKey,
      epoch,
      'exact DAO epoch domain',
    );
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', epoch)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    expect(
      await openCommittedEpoch(
        secrets.encryptionPrivateKey,
        grant,
        'exact DAO epoch domain',
        digest,
      ),
    ).toEqual(epoch);
    await expect(
      openCommittedEpoch(
        secrets.encryptionPrivateKey,
        grant,
        'exact DAO epoch domain',
        '00'.repeat(32),
      ),
    ).rejects.toThrow('EPOCH_KEY_MISMATCH');
  });
});

it('opens surviving DAO ciphertext on a fresh device using the original encrypted kit and on-chain encrypted key grant', async () => {
  const original = await createVault(password);
  const epoch = crypto.getRandomValues(new Uint8Array(32));
  const grantDomain = 'dao-1:epoch-1:member-1',
    documentDomain = 'dao-1:document-1:version-1';
  const grant = await createEpochGrant(original.encryptionPublicKey, epoch, grantDomain);
  const ciphertext = await sealContent(
    new TextEncoder().encode('surviving private DAO record'),
    epoch,
    documentDomain,
  );
  const surviving = z
    .object({ grant: EpochGrantSchema, ciphertext: ContentEnvelopeSchema })
    .parse(JSON.parse(JSON.stringify({ grant, ciphertext })));
  const keys = await recoverVault(original.recoveryEnvelope, original.recoveryCredential);
  const restoredEpoch = await openEpochGrant(
    keys.encryptionPrivateKey,
    surviving.grant,
    grantDomain,
  );
  expect(
    new TextDecoder().decode(
      await openContent(surviving.ciphertext, restoredEpoch, documentDomain),
    ),
  ).toBe('surviving private DAO record');
  const replacement = await createVault(password);
  const replacementKeys = await unlockVault(replacement.localEnvelope, password);
  await expect(
    openEpochGrant(replacementKeys.encryptionPrivateKey, surviving.grant, grantDomain),
  ).rejects.toThrow();
});
