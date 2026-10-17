import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PrivateKey, Serializer, Signature } from '@wharfkit/antelope';
import {
  AccountSchema,
  NetworkSchema,
  QuickAccountPreparedSchema,
  RecoveryContextSchema,
} from '@daclify/core-protocol';
import {
  QuickAuthCodeHash,
  quickAccountRequest,
  quickAccountIdentity,
  quickAccountDigest,
} from '@daclify/core-protocol/sdk';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { useWorkspace } from '../../src/state/workspace';
import { api } from '../../src/api/client';
import * as vault from '../../src/auth/session';
import { approveQuick, resumeQuickApproval, pendingQuick } from '../../src/quick-ballots/approval';
import { generateVaultSecrets } from '../../src/auth/vault';
const key = PrivateKey.generate('K1'),
  anchor = { kind: 'key', publicKey: key.toPublic().toString() };
const context = {
  chainId: '11'.repeat(32),
  runtime: 'daclifycore1',
  authority: 'quickauth',
  authorityCodeHash: QuickAuthCodeHash,
  source: 'quickvote',
  sourceCodeHash: ModuleCodeHashes['quick-ballots'],
  gateway: { actor: 'gateway', permission: 'active' },
  anchor,
  identity: quickAccountIdentity('11'.repeat(32), 'daclifycore1', anchor),
  frozen: false,
  record: null,
};
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  const state = useWorkspace();
  state.network = NetworkSchema.parse({
    chainId: context.chainId,
    runtime: context.runtime,
    rpcUrl: 'https://rpc.example',
    hub: null,
    environment: 'testnet',
    interfaceVersion: 1,
    coreVersion: '0.15.0-alpha.29',
    capabilities: ['quick-ballots-v1'],
  });
  state.account = AccountSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    custody: 'user-controlled',
    signingKey: anchor.publicKey,
    encryptionKey: { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) },
  });
  pendingQuick.value = undefined;
});
afterEach(() => {
  vault.lockVault();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setActivePinia(undefined);
});
it('signs with the recovered approval key while retaining the original voting anchor', async () => {
  vi.stubGlobal('window', { location: new URL('http://localhost:5178/account') });
  const keys = await generateVaultSecrets(),
    signing = PrivateKey.from(keys.signingKey),
    encryption = keys.encryptionPrivateKey;
  const state = useWorkspace();
  const account = AccountSchema.parse({
    ...state.account,
    signingKey: signing.toPublic().toString(),
    encryptionKey: { kty: encryption.kty, crv: encryption.crv, x: encryption.x, y: encryption.y },
  });
  state.account = account;
  await vault.installCreatedVault(
    account,
    keys,
    RecoveryContextSchema.parse({
      version: 1,
      id: crypto.randomUUID(),
      accountId: account.id,
      origin: window.location.origin,
      credentialKey: 'native:fixture',
      mode: 'wallet-protected',
      signingPublicKey: account.signingKey,
      encryptionPublicKey: account.encryptionKey,
      salt: btoa('a'.repeat(32)),
    }),
    () => {},
  );
  const recovered = { ...context, approvalKey: account.signingKey };
  const expires = Math.floor(Date.now() / 1000) + 120;
  const operation = quickAccountRequest(recovered, { operation: 'register' }, expires);
  const prepared = {
    ...operation,
    context: recovered,
    id: crypto.randomUUID(),
    expiresAt: new Date(expires * 1000).toISOString(),
  };
  const signature = vault.signQuickApproval(prepared);
  expect(
    Serializer.decode({ type: Signature, data: signature }).verifyDigest(
      quickAccountDigest(operation.action, operation.request),
      signing.toPublic(),
    ),
  ).toBe(true);
  expect(
    Serializer.decode({ type: Signature, data: signature }).verifyDigest(
      quickAccountDigest(operation.action, operation.request),
      key.toPublic(),
    ),
  ).toBe(false);
  expect(prepared.context.anchor).toEqual(anchor);
});
function fixture() {
  const expires = Math.floor(Date.now() / 1000) + 120,
    request = quickAccountRequest(context, { operation: 'register' }, expires);
  const prepared = QuickAccountPreparedSchema.parse({
    ...request,
    id: '22222222-2222-4222-8222-222222222222',
    context: { ...context, frozen: true },
    expiresAt: new Date(expires * 1000).toISOString(),
  });
  const prepare = vi.spyOn(api, 'quickAccountPrepare').mockResolvedValue(prepared);
  const sign = vi.spyOn(vault, 'signQuickApproval').mockImplementation((value) => {
    const p = QuickAccountPreparedSchema.parse(value);
    return Serializer.encode({ object: key.signDigest(quickAccountDigest(p.action, p.request)) })
      .hexString;
  });
  const submit = vi
    .spyOn(api, 'quickAccountSubmit')
    .mockResolvedValue({ transactionId: '44'.repeat(32), state: 'confirmed' });
  return { prepared, prepare, sign, submit };
}
it('validates the exact prepared operation before signing and sends only a public proof', async () => {
  const f = fixture();
  expect(await approveQuick(context, { operation: 'register' })).toBe('44'.repeat(32));
  const sent = f.submit.mock.calls[0]?.[0];
  if (!sent) throw Error('FIXTURE_SUBMISSION');
  expect(
    Serializer.decode({ type: Signature, data: sent.proof }).verifyDigest(
      quickAccountDigest(f.prepared.action, f.prepared.request),
      key.toPublic(),
    ),
  ).toBe(true);
  expect(JSON.stringify(sent)).not.toContain(key.toString());
  expect(pendingQuick.value).toBeUndefined();
});
it('keeps the original submission ID after connection loss and resumes without signing another operation', async () => {
  const f = fixture();
  f.submit.mockRejectedValueOnce(Error('CONNECTION_LOST'));
  await expect(approveQuick(context, { operation: 'register' })).rejects.toThrow('CONNECTION_LOST');
  expect(pendingQuick.value?.id).toBe(f.prepared.id);
  await expect(approveQuick(context, { operation: 'register' })).rejects.toThrow(
    'QUICK_SUBMISSION_PENDING',
  );
  expect(f.prepare).toHaveBeenCalledTimes(1);
  await expect(resumeQuickApproval()).resolves.toBe('44'.repeat(32));
  expect(f.sign).toHaveBeenCalledTimes(1);
  expect(f.submit.mock.calls[1]?.[0]).toEqual({ id: f.prepared.id, proof: '', incoming: '' });
});
it('rejects a changed authority before prompting a wallet or submitting a proof', async () => {
  const f = fixture();
  if (f.prepared.action !== 'qregister') throw Error('FIXTURE_REGISTER');
  f.prepare.mockResolvedValue({
    ...f.prepared,
    request: { ...f.prepared.request, authority: 'otherauth' },
  });
  await expect(approveQuick(context, { operation: 'register' })).rejects.toThrow(
    'QUICK_PREPARATION',
  );
  expect(f.sign).not.toHaveBeenCalled();
  expect(f.submit).not.toHaveBeenCalled();
});

