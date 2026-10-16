import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
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
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Fixture not pending');
  };
  let reject: (error: unknown) => void = () => {
    throw new Error('Fixture not pending');
  };
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
Object.assign(globalThis, { localStorage: memoryStorage(), sessionStorage: memoryStorage() });
import { PrivateKey, PublicKey, Signature } from '@wharfkit/antelope';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  AccountSchema,
  ApiRoutes,
  ChallengeRequestSchema,
  LoginRequestSchema,
  LoginMessageSchema,
  VaultAccountSchema,
  type Account,
  DaoContentSchema,
  epochGrantDomain,
} from '@daclify/core-protocol';
import { configureNetworks } from '../../src/api/networks';
import { api, ApiFailure, takeRecoveryGrant } from '../../src/api/client';
import { useWorkspace } from '../../src/state/workspace';
import { createVault, createEpochGrant, sha256Hex } from '../../src/auth/vault';
import {
  acceptProviderSession,
  lockVault,
  saveVault,
  unlockAndLogin,
  vaultUnlocked,
  verifyPrivateEpochs,
  logoutAccount,
  canUseVaultKey,
  withUnlockedVault,
  startSessionSecurity,
} from '../../src/auth/session';
const password = 'long disposable fixture password';
const csrf = 'a'.repeat(43);
function account(signingKey: string) {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    format: 'jwk',
  });
  return VaultAccountSchema.parse({
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
  setActivePinia(undefined);
  vi.useRealTimers();
});

