import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PrivateKey } from '@wharfkit/antelope';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { AccountSchema, NetworkSchema, type Account } from '@daclify/core-protocol';
import { api, ApiFailure } from '../../src/api/client';
import { useWorkspace } from '../../src/state/workspace';
const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
  format: 'jwk',
});
const account = AccountSchema.parse({
  id: randomUUID(),
  custody: 'user-controlled',
  signingKey: PrivateKey.generate('K1').toPublic().toString(),
  encryptionKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
});
const network = NetworkSchema.parse({
  chainId: '11'.repeat(32),
  rpcUrl: 'http://127.0.0.1:18888',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: '0.1.0-alpha.1',
  capabilities: [],
});
beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(api, 'network').mockResolvedValue(network);
  vi.spyOn(api, 'daos').mockResolvedValue([]);
  vi.spyOn(api, 'me').mockResolvedValue(account);
  vi.spyOn(api, 'memberships').mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());
describe('workspace refresh availability', () => {
  it('does not leave a failed connection labelled as a verified network', async () => {
    const state = useWorkspace();
    state.network = network;
    state.account = account;
    vi.mocked(api.network).mockRejectedValue(new ApiFailure('CHAIN_UNAVAILABLE'));
    await state.refresh();
    expect(state.network).toBeUndefined();
    expect(state.account?.id).toBe(account.id);
    expect(state.error).not.toBe('');
  });
  it('retains account identity when the session service is temporarily unavailable', async () => {
    const state = useWorkspace();
    state.account = account;
    vi.mocked(api.me).mockRejectedValue(new ApiFailure('SERVICE_UNAVAILABLE'));
    await state.refresh();
    expect(state.account?.id).toBe(account.id);
    expect(state.error).not.toBe('');
    expect(state.memberships).toEqual([]);
  });
  it('retains a verified session and clears stale memberships when the chain read fails', async () => {
    vi.mocked(api.memberships).mockRejectedValue(new ApiFailure('CHAIN_UNAVAILABLE'));
    const state = useWorkspace();
    await state.refresh();
    expect(state.account?.id).toBe(account.id);
    expect(state.error).toContain('blockchain node');
    expect(state.memberships).toEqual([]);
  });
  it('clears account state only when the service confirms authentication is required', async () => {
    const state = useWorkspace();
    state.account = account;
    vi.mocked(api.me).mockRejectedValue(new ApiFailure('AUTH_REQUIRED'));
    await state.refresh();
    expect(state.account).toBeUndefined();
    expect(state.error).toBe('');
    expect(state.loading).toBe(false);
  });
  it('ignores an older response that finishes after a newer refresh', async () => {
    let resolve: (value: Account) => void = () => {
      throw new Error('Deferred response is not ready');
    };
    const pending = new Promise<Account>((done) => {
      resolve = done;
    });
    const second = { ...account, id: randomUUID() };
    vi.mocked(api.me)
      .mockImplementationOnce(() => pending)
      .mockResolvedValueOnce(second);
    const state = useWorkspace();
    const firstRefresh = state.refresh();
    await vi.waitFor(() => expect(api.me).toHaveBeenCalledTimes(1));
    await state.refresh();
    resolve(account);
    await firstRefresh;
    expect(state.account?.id).toBe(second.id);
    expect(state.loading).toBe(false);
  });
});
