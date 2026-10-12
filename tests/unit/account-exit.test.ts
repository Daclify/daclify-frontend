import { it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
beforeEach(() => setActivePinia(createPinia()));
import { buildExitIntent, newExitCapability, exitMembershipKey } from '../../src/auth/account-exit';
import { ExitPreflightSchema, ExitIntentSchema } from '@daclify/core-protocol';
const member = {
  reference: {
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '18446744073709551615',
    interfaceVersion: 1,
  },
  memberId: '1',
  nonce: '0',
  active: true,
  admin: true,
  claim: '100',
  stake: '200',
  nativeAccount: null,
  soleMember: true,
  lifecycle: 'active',
  reason: 'DAO_AVAILABLE',
};
const preflight = () =>
  ExitPreflightSchema.parse({
    version: 1,
    nativeAvailable: true,
    memberships: [member],
    limits: { memberships: 256, statusDays: 30 },
    retained: 'Required shared history',
  });
it('defaults to leaving and requires an explicit, current sole-member closure choice', () => {
  const p = preflight(),
    current = p.memberships[0];
  if (!current) throw Error('FIXTURE_MEMBER');
  const key = exitMembershipKey(current);
  expect(
    buildExitIntent(p, { mode: 'delete-account', memberships: {} }).memberships[0]?.choice,
  ).toBe('leave');
  expect(
    buildExitIntent(p, { mode: 'delete-account', memberships: { [key]: 'close' } }).memberships[0]
      ?.choice,
  ).toBe('close');
  current.soleMember = false;
  expect(() =>
    buildExitIntent(p, { mode: 'delete-account', memberships: { [key]: 'close' } }),
  ).toThrow('EXIT_SOLE_MEMBER_REQUIRED');
});
it('refuses a changed context and preserves large native IDs', () => {
  const p = preflight();
  expect(() => buildExitIntent(p, { mode: 'leave-all', memberships: { old: 'close' } })).toThrow(
    'EXIT_MEMBERSHIP_CHANGED',
  );
  expect(
    ExitIntentSchema.parse(buildExitIntent(p, { mode: 'leave-all', memberships: {} }))
      .memberships[0]?.daoId,
  ).toBe(member.reference.daoId);
});
it('creates status capabilities before logout with no signing authority', () => {
  const a = newExitCapability(),
    b = newExitCapability();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(b).not.toBe(a);
});
it('signs a narrow exit step from a saved kit without signing in or recreating a hosted account', async () => {
  const { createVault } = await import('../../src/auth/vault'),
    { signSavedExitInstruction } = await import('../../src/auth/session');
  const { makeInstruction, encodeAction, exitInstructionDigest } =
      await import('@daclify/core-protocol/sdk'),
    { Signature, PublicKey } = await import('@wharfkit/antelope');
  const vault = await createVault('a disposable strong recovery password'),
    operation = crypto.randomUUID(),
    reference = preflight().memberships[0]?.reference;
  if (!reference) throw Error('FIXTURE');
  const kit = {
    version: 1 as const,
    signingPublicKey: vault.signingPublicKey,
    encryptionPublicKey: vault.encryptionPublicKey,
    localEnvelope: vault.localEnvelope,
    recoveryEnvelope: vault.recoveryEnvelope,
  };
  const request = makeInstruction(
    reference,
    '1',
    '0',
    Math.floor(Date.now() / 1000) + 300,
    reference.contract,
    'leave',
    encodeAction('leave', { runtime: reference.contract, dao_id: reference.daoId, member_id: '1' }),
  );
  const signed = await signSavedExitInstruction(
    kit,
    'a disposable strong recovery password',
    operation,
    'leave-one',
    request,
  );
  expect(
    Signature.from(signed.sig).verifyDigest(
      exitInstructionDigest(signed.operation, signed.step_digest, signed.request),
      PublicKey.from(vault.signingPublicKey),
    ),
  ).toBe(true);
  await expect(
    signSavedExitInstruction(kit, 'wrong password', operation, 'leave-one', request),
  ).rejects.toThrow();
});
it('includes cached offline references in the frozen intent so later own-signed departure can resume', () => {
  const p = preflight();
  p.nativeAvailable = false;
  const member = p.memberships[0];
  if (!member) throw Error('FIXTURE');
  member.active = false;
  member.admin = false;
  member.soleMember = null;
  member.reason = 'CACHED_REFERENCE_REQUIRES_NATIVE_RECHECK';
  expect(buildExitIntent(p, { mode: 'delete-account', memberships: {} }).memberships).toEqual([
    {
      chainId: member.reference.chainId,
      runtime: member.reference.contract,
      daoId: member.reference.daoId,
      memberId: member.memberId,
      choice: 'leave',
    },
  ]);
});
