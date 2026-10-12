import { afterEach, expect, it, vi } from 'vitest';
import { createRecoveryRecipient } from '@daclify/core-protocol/sdk';
import { sealProfileKey } from '@daclify/core-protocol/profiles';
import { PrivateKey } from '@wharfkit/antelope';
import { ProfileContextSchema, AccountControlRequestSchema } from '@daclify/core-protocol';
import { api, setAccountControlSigner } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
afterEach(() => {
  vi.unstubAllGlobals();
  configureNetworks(null);
  setAccountControlSigner(async () => {
    throw new Error('ACCOUNT_CONTROL_REQUIRED');
  });
});
it('posts exact profile bodies and binds fresh control proofs to those same serialized bytes', async () => {
  configureNetworks(null);
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
  const context = ProfileContextSchema.parse({
    version: 2,
    chainId: 'ab'.repeat(32),
    runtime: 'daclifycore',
    daoId: '1',
    memberId: '1',
    profileRevision: crypto.randomUUID(),
  });
  const recipient = await createRecoveryRecipient();
  const grant = await sealProfileKey(
    crypto.getRandomValues(new Uint8Array(32)),
    recipient.publicKey,
    context,
    'cd'.repeat(32),
  );
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/v1/account/control')) {
      if (typeof init?.body !== 'string') throw new Error('FIXTURE_BODY');
      const body = AccountControlRequestSchema.parse(JSON.parse(init.body));
      const id = crypto.randomUUID(),
        expires = new Date(Date.now() + 300000).toISOString();
      return Response.json({
        id,
        expires,
        message: JSON.stringify({
          ...body,
          domain: 'daclify.account-control.v2',
          origin: 'http://localhost:5173',
          audience: 'http://localhost:5173',
          accountId: crypto.randomUUID(),
          signingKey: PrivateKey.generate('K1').toPublic().toString(),
          challengeId: id,
          expires,
        }),
      });
    }
    return Response.json(
      String(url).endsWith('/remove')
        ? {
            state: 'backup-expiry-pending',
            backupExpiresAt: new Date(Date.now() + 86400000).toISOString(),
          }
        : { state: 'staged', expiresAt: new Date(Date.now() + 900000).toISOString() },
    );
  });
  vi.stubGlobal('fetch', fetcher);
  setAccountControlSigner(async () => ({ kind: 'root', signature: 'protected-fixture-signature' }));
  const payload = { context, grants: [grant] };
  await api.shareProfileKeys(payload);
  const control = fetcher.mock.calls[0]?.[1]?.body,
    posted = fetcher.mock.calls[1]?.[1]?.body;
  expect(posted).toBe(JSON.stringify(payload));
  expect(typeof control).toBe('string');
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))),
  );
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  expect(control).toBe(JSON.stringify({ path: '/v1/profiles/keys/share', bodyHash: expected }));
  const remove = { context, ciphertextCommitment: 'cd'.repeat(32) };
  await api.removeProfileKeys(remove);
  expect(fetcher.mock.calls[3]?.[1]?.body).toBe(JSON.stringify(remove));
});
