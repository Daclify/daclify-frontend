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
  type TransactOptions,
} from '@wharfkit/session';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import {
  nativeWallet,
  nativeIntentProof,
  nativeGovernance,
  nativeRamPurchase,
} from '../../src/auth/telos-zero';
import { makeInstruction, encodeAction, runtimeAbi } from '@daclify/core-protocol/sdk';
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
  actions: [{ name: 'transfer', type: 'transfer', ricardian_contract: '' }],
});
let options: TransactOptions | undefined,
  started = false,
  resolveApproval: () => void,
  extra = false;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('location', { href: 'https://app.example.test/dao/1/decide' });
  nativeWallet.value = wallet;
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
