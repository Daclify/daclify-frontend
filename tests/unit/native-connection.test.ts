import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  LoginContext,
  Session,
  SessionKit,
  SigningRequest,
  TransactRevisions,
  type LoginResult,
} from '@wharfkit/session';
import { ABI, Action, Transaction, PrivateKey, PermissionLevel } from '@wharfkit/antelope';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { AccountSchema, NetworkSchema } from '@daclify/core-protocol';
import { api } from '../../src/api/client';
import { configureNetworks } from '../../src/api/networks';
import { useWorkspace } from '../../src/state/workspace';
import {
  connectNative,
  disconnectNative,
  nativeWallet,
  transactNativeWithCosigners,
} from '../../src/auth/telos-zero';

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
it.each([false, true])(
  'collects two exact native approvals without changing the selected wallet; context change=%s',
  async (change) => {
    const approval = pending(),
      connection = connectNative(),
      kit = await approval.ready(),
      alice = session('alice'),
      bob = session('bob');
    approval.approve(alice, kit);
    await connection;
    vi.spyOn(kit, 'restoreAll').mockResolvedValue([alice, bob]);
    const abi = ABI.from({
      version: 'eosio::abi/1.2',
      structs: [{ name: 'approve', base: '', fields: [] }],
      actions: [{ name: 'approve', type: 'approve', ricardian_contract: '' }],
    });
    const action = Action.from({
      account: 'quickauth',
      name: 'approve',
      authorization: [PermissionLevel.from('alice@active'), PermissionLevel.from('bob@active')],
      data: '',
    });
    const keys = { alice: PrivateKey.generate('K1'), bob: PrivateKey.generate('K1') };
    async function signed(wallet: Session, transaction: Transaction, key: PrivateKey) {
      const request = await SigningRequest.create(
        { chainId: network.chainId, transaction },
        { abiProvider: { getAbi: async () => abi } },
      );
      const resolved = request.resolve(new Map([['quickauth', abi]]), wallet.permissionLevel, {
        chainId: network.chainId,
      });
      return {
        chain: wallet.chain,
        request,
        resolved,
        returns: [],
        revisions: new TransactRevisions(request),
        signatures: [key.signDigest(transaction.signingDigest(network.chainId))],
        signer: wallet.permissionLevel,
        transaction: resolved.resolvedTransaction,
      };
    }
    const transaction = Transaction.from({
      expiration: new Date(Date.now() + 60_000).toISOString().slice(0, 19),
      ref_block_num: 1,
      ref_block_prefix: 2,
      actions: [action],
    });
    vi.spyOn(alice, 'transact').mockImplementation(async () =>
      signed(alice, transaction, keys.alice),
    );
    const consent = vi.spyOn(bob, 'transact').mockImplementation(async (args) => {
      if (!('transaction' in args) || !args.transaction) throw Error('EXACT_TRANSACTION_REQUIRED');
      expect(Transaction.from(args.transaction).equals(transaction)).toBe(true);
      if (change) useWorkspace().network = { ...network, runtime: 'different' };
      return signed(bob, transaction, keys.bob);
    });
    const operation = transactNativeWithCosigners(
      action,
      [PermissionLevel.from('alice@active'), PermissionLevel.from('bob@active')],
      () => {},
      [{ account: 'quickauth', abi }],
    );
    if (change) await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
    else {
      const result = await operation;
      expect(result.signatures).toHaveLength(2);
      expect(
        result.signatures.some((signature) =>
          signature.verifyDigest(transaction.signingDigest(network.chainId), keys.alice.toPublic()),
        ),
      ).toBe(true);
      expect(
        result.signatures.some((signature) =>
          signature.verifyDigest(transaction.signingDigest(network.chainId), keys.bob.toPublic()),
        ),
      ).toBe(true);
      expect(nativeWallet.value).toBe(alice);
    }
    expect(consent).toHaveBeenCalledTimes(1);
  },
);
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