it('uses the existing account setup to register once when the default remains its Daclify keys', async () => {
  const { configureQuickDefault } = await import('../../src/quick-ballots/approval');
  const f = fixture();
  vi.spyOn(api, 'quickAccountStatus')
    .mockResolvedValueOnce({
      available: true,
      context: { ...context, anchor: { kind: 'key', publicKey: anchor.publicKey } },
    })
    .mockResolvedValueOnce({
      available: true,
      context: {
        ...context,
        anchor: { kind: 'key', publicKey: anchor.publicKey },
        frozen: true,
        record: {
          id: '1',
          identity: context.identity,
          approval: { kind: 3, credential: '' },
          epoch: '0',
          nonce: '0',
          active: true,
          deactivated_at: 0,
        },
      },
    });
  await configureQuickDefault(null);
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.prepare.mock.calls[0]?.[0].intent).toEqual({ operation: 'register' });
});

it('releases the local pending lock only when the service conclusively expires the original packet', async () => {
  const { ApiFailure } = await import('../../src/api/client');
  const f = fixture();
  f.submit.mockRejectedValueOnce(Error('CONNECTION_LOST'));
  await expect(approveQuick(context, { operation: 'register' })).rejects.toThrow('CONNECTION_LOST');
  f.submit.mockRejectedValueOnce(new ApiFailure('QUICK_SUBMISSION_EXPIRED'));
  await expect(resumeQuickApproval()).rejects.toThrow('QUICK_SUBMISSION_EXPIRED');
  expect(pendingQuick.value).toBeUndefined();
});