describe('portal activity and key expiration', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
  });
  async function opened(remainingMs?: number) {
    setActivePinia(createPinia());
    const browser = Object.assign(new EventTarget(), {
      location: { origin: 'https://portal.example' },
    });
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const created = await createVault(password);
    saveVault(created);
    const owned = {
      ...account(created.signingPublicKey),
      encryptionKey: created.encryptionPublicKey,
    };
    vi.spyOn(api, 'challenge').mockResolvedValue({
      id: randomUUID(),
      message: 'fixture-message',
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.spyOn(api, 'login').mockResolvedValue(owned);
    await unlockAndLogin(password);
    useWorkspace().account = owned;
    stop = startSessionSecurity();
    if (remainingMs !== undefined) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            Response.json(
              { account: owned },
              { headers: { 'x-daclify-session-ms': String(remainingMs) } },
            ),
          ),
      );
      await api.me();
    }
    return { browser, owned };
  }
  it('keeps keys available beyond ten minutes and locks after twelve idle hours', async () => {
    const { owned } = await opened();
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(vaultUnlocked.value).toBe(true);
    await vi.advanceTimersByTimeAsync(43_200_000 - 11 * 60_000);
    expect(vaultUnlocked.value).toBe(false);
    expect(canUseVaultKey(owned.signingKey)).toBe(false);
  });
  it.each(['pointerdown', 'keydown', 'scroll'])(
    'visible portal %s restarts the idle interval',
    async (type) => {
      const { browser } = await opened();
      await vi.advanceTimersByTimeAsync(11 * 60 * 60_000);
      browser.dispatchEvent(new Event(type));
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
      expect(vaultUnlocked.value).toBe(true);
      await vi.advanceTimersByTimeAsync(10 * 60 * 60_000);
      expect(vaultUnlocked.value).toBe(false);
    },
  );
  it('portal input cannot extend the authoritative sign-in deadline', async () => {
    const { browser, owned } = await opened(60_000);
    await vi.advanceTimersByTimeAsync(50_000);
    browser.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vaultUnlocked.value).toBe(false);
    expect(canUseVaultKey(owned.signingKey)).toBe(false);
  });
  it('checks elapsed time before key use when a suspended browser has not run its timers', async () => {
    const { owned } = await opened(60_000);
    vi.setSystemTime(Date.now() + 60_001);
    expect(canUseVaultKey(owned.signingKey)).toBe(false);
    await expect(withUnlockedVault(owned, async () => 'private result')).rejects.toThrow(
      'VAULT_LOCKED',
    );
  });
  it('discards pending private work if sign-in expires while browser timers are suspended', async () => {
    const { owned } = await opened(60_000);
    await expect(
      withUnlockedVault(owned, async () => {
        vi.setSystemTime(Date.now() + 60_001);
        return 'private result';
      }),
    ).rejects.toThrow('WALLET_CONTEXT_CHANGED');
    expect(vaultUnlocked.value).toBe(false);
  });
  it('activity cannot unlock manually locked keys', async () => {
    const { browser } = await opened();
    lockVault();
    browser.dispatchEvent(new Event('keydown'));
    expect(vaultUnlocked.value).toBe(false);
  });
});
it.each(['success', 'service failure', 'network timeout'] as const)(
  'locks keys immediately during sign-out despite %s',
  async (outcome) => {
    setActivePinia(createPinia());
    vi.stubGlobal('window', { location: { origin: 'https://portal.example' } });
    const created = await createVault(password);
    saveVault(created);
    const owned = {
      ...account(created.signingPublicKey),
      encryptionKey: created.encryptionPublicKey,
    };
    vi.spyOn(api, 'challenge').mockResolvedValue({
      id: randomUUID(),
      message: 'fixture-message',
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    const logout = deferred<Response>();
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      if (String(input) === ApiRoutes.login.path)
        return Promise.resolve(
          Response.json(
            { account: owned, csrfToken: csrf },
            { headers: { 'x-daclify-recovery-grant': 'b'.repeat(43) } },
          ),
        );
      if (String(input) === ApiRoutes.logout.path) return logout.promise;
      throw new Error('Unexpected fixture request');
    });
    await unlockAndLogin(password);
    const state = useWorkspace();
    state.account = owned;
    expect(canUseVaultKey(owned.signingKey)).toBe(true);
    const workStarted = deferred<void>(),
      finishWork = deferred<void>();
    const privateWork = withUnlockedVault(owned, async () => {
      workStarted.resolve();
      await finishWork.promise;
      return 'private result';
    }).catch((error: unknown) => error);
    await workStarted.promise;
    const signingOut = logoutAccount().catch((error: unknown) => error);
    const pendingState = {
      unlocked: vaultUnlocked.value,
      signingKeyUsable: canUseVaultKey(owned.signingKey),
      recoveryGrant: takeRecoveryGrant(owned.id),
    };
    if (outcome === 'network timeout')
      logout.reject(new DOMException('Request timed out', 'TimeoutError'));
    else if (outcome === 'service failure')
      logout.resolve(
        Response.json({ code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' }, { status: 503 }),
      );
    else logout.resolve(new Response(null, { status: 204 }));
    const result: unknown = await signingOut;
    finishWork.resolve();
    const staleResult: unknown = await privateWork;
    expect(pendingState).toEqual({
      unlocked: false,
      signingKeyUsable: false,
      recoveryGrant: undefined,
    });
    expect(staleResult).toBeInstanceOf(Error);
    expect(staleResult).toHaveProperty('message', 'WALLET_CONTEXT_CHANGED');
    if (outcome === 'success') {
      expect(result).toBeUndefined();
      expect(state.account).toBeUndefined();
      expect(state.memberships).toEqual([]);
      expect(sessionStorage.getItem('daclify.csrf')).toBeNull();
    } else {
      expect(result).toHaveProperty(
        outcome === 'service failure' ? 'code' : 'name',
        outcome === 'service failure' ? 'SERVICE_UNAVAILABLE' : 'TimeoutError',
      );
      expect(state.account?.id).toBe(owned.id);
      expect(sessionStorage.getItem('daclify.csrf')).toBe(csrf);
    }
  },
);
describe('provider sessions leave the user-controlled vault locked', () => {
  it.each(['removed', 'replaced'] as const)(
    'checks the actual unlocked key when its saved vault record was %s',
    async (change) => {
      const created = await createVault(password);
      saveVault(created);
      const owned = {
        ...account(created.signingPublicKey),
        encryptionKey: created.encryptionPublicKey,
      };
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
    const owned = {
      ...account(created.signingPublicKey),
      encryptionKey: created.encryptionPublicKey,
    };
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
  it('keeps matching original keys unlocked and locks when the document identity changes', async () => {
    const created = await createVault(password);
    saveVault(created);
    const owned = {
      ...account(created.signingPublicKey),
      encryptionKey: created.encryptionPublicKey,
    };
    vi.spyOn(api, 'challenge').mockResolvedValue({
      id: randomUUID(),
      message: 'fixture-message',
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.spyOn(api, 'login').mockResolvedValue(owned);
    await unlockAndLogin(password);
    acceptProviderSession(owned, csrf);
    expect(vaultUnlocked.value).toBe(true);
    const { createRecoveryRecipient } = await import('@daclify/core-protocol/sdk');
    acceptProviderSession(
      { ...owned, encryptionKey: (await createRecoveryRecipient()).publicKey },
      csrf,
    );
    expect(vaultUnlocked.value).toBe(false);
  });
});

it('verifies actual committed private grants and rejects a corrupted commitment without exposing keys', async () => {
  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const created = await createVault(password);
  saveVault(created);
  const owned = {
    ...account(created.signingPublicKey),
    encryptionKey: created.encryptionPublicKey,
  };
  vi.spyOn(api, 'challenge').mockResolvedValue({
    id: randomUUID(),
    message: 'fixture-message',
    expires: new Date(Date.now() + 60000).toISOString(),
  });
  vi.spyOn(api, 'login').mockResolvedValue(owned);
  await unlockAndLogin(password);
  const dao = {
    chainId: 'ab'.repeat(32),
    contract: 'daclifycore',
    daoId: '1',
    interfaceVersion: 1 as const,
  };
  const key = crypto.getRandomValues(new Uint8Array(32));
  const envelope = await createEpochGrant(
    created.encryptionPublicKey,
    key,
    epochGrantDomain(dao, '1', '1'),
  );
  const records = DaoContentSchema.parse({
    dao,
    members: [],
    documents: [],
    epochs: [{ epoch: '1', creator: '1', commitment: await sha256Hex(key) }],
    keyGrants: [
      { id: '1', epoch: '1', recipient: '1', grantor: '1', envelope: JSON.stringify(envelope) },
    ],
  });
  await expect(verifyPrivateEpochs(dao, '1', ['1'], records)).resolves.toBeUndefined();
  const epoch = records.epochs[0];
  if (!epoch) throw new Error('Missing epoch fixture');
  epoch.commitment = '00'.repeat(32);
  await expect(verifyPrivateEpochs(dao, '1', ['1'], records)).rejects.toThrow('EPOCH_KEY_MISMATCH');
  lockVault();
  await expect(verifyPrivateEpochs(dao, '1', ['1'], records)).rejects.toThrow('VAULT_LOCKED');
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
  let notifyAttached: (() => void) | undefined;
  const attached = new Promise<void>((resolve) => {
    notifyAttached = resolve;
  });
  const attach = vi.spyOn(api, 'attachVault').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
        if (!notifyAttached) throw new Error('Missing fixture notification');
        notifyAttached();
      }),
  );
  const operation = unlockAndLogin(password, recovered);
  await Promise.race([attached, operation]);
  expect(attach).toHaveBeenCalledOnce();
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

it('lets a wallet session explicitly restore its already registered account without signing out', async () => {
  const { createPinia, setActivePinia } = await import('pinia');
  const { useWorkspace } = await import('../../src/state/workspace');
  setActivePinia(createPinia());
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5208' } });
  const created = await createVault(password);
  saveVault(created);
  const wallet = AccountSchema.parse({
    id: randomUUID(),
    custody: 'user-controlled',
    signingKey: null,
    encryptionKey: null,
  });
  const restored = AccountSchema.parse({
    id: randomUUID(),
    custody: 'user-controlled',
    signingKey: created.signingPublicKey,
    encryptionKey: created.encryptionPublicKey,
  });
  useWorkspace().account = wallet;
  const attach = vi
    .spyOn(api, 'vaultAttachChallenge')
    .mockRejectedValue(new ApiFailure('VAULT_ALREADY_REGISTERED'));
  const challenge = vi.spyOn(api, 'challenge').mockResolvedValue({
    id: randomUUID(),
    message: 'fixture-message',
    expires: new Date(Date.now() + 60000).toISOString(),
  });
  vi.spyOn(api, 'login').mockResolvedValue(restored);
  expect(await unlockAndLogin(password, wallet, 'recover')).toEqual(restored);
  expect(attach).not.toHaveBeenCalled();
  expect(challenge).toHaveBeenCalledOnce();
  expect(vaultUnlocked.value).toBe(true);
  setActivePinia(undefined);
});

it('keeps a changed session intact when registered-account recovery finishes late', async () => {
  const { createPinia, setActivePinia } = await import('pinia');
  const { useWorkspace } = await import('../../src/state/workspace');
  setActivePinia(createPinia());
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5208' } });
  const created = await createVault(password);
  saveVault(created);
  const wallet = AccountSchema.parse({
    id: randomUUID(),
    custody: 'user-controlled',
    signingKey: null,
    encryptionKey: null,
  });
  const restored = AccountSchema.parse({
    id: randomUUID(),
    custody: 'user-controlled',
    signingKey: created.signingPublicKey,
    encryptionKey: created.encryptionPublicKey,
  });
  const workspace = useWorkspace();
  workspace.account = wallet;
  const attach = vi
    .spyOn(api, 'vaultAttachChallenge')
    .mockRejectedValue(new ApiFailure('VAULT_ALREADY_REGISTERED'));
  vi.spyOn(api, 'challenge').mockResolvedValue({
    id: randomUUID(),
    message: 'fixture-message',
    expires: new Date(Date.now() + 60000).toISOString(),
  });
  vi.spyOn(api, 'login').mockImplementation(async (_id, _signature, _key, check) => {
    workspace.account = AccountSchema.parse({ ...wallet, id: randomUUID() });
    sessionStorage.setItem('daclify.csrf', 'b'.repeat(43));
    check?.(restored);
    return restored;
  });
  await expect(unlockAndLogin(password, wallet, 'recover')).rejects.toThrow(
    'WALLET_CONTEXT_CHANGED',
  );
  expect(attach).not.toHaveBeenCalled();
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

it.each(['identity', 'context'] as const)(
  'rejects a native reconnect with changed %s before replacing session material',
  async (fault) => {
    setActivePinia(createPinia());
    const created = await createVault(password);
    saveVault(created);
    const owned = {
      ...account(created.signingPublicKey),
      encryptionKey: created.encryptionPublicKey,
    };
    const { useWorkspace } = await import('../../src/state/workspace');
    const state = useWorkspace();
    state.account = owned;
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5178' } });
    vi.spyOn(api, 'challenge').mockResolvedValue({
      id: randomUUID(),
      message: 'fixture',
      expires: new Date(Date.now() + 60000).toISOString(),
    });
    vi.spyOn(api, 'login').mockResolvedValue(owned);
    await unlockAndLogin(password);
    sessionStorage.setItem('daclify.csrf', 'original-session-token-material-000');
    vi.spyOn(api, 'reconnectNativeAccount').mockImplementation(async () => {
      if (fault === 'context')
        state.account = account(PrivateKey.generate('K1').toPublic().toString());
      return {
        account: fault === 'identity' ? { ...owned, id: randomUUID() } : owned,
        csrfToken: 'new-session-token-material-000000000',
      };
    });
    const { completeNativeReconnect } = await import('../../src/auth/session');
    await expect(
      completeNativeReconnect(
        owned,
        randomUUID(),
        {
          packedTransaction: '00',
          signatures: [
            PrivateKey.generate('K1').signMessage(new TextEncoder().encode('fixture')).toString(),
          ],
        },
        () => {},
      ),
    ).rejects.toThrow();
    expect(sessionStorage.getItem('daclify.csrf')).toBe('original-session-token-material-000');
  },
);

it('signs native reconnection with the restored root even when an EVM signer is selected', async () => {
  setActivePinia(createPinia());
  const origin = 'http://localhost:5178';
  vi.stubGlobal('window', { location: { origin } });
  const created = await createVault(password);
  saveVault(created);
  const owned = {
    ...account(created.signingPublicKey),
    encryptionKey: created.encryptionPublicKey,
  };
  const { useWorkspace } = await import('../../src/state/workspace');
  useWorkspace().account = owned;
  vi.spyOn(api, 'challenge').mockResolvedValue({
    id: randomUUID(),
    message: 'fixture',
    expires: new Date(Date.now() + 60000).toISOString(),
  });
  vi.spyOn(api, 'login').mockResolvedValue(owned);
  await unlockAndLogin(password);
  const { selectedSigner } = await import('../../src/auth/action-signer');
  selectedSigner.value = 'evm';
  const {
    ApiRoutes,
    AccountControlMessageSchema,
    AccountControlRequestSchema,
    AccountControlProofSchema,
  } = await import('@daclify/core-protocol');
  let message = '',
    submitted = false;
  vi.stubGlobal('fetch', async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url) === '/v1/account/control') {
      const request = AccountControlRequestSchema.parse(JSON.parse(String(options?.body)));
      expect(request.path).toBe(ApiRoutes.accountReconnectNative.path);
      const id = randomUUID(),
        expires = new Date(Date.now() + 60000).toISOString();
      message = JSON.stringify(
        AccountControlMessageSchema.parse({
          ...request,
          domain: 'daclify.account-control.v2',
          origin,
          audience: origin,
          accountId: owned.id,
          signingKey: owned.signingKey,
          challengeId: id,
          expires,
        }),
      );
      return Response.json({ id, message, expires });
    }
    expect(String(url)).toBe(ApiRoutes.accountReconnectNative.path);
    const headers = new Headers(options?.headers);
    const proof = AccountControlProofSchema.parse({
      kind: 'root',
      signature: headers.get('x-account-signature'),
    });
    expect(headers.has('x-account-proof')).toBe(false);
    expect(proof.kind).toBe('root');
    if (proof.kind !== 'root') throw new Error('Restored root proof required');
    expect(
      Signature.from(proof.signature).verifyMessage(
        new TextEncoder().encode(message),
        PublicKey.from(created.signingPublicKey),
      ),
    ).toBe(true);
    submitted = true;
    return Response.json({ account: owned, csrfToken: csrf });
  });
  const { completeNativeReconnect } = await import('../../src/auth/session');
  expect(
    await completeNativeReconnect(
      owned,
      randomUUID(),
      {
        packedTransaction: '00',
        signatures: [
          PrivateKey.generate('K1').signMessage(new TextEncoder().encode('fixture')).toString(),
        ],
      },
      () => {},
    ),
  ).toEqual(owned);
  expect(submitted).toBe(true);
  expect(vaultUnlocked.value).toBe(true);
  expect(sessionStorage.getItem('daclify.csrf')).toBe(csrf);
  selectedSigner.value = 'vault';
});

it('signs only Quick ballot operations with the matching unlocked canonical account key', async () => {
  const { QuickAuthCodeHash, quickAccountIdentity, quickAccountRequest, quickAccountDigest } =
    await import('@daclify/core-protocol/sdk');
  const { signQuickApproval } = await import('../../src/auth/session');
  const { Serializer } = await import('@wharfkit/antelope');
  const created = await createVault(password);
  saveVault(created);
  const owned = {
    ...account(created.signingPublicKey),
    encryptionKey: created.encryptionPublicKey,
  };
  vi.spyOn(api, 'challenge').mockResolvedValue({
    id: randomUUID(),
    message: 'fixture-message',
    expires: new Date(Date.now() + 60000).toISOString(),
  });
  vi.spyOn(api, 'login').mockResolvedValue(owned);
  await unlockAndLogin(password);
  const anchor = { kind: 'key', publicKey: created.signingPublicKey },
    context = {
      chainId: '11'.repeat(32),
      runtime: 'daclifycore1',
      authority: 'quickauth',
      authorityCodeHash: QuickAuthCodeHash,
      source: 'quickvote',
      sourceCodeHash: '22'.repeat(32),
      gateway: { actor: 'gateway', permission: 'active' },
      anchor,
      identity: quickAccountIdentity('11'.repeat(32), 'daclifycore1', anchor),
      frozen: true,
      record: null,
    };
  const expires = Math.floor(Date.now() / 1000) + 120,
    request = quickAccountRequest(context, { operation: 'register' }, expires),
    prepared = {
      ...request,
      id: randomUUID(),
      context,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  const proof = signQuickApproval(prepared);
  const signature = Serializer.decode({ type: Signature, data: proof });
  expect(
    signature.verifyDigest(
      quickAccountDigest(request.action, request.request),
      PublicKey.from(created.signingPublicKey),
    ),
  ).toBe(true);
  lockVault();
  expect(() => signQuickApproval(prepared)).toThrow('VAULT_LOCKED');
});
