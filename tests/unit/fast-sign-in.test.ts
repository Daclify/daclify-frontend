import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PrivateKey } from '@wharfkit/antelope';
import {
  createRecoveryPayload,
  createRecoveryRecipient,
  sealRecoveryDelivery,
} from '@daclify/core-protocol/sdk';
import {
  RecoveryContextSchema,
  recoveryVaultDomain,
  type Account,
  contentDomain,
  epochGrantDomain,
} from '@daclify/core-protocol';
import { useWorkspace } from '../../src/state/workspace';
import { configureNetworks } from '../../src/api/networks';
import * as client from '../../src/api/client';
import * as session from '../../src/auth/session';
import { createEpochGrant, openCommittedEpoch, sha256Hex } from '../../src/auth/vault';
import { preparePrivateFile, openPrivateFile, decodeStoredBytes } from '../../src/content/files';
import { restoreFastSignIn } from '../../src/auth/fast-sign-in';
function storage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    key: (index) => [...entries.keys()][index] ?? null,
  };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('window', { location: { origin: 'https://app.example.test' } });
  vi.stubGlobal('location', {
    origin: 'https://app.example.test',
    href: 'https://app.example.test/account',
  });
  configureNetworks(null);
});
afterEach(() => {
  session.lockVault();
  configureNetworks(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture() {
  const signing = PrivateKey.generate('K1'),
    encryption = await createRecoveryRecipient(),
    id = crypto.randomUUID();
  const account: Account = {
    id,
    custody: 'user-controlled',
    signingKey: signing.toPublic().toString(),
    encryptionKey: encryption.publicKey,
  };
  useWorkspace().account = account;
  const context = RecoveryContextSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    accountId: id,
    origin: window.location.origin,
    credentialKey: 'email:alice@example.test',
    mode: 'daclify-assisted',
    signingPublicKey: account.signingKey,
    encryptionPublicKey: account.encryptionKey,
    salt: btoa('x'.repeat(32)),
  });
  const secrets = { signingKey: signing.toString(), encryptionPrivateKey: encryption.privateKey },
    payload = await createRecoveryPayload(secrets, context);
  return { account, context, secrets, payload };
}
it('opens both original keys after fresh assisted login without writing a password or plaintext keys', async () => {
  const user = await fixture();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url) === '/v1/sign-in/session')
        return Response.json(
          { account: user.account, csrfToken: 'c'.repeat(43) },
          { headers: { 'x-daclify-recovery-grant': 'g'.repeat(43) } },
        );
      expect(String(url)).toBe('/v1/account/recovery/claim');
      const input = JSON.parse(String(init?.body));
      return Response.json({
        backup: {
          context: user.context,
          envelope: user.payload.envelope,
          keyWrap: { kind: 'service', ciphertext: 'vault:v1:YWJj' },
        },
        keyGrant: await sealRecoveryDelivery(
          user.payload.key,
          input.recipient,
          'claim:' + recoveryVaultDomain(user.context),
        ),
      });
    }),
  );
  const dao = {
      chainId: 'ab'.repeat(32),
      contract: 'daclifycore',
      daoId: '1',
      interfaceVersion: 1 as const,
    },
    epoch = crypto.getRandomValues(new Uint8Array(32));
  const grantDomain = epochGrantDomain(dao, '1', '1'),
    documentDomain = contentDomain(dao, '1', 1, '1');
  const epochGrant = await createEpochGrant(user.context.encryptionPublicKey, epoch, grantDomain),
    commitment = await sha256Hex(epoch);
  const original = new TextEncoder().encode('Private document saved on the old device'),
    metadata = { version: 1 as const, filename: 'private.txt', mediaType: 'text/plain' };
  const saved = await preparePrivateFile(original, metadata, epoch, documentDomain);
  await client.api.resumeSession();
  expect(await restoreFastSignIn(user.account)).toBe(true);
  const opened = await session.withUnlockedVault(user.account, async (recovered) => {
    const key = await openCommittedEpoch(
      recovered.encryptionPrivateKey,
      epochGrant,
      grantDomain,
      commitment,
    );
    try {
      return await openPrivateFile(decodeStoredBytes(saved.content), key, documentDomain);
    } finally {
      key.fill(0);
    }
  });
  expect(opened).toEqual({ metadata, bytes: original });
  epoch.fill(0);
  expect(session.vaultUnlocked.value).toBe(true);
  expect(session.canUseVaultKey(user.account.signingKey ?? undefined)).toBe(true);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(await session.withUnlockedVault(user.account, async (value) => value)).toEqual(
    user.secrets,
  );
  user.payload.key.fill(0);
});
it('keeps keys locked when no full-access grant is present', async () => {
  const user = await fixture();
  expect(await restoreFastSignIn(user.account)).toBe(false);
  expect(session.vaultUnlocked.value).toBe(false);
  user.payload.key.fill(0);
});
