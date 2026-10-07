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
import { PrivateKey } from '@wharfkit/antelope';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { AccountSchema, type Account } from '@daclify/core-protocol';
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
      domain: 'daclify.vault-attach.v1',
      origin: 'http://localhost:5208',
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
