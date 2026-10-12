import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PublicProfileSchema, DaoRefSchema, type ProfileContext } from '@daclify/core-protocol';
import { Serializer } from '@wharfkit/antelope';
import { z } from 'zod';
import { runtimeAbi, RuntimeActionSchemas } from '@daclify/core-protocol/sdk';
import {
  createVault,
  unlockVault,
  sealProfileForAudience,
  openProfileWithGrant,
} from '../../src/auth/vault';
import { preparePrivateProfile, openPrivateProfile } from '../../src/auth/session';
import {
  prepareEncryptedProfile,
  encodeSetEncryptedProfile,
  emptyProfile,
  readProfileForAudience,
  encryptedProfileAllowed,
} from '../../src/auth/profile';
import { api } from '../../src/api/client';
vi.mock('../../src/auth/session', () => ({
  preparePrivateProfile: vi.fn(),
  openPrivateProfile: vi.fn(),
}));
const password = 'synthetic private profile password';
let owner: Awaited<ReturnType<typeof createVault>>;
let selected: Awaited<ReturnType<typeof createVault>>;
const context = (): ProfileContext => ({
  version: 2,
  chainId: 'ab'.repeat(32),
  runtime: 'daclifycore',
  daoId: '1',
  memberId: '1',
  profileRevision: crypto.randomUUID(),
});
const cid = 'bafkreiehxpuhtr5f6v4eu4byjo2j7kkrhjvd7psmfu4imnpdzb3bdqb7vy';
const draft = {
  ...emptyProfile(),
  name: 'alice',
  fullName: 'Synthetic private name',
  email: 'private@example.com',
  location: 'Synthetic private location',
  introduction: 'Synthetic private biography',
  avatar: cid,
};
beforeAll(async () => {
  owner = await createVault(password);
  selected = await createVault(password);
});
beforeEach(() => {
  vi.mocked(preparePrivateProfile).mockImplementation((plain, ctx, audience) =>
    sealProfileForAudience(plain, ctx, owner.encryptionPublicKey, audience),
  );
});
it('encrypts before signing with an owner-only default and omits image references by default', async () => {
  const prepared = await prepareEncryptedProfile(draft, context(), []);
  expect(prepared.grants).toHaveLength(1);
  const bytes = encodeSetEncryptedProfile('alice', prepared.cipher);
  const action = RuntimeActionSchemas.setencprof
    .extend({
      actor: RuntimeActionSchemas.setencprof.shape.actor.extend({
        dao_id: z.coerce.string(),
        member_id: z.coerce.string(),
      }),
    })
    .parse(
      Serializer.objectify(Serializer.decode({ data: bytes, abi: runtimeAbi, type: 'setencprof' })),
    );
  const payloads = JSON.stringify({ action, grants: prepared.grants });
  for (const value of [draft.fullName, draft.email, draft.location, draft.introduction, cid])
    expect(payloads).not.toContain(value);
  const secrets = await unlockVault(owner.localEnvelope, password);
  const plaintext = await openProfileWithGrant(
    prepared.cipher,
    prepared.grants[0],
    secrets.encryptionPrivateKey,
  );
  expect(PublicProfileSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)))).toEqual({
    name: draft.name,
    fullName: draft.fullName,
    email: draft.email,
    location: draft.location,
    introduction: draft.introduction,
  });
});
it('gives explicitly selected recipients this revision and excludes them from a new owner-only revision', async () => {
  const secrets = await unlockVault(selected.localEnvelope, password);
  const shared = await prepareEncryptedProfile(draft, context(), [selected.encryptionPublicKey]);
  const grant = shared.grants.find(
    (g) => g.recipientEncryptionKey.x === selected.encryptionPublicKey.x,
  );
  expect(
    await openProfileWithGrant(shared.cipher, grant, secrets.encryptionPrivateKey),
  ).toBeTruthy();
  const fresh = await prepareEncryptedProfile(draft, context(), []);
  expect(fresh.grants).toHaveLength(1);
  await expect(
    openProfileWithGrant(fresh.cipher, fresh.grants[0], secrets.encryptionPrivateKey),
  ).rejects.toThrow('PROFILE_KEY_CONTEXT');
  await expect(
    openProfileWithGrant(fresh.cipher, grant, secrets.encryptionPrivateKey),
  ).rejects.toThrow('PROFILE_KEY_CONTEXT');
});
it('includes image references only with explicit acknowledgement of the separate asset policy', async () => {
  const prepared = await prepareEncryptedProfile(draft, context(), [], true);
  const secrets = await unlockVault(owner.localEnvelope, password);
  const plaintext = await openProfileWithGrant(
    prepared.cipher,
    prepared.grants[0],
    secrets.encryptionPrivateKey,
  );
  expect(PublicProfileSchema.parse(JSON.parse(new TextDecoder().decode(plaintext))).avatar).toBe(
    cid,
  );
});
it('fails before preparing envelopes when profile validation fails or the vault is locked', async () => {
  await expect(
    prepareEncryptedProfile({ ...draft, name: '.alice' }, context(), []),
  ).rejects.toThrow();
  vi.mocked(preparePrivateProfile).mockRejectedValueOnce(new Error('VAULT_LOCKED'));
  await expect(prepareEncryptedProfile(draft, context(), [])).rejects.toThrow('VAULT_LOCKED');
  expect(vi.mocked(openPrivateProfile)).not.toHaveBeenCalled();
});

