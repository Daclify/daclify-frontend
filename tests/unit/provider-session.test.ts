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
