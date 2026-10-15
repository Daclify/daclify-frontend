import { describe, it, expect } from 'vitest';
import { encodeRecoveryCode, decodeRecoveryCode } from '../../src/auth/contact-recovery';
import { ContactRecoveryTargetSchema } from '@daclify/core-protocol';
const target = ContactRecoveryTargetSchema.parse({
  dao: { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
  memberId: '2',
});
describe('portable contact recovery codes', () => {
  it('validates context and rejects malformed, oversized and private material', () => {
    expect(decodeRecoveryCode(encodeRecoveryCode(target), ContactRecoveryTargetSchema)).toEqual(
      target,
    );
    for (const value of [
      '!',
      'a'.repeat(60001),
      encodeRecoveryCode({ ...target, signingKey: 'secret' }),
    ])
      expect(() => decodeRecoveryCode(value, ContactRecoveryTargetSchema)).toThrow();
  });
});

import {
  createVault,
  unlockVault,
  createEpochGrant,
  openCommittedEpoch,
  sealContent,
  openContent,
  sha256Hex,
  restoreRecoveryKit,
} from '../../src/auth/vault';
import {
  createContactDocumentPacket,
  openContactDocumentShare,
  recoverContactDocumentPacket,
} from '@daclify/core-protocol/sdk';
import { epochGrantDomain } from '@daclify/core-protocol';
it('restores a private document using two contacts and a replacement kit without the original personal key', async () => {
  const contacts = await Promise.all(
    [1, 2, 3].map(() => createVault('disposable independent contact vault')),
  );
  const keys = await Promise.all(
    contacts.map((v) => unlockVault(v.localEnvelope, 'disposable independent contact vault')),
  );
  const epoch = crypto.getRandomValues(new Uint8Array(32)),
    commitment = await sha256Hex(epoch);
  const plaintext = new TextEncoder().encode('Private DAO agreement');
  const cipher = await sealContent(plaintext, epoch, 'document fixture');
  const packet = await createContactDocumentPacket(
    { target, revision: '1', packetId: '1' },
    [{ epoch: '1', commitment, key: btoa(String.fromCharCode(...epoch)) }],
    contacts.map((v) => ({ signingKey: v.signingPublicKey, encryptionKey: v.encryptionPublicKey })),
  );
  const firstKey = keys[0],
    thirdKey = keys[2];
  if (!firstKey || !thirdKey) throw new Error('CONTACT_FIXTURE');
  const a = await openContactDocumentShare(packet, 0, firstKey.encryptionPrivateKey),
    b = await openContactDocumentShare(packet, 2, thirdKey.encryptionPrivateKey);
  const recovered = await recoverContactDocumentPacket(packet, [a, b]);
  const replacement = await createVault('disposable replacement document vault');
  const recoveredEpoch = recovered[0];
  if (!recoveredEpoch) throw new Error('CONTACT_FIXTURE');
  const raw = Uint8Array.from(atob(recoveredEpoch.key), (c) => c.charCodeAt(0));
  const domain = epochGrantDomain(target.dao, '1', '2'),
    grant = await createEpochGrant(replacement.encryptionPublicKey, raw, domain);
  const kit = await restoreRecoveryKit(
    {
      version: 1,
      localEnvelope: replacement.localEnvelope,
      recoveryEnvelope: replacement.recoveryEnvelope,
      signingPublicKey: replacement.signingPublicKey,
      encryptionPublicKey: replacement.encryptionPublicKey,
    },
    replacement.recoveryCredential,
    'disposable restored replacement password',
  );
  const restored = await unlockVault(kit.localEnvelope, 'disposable restored replacement password');
  const opened = await openCommittedEpoch(restored.encryptionPrivateKey, grant, domain, commitment);
  expect(await openContent(cipher, opened, 'document fixture')).toEqual(plaintext);
  await expect(
    openCommittedEpoch(
      restored.encryptionPrivateKey,
      grant,
      epochGrantDomain({ ...target.dao, daoId: '2' }, '1', '2'),
      commitment,
    ),
  ).rejects.toThrow();
  epoch.fill(0);
  raw.fill(0);
  opened.fill(0);
});