it('requires both verified capabilities before publication', () => {
  expect(encryptedProfileAllowed(undefined)).toBe(false);
  expect(encryptedProfileAllowed({ capabilities: ['encrypted-profiles-v2'] })).toBe(false);
  expect(encryptedProfileAllowed({ capabilities: ['profile-key-envelopes-v1'] })).toBe(false);
  expect(
    encryptedProfileAllowed({
      capabilities: ['encrypted-profiles-v2', 'profile-key-envelopes-v1'],
    }),
  ).toBe(true);
});
it('reads explicit legacy or authorized encrypted profiles and binds the native row before fetching a key', async () => {
  const prepared = await prepareEncryptedProfile(draft, context(), []),
    grant = prepared.grants[0];
  if (!grant) throw new Error('FIXTURE_GRANT');
  const keyFetch = vi.spyOn(api, 'profileKeys').mockResolvedValue(grant);
  const secrets = await unlockVault(owner.localEnvelope, password);
  vi.mocked(openPrivateProfile).mockImplementation((cipher, envelope) =>
    openProfileWithGrant(cipher, envelope, secrets.encryptionPrivateKey),
  );
  const dao = DaoRefSchema.parse({
    chainId: prepared.cipher.context.chainId,
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1,
  });
  try {
    expect(
      await readProfileForAudience(
        {
          accountName: 'alice',
          profile: JSON.stringify({ name: 'alice', fullName: 'Legacy public name' }),
        },
        dao,
        '1',
      ),
    ).toEqual({ name: 'alice', fullName: 'Legacy public name' });
    expect(keyFetch).not.toHaveBeenCalled();
    const row = { accountName: 'alice', profile: JSON.stringify(prepared.cipher) };
    await expect(readProfileForAudience(row, { ...dao, daoId: '2' }, '1')).rejects.toThrow(
      'PROFILE_CONTEXT',
    );
    expect(keyFetch).not.toHaveBeenCalled();
    expect((await readProfileForAudience(row, dao, '1'))?.fullName).toBe(draft.fullName);
    keyFetch.mockRejectedValueOnce(new Error('PROFILE_KEY_UNAVAILABLE'));
    await expect(readProfileForAudience(row, dao, '1')).rejects.toThrow('PROFILE_KEY_UNAVAILABLE');
    await expect(readProfileForAudience({ ...row, accountName: 'bob' }, dao, '1')).rejects.toThrow(
      'PROFILE_CONTEXT',
    );
  } finally {
    keyFetch.mockRestore();
  }
});
