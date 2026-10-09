import { NetworkSchema, RamQuoteSchema } from '@daclify/core-protocol';
import { useWorkspace } from '../../src/state/workspace';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  Session,
  SigningRequest,
  TransactRevisions,
  ABI,
  Action,
  Transaction,
  PrivateKey,
  Serializer,
  SignedTransaction,
  PackedTransaction,
  type TransactOptions,
} from '@wharfkit/session';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import {
  nativeWallet,
  nativeIntentProof,
  nativeGovernance,
  nativeRamPurchase,
  nativeTokenPreparation,
} from '../../src/auth/telos-zero';
import {
  makeInstruction,
  encodeAction,
  runtimeAbi,
  nativeTokenOpenAction,
} from '@daclify/core-protocol/sdk';
const chainId = 'ab'.repeat(32),
  key = PrivateKey.generate('K1');
const wallet = new Session({
  chain: { id: chainId, url: 'https://native.example.test' },
  permissionLevel: 'alice@active',
  walletPlugin: new WalletPluginAnchor(),
});
const tokenAbi = ABI.from({
  version: 'eosio::abi/1.2',
  structs: [
    {
      name: 'open',
      base: '',
      fields: [
        { name: 'owner', type: 'name' },
        { name: 'symbol', type: 'symbol' },
        { name: 'ram_payer', type: 'name' },
      ],
    },
    {
      name: 'transfer',
      base: '',
      fields: [
        { name: 'from', type: 'name' },
        { name: 'to', type: 'name' },
        { name: 'quantity', type: 'asset' },
        { name: 'memo', type: 'string' },
      ],
    },
  ],
  actions: [
    { name: 'transfer', type: 'transfer', ricardian_contract: '' },
    { name: 'open', type: 'open', ricardian_contract: '' },
  ],
});
let options: TransactOptions | undefined,
  started = false,
  resolveApproval: () => void,
  extra = false;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('location', { href: 'https://app.example.test/dao/1/decide' });
  nativeWallet.value = wallet;
  const client = wallet.client;
  vi.spyOn(wallet, 'client', 'get').mockReturnValue(client);
  started = false;
  extra = false;
  vi.spyOn(wallet, 'transact').mockImplementation(async (args, selectedOptions) => {
    options = selectedOptions;
    const actions =
      'actions' in args && args.actions
        ? args.actions.map((a) => Action.from(a))
        : 'action' in args && args.action
          ? [Action.from(args.action)]
          : [];
    if (!actions.length) throw new Error('EXPECTED_ACTIONS');
    const action = actions[0];
    if (!action) throw new Error('EXPECTED_ACTION');
    const transaction = Transaction.from({
      expiration: '2026-10-07T12:00:00',
      ref_block_num: 1,
      ref_block_prefix: 2,
      actions: extra ? [...actions, action] : actions,
    });
    const request = await SigningRequest.create(
      { chainId, transaction },
      {
        abiProvider: {
          getAbi: async (account) =>
            account.toString() === 'eosio.token' ? tokenAbi : ABI.from(runtimeAbi),
        },
      },
    );
    const resolved = request.resolve(
      new Map([
        ['daclifycore', ABI.from(runtimeAbi)],
        ['eosio.token', tokenAbi],
      ]),
      wallet.permissionLevel,
      { chainId },
    );
    started = true;
    await new Promise<void>((resolve) => {
      resolveApproval = resolve;
    });
    return {
      chain: wallet.chain,
      request,
      resolved,
      returns: [],
      revisions: new TransactRevisions(request),
      signatures: [key.signDigest(resolved.transaction.signingDigest(chainId))],
      signer: wallet.permissionLevel,
      transaction: resolved.resolvedTransaction,
    };
  });
});
afterEach(() => {
  nativeWallet.value = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function pending() {
  await vi.waitFor(() => expect(started).toBe(true), { timeout: 1000, interval: 1 });
}
const payoutToken = { chainId, contract: 'eosio.token', symbol: 'TLOS', precision: 4 };
function payoutNetwork() {
  useWorkspace().network = NetworkSchema.parse({
    chainId,
    runtime: 'daclifycore',
    rpcUrl: 'https://native.example.test',
    hub: null,
    environment: 'local',
    interfaceVersion: 1,
    coreVersion: '0.7.0-alpha.1',
    capabilities: [],
  });
}
it('broadcasts only the receiving wallet’s exact owner-funded token preparation', async () => {
  payoutNetwork();
  const expected = nativeTokenOpenAction(
    payoutToken,
    { chainId, account: 'alice', permission: 'active' },
    'alice',
  );
  const push = vi
    .spyOn(wallet.client.v1.chain, 'push_transaction')
    .mockImplementation(async (value) => {
      const transaction =
        value instanceof PackedTransaction
          ? value.getSignedTransaction()
          : SignedTransaction.from(value);
      return {
        transaction_id: transaction.id.toString(),
        processed: {
          id: transaction.id.toString(),
          block_num: 1,
          block_time: '2026-10-07T12:00:00',
          receipt: { status: 'executed', cpu_usage_us: 1, net_usage_words: 1 },
          elapsed: 1,
          net_usage: 1,
          scheduled: false,
          action_traces: [],
          account_ram_delta: null,
        },
      };
    });
  const operation = nativeTokenPreparation(payoutToken, 'alice', () => {});
  await pending();
  expect(options).toMatchObject({ broadcast: false, allowModify: false });
  resolveApproval();
  expect(await operation).toMatch(/^[0-9a-f]{64}$/);
  expect(push).toHaveBeenCalledOnce();
  const sent = push.mock.calls[0]?.[0];
  if (!sent) throw new Error('EXPECTED_TRANSACTION');
  const transaction =
    sent instanceof PackedTransaction ? sent.getSignedTransaction() : SignedTransaction.from(sent);
  expect(transaction.actions).toHaveLength(1);
  expect(transaction.actions[0]?.equals(expected)).toBe(true);
});
it.each(['receiver', 'network', 'token', 'extra-action', 'disconnect'] as const)(
  'refuses token preparation when %s changes during approval',
  async (change) => {
    payoutNetwork();
    let unchanged = true;
    extra = change === 'extra-action';
    const push = vi.spyOn(wallet.client.v1.chain, 'push_transaction');
    const operation = nativeTokenPreparation(payoutToken, 'alice', () => {
      if (!unchanged) throw new Error('WALLET_CONTEXT_CHANGED');
    });
    await pending();
    if (change === 'receiver' || change === 'token') unchanged = false;
    if (change === 'network') {
      const state = useWorkspace();
      if (!state.network) throw new Error('EXPECTED_NETWORK');
      state.network = { ...state.network, chainId: 'cd'.repeat(32) };
    }
    if (change === 'disconnect') nativeWallet.value = undefined;
    resolveApproval();
    await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
    expect(push).not.toHaveBeenCalled();
  },
);
it('refuses preparation with another receiving wallet before requesting a signature', async () => {
  payoutNetwork();
  await expect(nativeTokenPreparation(payoutToken, 'bob', () => {})).rejects.toThrow(
    'PAYOUT_WALLET_REQUIRED',
  );
  expect(wallet.transact).not.toHaveBeenCalled();
});
it('returns exact signed intent bytes without allowing the wallet plugin to broadcast', async () => {
  const operation = nativeIntentProof('daclifycore', 'operation-bound intent');
  await pending();
  expect(options).toMatchObject({ broadcast: false, allowModify: false });
  resolveApproval();
  const proof = await operation;
  const tx = Serializer.decode({ type: Transaction, data: proof.packedTransaction });
  expect(tx.actions[0]?.name.toString()).toBe('authproof');
  expect(proof.signatures).toHaveLength(1);
  expect(proof.packedTransaction).toMatch(/^[0-9a-f]+$/);
});
it.each(['route', 'disconnect', 'extra-action', 'network'] as const)(
  'rejects changed %s before broadcasting native governance',
  async (change) => {
    extra = change === 'extra-action';
    const request = makeInstruction(
      { chainId, contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
      '1',
      '0',
      100,
      'daclifycore',
      'unlinknat',
      encodeAction('unlinknat', { runtime: 'daclifycore', dao_id: '1', member_id: '1' }),
    );
    const push = vi.spyOn(wallet.client.v1.chain, 'push_transaction');
    const operation = nativeGovernance(request, 'alice');
    await pending();
    if (change === 'network')
      useWorkspace().network = NetworkSchema.parse({
        chainId: 'cd'.repeat(32),
        runtime: 'daclifycore',
        rpcUrl: 'https://native.example.test',
        hub: null,
        environment: 'local',
        interfaceVersion: 1,
        coreVersion: '0.5.0-alpha.1',
        capabilities: [],
      });
    if (change === 'route') globalThis.location.href = 'https://app.example.test/dao/2';
    if (change === 'disconnect') nativeWallet.value = undefined;
    resolveApproval();
    await expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
    expect(push).not.toHaveBeenCalled();
  },
);
it('preserves wallet cancellation and never broadcasts the refused operation', async () => {
  vi.spyOn(wallet, 'transact').mockRejectedValue(new Error('USER_CANCELLED'));
  const push = vi.spyOn(wallet.client.v1.chain, 'push_transaction');
  await expect(nativeIntentProof('daclifycore', 'intent')).rejects.toThrow('USER_CANCELLED');
  expect(push).not.toHaveBeenCalled();
});

it.each(['network', 'route', 'consent', 'extra-action', 'disconnect'] as const)(
  'rejects RAM purchase when %s changes while wallet approval is pending',
  async (change) => {
    const state = useWorkspace();
    state.network = NetworkSchema.parse({
      chainId,
      runtime: 'daclifycore',
      rpcUrl: 'https://native.example.test',
      hub: null,
      environment: 'local',
      interfaceVersion: 1,
      coreVersion: '0.7.0-alpha.1',
      capabilities: [],
    });
    const quote = RamQuoteSchema.parse({
      dao: { chainId, contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
      rail: 'tlos',
      baseUnits: '100',
      feeUnits: '5',
      totalUnits: '105',
      feeBps: 500,
      order: {
        dao_id: '1',
        payer: 'alice',
        reference: 'cd'.repeat(32),
        policy_revision: '1',
        maximum: '0.0105 TLOS',
        expires: Math.floor(Date.now() / 1000) + 300,
        purchases: [{ receiver: 'daclifycore', quantity: '0.0100 TLOS', minimum_bytes: '1024' }],
      },
      systemCodeHash: 'ef'.repeat(32),
      systemRawAbiHash: 'fe'.repeat(32),
      quotedAt: new Date().toISOString(),
    });
    let approved = true;
    extra = change === 'extra-action';
    const push = vi.spyOn(wallet.client.v1.chain, 'push_transaction');
    const operation = nativeRamPurchase(quote, () => {
      if (!approved) throw new Error('CONSENT_CHANGED');
    });
    await pending();
    if (change === 'network') state.network = { ...state.network, chainId: 'cd'.repeat(32) };
    if (change === 'route') globalThis.location.href = 'https://app.example.test/dao/2';
    if (change === 'consent') approved = false;
    if (change === 'disconnect') nativeWallet.value = undefined;
    resolveApproval();
    await expect(operation).rejects.toThrow();
    expect(push).not.toHaveBeenCalled();
  },
);
