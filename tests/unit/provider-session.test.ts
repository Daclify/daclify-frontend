import { afterEach, describe, expect, it, vi } from 'vitest';
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
Object.assign(globalThis, { localStorage: memoryStorage(), sessionStorage: memoryStorage() });
import { PrivateKey, PublicKey, Signature } from '@wharfkit/antelope';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  AccountSchema,
  ChallengeRequestSchema,
  LoginRequestSchema,
  LoginMessageSchema,
  type Account,
} from '@daclify/core-protocol';
import { configureNetworks } from '../../src/api/networks';
import { api } from '../../src/api/client';
import { createVault } from '../../src/auth/vault';
import {
  acceptProviderSession,
  lockVault,
  saveVault,
  unlockAndLogin,
  vaultUnlocked,
} from '../../src/auth/session';
const password = 'long disposable fixture password';
const csrf = 'a'.repeat(43);
function account(signingKey: string): Account {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  });
  return AccountSchema.parse({
    id: randomUUID(),
    custody: 'user-controlled',
    signingKey,
    encryptionKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  });
}
afterEach(() => {
  lockVault();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  configureNetworks(null);
});
describe('provider sessions leave the user-controlled vault locked', () => {
  it.each(['removed', 'replaced'] as const)(
    'checks the actual unlocked key when its saved vault record was %s',
    async (change) => {
      const created = await createVault(password);
      saveVault(created);
      const owned = account(created.signingPublicKey);
      vi.spyOn(api, 'challenge').mockResolvedValue({
        id: randomUUID(),
        message: 'fixture-message',
        expires: new Date(Date.now() + 60_000).toISOString(),
      });
      vi.spyOn(api, 'login').mockResolvedValue(owned);
      await unlockAndLogin(password);
      const replacement = await createVault(password);
      if (change === 'removed') localStorage.clear();
      else saveVault(replacement);
      acceptProviderSession(account(replacement.signingPublicKey), csrf);
      expect(vaultUnlocked.value).toBe(false);
    },
  );
  it('stores the session token material without unlocking a locked vault', () => {
    lockVault();
    const identity = account(PrivateKey.generate('K1').toPublic().toString());
    expect(acceptProviderSession(identity, csrf)).toEqual(identity);
    expect(vaultUnlocked.value).toBe(false);
    expect(sessionStorage.getItem('daclify.csrf')).toBe(csrf);
  });
  it('locks an open vault when the provider account is a different signing key', async () => {
    const created = await createVault(password);
    saveVault(created);
    const owned = account(created.signingPublicKey);
    vi.spyOn(api, 'challenge').mockResolvedValue({
      id: randomUUID(),
      message: 'fixture-message',
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.spyOn(api, 'login').mockResolvedValue(owned);
    await unlockAndLogin(password);
    expect(vaultUnlocked.value).toBe(true);
    acceptProviderSession(account(PrivateKey.generate('K1').toPublic().toString()), csrf);
    expect(vaultUnlocked.value).toBe(false);
  });
  it('keeps the same unlocked vault when the provider account matches its signing key', async () => {
    const created = await createVault(password);
    saveVault(created);
    const owned = account(created.signingPublicKey);
    vi.spyOn(api, 'challenge').mockResolvedValue({
      id: randomUUID(),
      message: 'fixture-message',
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.spyOn(api, 'login').mockResolvedValue(owned);
    await unlockAndLogin(password);
    acceptProviderSession(owned, csrf);
    expect(vaultUnlocked.value).toBe(true);
  });
});

it('does not unlock keys or replace CSRF state when the account changes while vault attachment is pending', async () => {
  const { createPinia, setActivePinia } = await import('pinia');
  const { useWorkspace } = await import('../../src/state/workspace');
  setActivePinia(createPinia());
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5208' } });
  const created = await createVault(password);
  saveVault(created);
  const recovered = AccountSchema.parse({
    id: randomUUID(),
    custody: 'user-controlled',
    signingKey: null,
    encryptionKey: null,
  });
  const workspace = useWorkspace();
  workspace.account = recovered;
  const id = randomUUID(),
    expires = new Date(Date.now() + 60000).toISOString();
  vi.spyOn(api, 'vaultAttachChallenge').mockResolvedValue({
    id,
    expires,
    message: JSON.stringify({
      domain: 'daclify.vault-attach.v2',
      origin: 'http://localhost:5208',
      audience: 'http://localhost:5208',
      accountId: recovered.id,
      signingKey: created.signingPublicKey,
      encryptionKey: created.encryptionPublicKey,
      id,
      expires,
    }),
  });
  let complete: ((value: { account: Account; csrfToken: string }) => void) | undefined;
  const attach = vi.spyOn(api, 'attachVault').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const operation = unlockAndLogin(password, recovered);
  await vi.waitFor(() => expect(attach).toHaveBeenCalledOnce());
  workspace.account = AccountSchema.parse({ ...recovered, id: randomUUID() });
  sessionStorage.setItem('daclify.csrf', 'b'.repeat(43));
  if (!complete) throw new Error('Missing fixture completion');
  complete({
    account: AccountSchema.parse({
      id: recovered.id,
      custody: 'user-controlled',
      signingKey: created.signingPublicKey,
      encryptionKey: created.encryptionPublicKey,
    }),
    csrfToken: csrf,
  });
  await expect(operation).rejects.toThrow('ACCOUNT_KEY_MISMATCH');
  expect(vaultUnlocked.value).toBe(false);
  expect(sessionStorage.getItem('daclify.csrf')).toBe('b'.repeat(43));
  setActivePinia(undefined);
});

it('sends and signs both existing vault public keys through the real API client', async () => {
  const origin = 'http://localhost:5208';
  vi.stubGlobal('window', { location: { origin } });
  configureNetworks(null);
  const created = await createVault(password);
  saveVault(created);
  const identity = {
    signingKey: created.signingPublicKey,
    encryptionKey: created.encryptionPublicKey,
  };
  const owned = AccountSchema.parse({ ...identity, id: randomUUID(), custody: 'user-controlled' });
  const id = randomUUID(),
    expires = new Date(Date.now() + 60000).toISOString();
  const message = JSON.stringify(
    LoginMessageSchema.parse({
      ...identity,
      domain: 'daclify.login.v3',
      origin,
      audience: origin,
      challenge: id,
      expires,
    }),
  );
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    if (typeof options?.body !== 'string') throw new Error('Missing fixture request body');
    const body: unknown = JSON.parse(options.body);
    if (String(url) === '/v1/auth/challenge') {
      expect(ChallengeRequestSchema.parse(body)).toEqual(identity);
      return Response.json({ id, expires, message });
    }
    expect(String(url)).toBe('/v1/auth/login');
    const proof = LoginRequestSchema.parse(body);
    expect(proof.encryptionKey).toEqual(created.encryptionPublicKey);
    expect(proof.challengeId).toBe(id);
    expect(
      Signature.from(proof.signature).verifyMessage(
        new TextEncoder().encode(message),
        PublicKey.from(created.signingPublicKey),
      ),
    ).toBe(true);
    return Response.json({ account: owned, csrfToken: csrf });
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await unlockAndLogin(password)).toEqual(owned);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(vaultUnlocked.value).toBe(true);
  expect(sessionStorage.getItem('daclify.csrf')).toBe(csrf);
});

it.each(['legacy', 'substituted'] as const)(
  'does not sign or submit a %s challenge from the API',
  async (change) => {
    const origin = 'http://localhost:5208';
    vi.stubGlobal('window', { location: { origin } });
    configureNetworks(null);
    const created = await createVault(password),
      other = await createVault(password);
    saveVault(created);
    const id = randomUUID(),
      expires = new Date(Date.now() + 60000).toISOString();
    const message = JSON.stringify({
      domain: change === 'legacy' ? 'daclify.login.v2' : 'daclify.login.v3',
      signingKey: created.signingPublicKey,
      encryptionKey:
        change === 'substituted' ? other.encryptionPublicKey : created.encryptionPublicKey,
      origin,
      audience: origin,
      challenge: id,
      expires,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id, expires, message }));
    vi.stubGlobal('fetch', fetcher);
    await expect(unlockAndLogin(password)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vaultUnlocked.value).toBe(false);
    expect(sessionStorage.getItem('daclify.csrf')).toBeNull();
  },
);
