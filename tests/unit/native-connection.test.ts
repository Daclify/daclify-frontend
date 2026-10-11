import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { LoginContext, Session, SessionKit, type LoginResult } from '@wharfkit/session';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { AccountSchema, NetworkSchema } from '@daclify/core-protocol';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
import { useWorkspace } from '../../src/state/workspace';
import { connectNative, disconnectNative, nativeWallet } from '../../src/auth/telos-zero';

// Wallet UI needs a real browser; retain real SessionKit/Session and replace only its renderer.
vi.mock('@wharfkit/web-renderer', () => ({ WebRenderer: class {} }));
const network = NetworkSchema.parse({
  chainId: 'ab'.repeat(32),
  rpcUrl: 'https://native.example',
  runtime: 'daclifycore',
  hub: null,
  environment: 'local',
  interfaceVersion: 1,
  coreVersion: '0.13.0-alpha.4',
  capabilities: [],
});
function session(actor: string) {
  return new Session({
    chain: { id: network.chainId, url: network.rpcUrl },
    permissionLevel: actor + '@active',
    walletPlugin: new WalletPluginAnchor(),
  });
}
function result(wallet: Session, kit: SessionKit): LoginResult {
  return {
    session: wallet,
    response: { chain: wallet.chain.id, permissionLevel: wallet.permissionLevel },
    context: new LoginContext({ fetch: kit.fetch, ui: kit.ui, chain: wallet.chain }),
  };
}
function deferred<T>() {
  let accept: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    accept = resolve;
  });
  return { promise, resolve: (value: T) => accept(value) };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('location', { origin: 'https://app.example', href: 'https://app.example/status' });
  vi.stubGlobal('window', { location: globalThis.location });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  configureNetworks({ production: 'https://api.example', testnet: 'https://test-api.example' });
  useWorkspace().network = network;
  nativeWallet.value = undefined;
  vi.spyOn(api, 'network').mockResolvedValue(network);
});
afterEach(() => {
  nativeWallet.value = undefined;
  configureNetworks(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pending() {
  const approval = deferred<LoginResult>();
  const login = vi.spyOn(SessionKit.prototype, 'login').mockReturnValue(approval.promise);
  return {
    async ready() {
      await vi.waitFor(() => expect(login).toHaveBeenCalled());
      const kit = login.mock.contexts[0];
      if (!(kit instanceof SessionKit)) throw new Error('EXPECTED_SESSION_KIT');
      return kit;
    },
    approve(wallet: Session, kit: SessionKit) {
      approval.resolve(result(wallet, kit));
    },
  };
}
it('keeps a pending Anchor connection cancelled after disconnect', async () => {
  const approval = pending(),
    operation = connectNative();
  const kit = await approval.ready();
  await disconnectNative();
  approval.approve(session('alice'), kit);
  await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  expect(nativeWallet.value).toBeUndefined();
});
it('cancels before offering Anchor when disconnect happens during the network read', async () => {
  const read = deferred<Awaited<ReturnType<typeof api.network>>>();
  vi.spyOn(api, 'network').mockReturnValueOnce(read.promise);
  const login = vi
    .spyOn(SessionKit.prototype, 'login')
    .mockRejectedValue(new Error('UNEXPECTED_WALLET_PROMPT'));
  const operation = connectNative();
  await disconnectNative();
  read.resolve(network);
  await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  expect(login).not.toHaveBeenCalled();
  expect(nativeWallet.value).toBeUndefined();
});
it.each(['network', 'rpc', 'account', 'api'] as const)(
  'does not attach a wallet approved for a changed %s context',
  async (change) => {
    const approval = pending(),
      operation = connectNative();
    const kit = await approval.ready();
    const state = useWorkspace();
    if (change === 'network') state.network = { ...network, chainId: 'cd'.repeat(32) };
    if (change === 'rpc') state.network = { ...network, rpcUrl: 'https://other.example' };
    if (change === 'account')
      state.account = AccountSchema.parse({
        id: crypto.randomUUID(),
        custody: 'user-controlled',
        signingKey: null,
        encryptionKey: null,
      });
    if (change === 'api')
      configureNetworks({
        production: 'https://other-api.example',
        testnet: 'https://other-test-api.example',
      });
    approval.approve(session('alice'), kit);
    await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
    expect(nativeWallet.value).toBeUndefined();
  },
);
it('keeps the newer payer when two connections finish in reverse order', async () => {
  const first = deferred<LoginResult>(),
    second = deferred<LoginResult>();
  const login = vi
    .spyOn(SessionKit.prototype, 'login')
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const older = connectNative();
  await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
  const newer = connectNative();
  await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(2));
  const kit = login.mock.contexts[0];
  if (!(kit instanceof SessionKit)) throw new Error('EXPECTED_SESSION_KIT');
  const bob = session('bob');
  second.resolve(result(bob, kit));
  expect(await newer).toBe(bob);
  first.resolve(result(session('alice'), kit));
  await expect(older).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  expect(nativeWallet.value).toBe(bob);
});
it('attaches an approved active payer when the connection context stays current', async () => {
  const approval = pending(),
    operation = connectNative();
  const kit = await approval.ready(),
    alice = session('alice');
  approval.approve(alice, kit);
  expect(await operation).toBe(alice);
  expect(nativeWallet.value).toBe(alice);
});
