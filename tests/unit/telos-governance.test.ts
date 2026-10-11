import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  ABI,
  API,
  Blob as ChainBlob,
  Checksum256,
  PrivateKey,
  Serializer,
  Transaction,
  Action,
  SignedTransaction,
  PackedTransaction,
} from '@wharfkit/antelope';
import { Session, SigningRequest, TransactRevisions } from '@wharfkit/session';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { TelosVotePreparationSchema } from '@daclify/modules';
import { telosDecideAbi } from '@daclify/modules/sdk';
import { nativeWallet } from '../../src/auth/telos-zero';
import { useWorkspace } from '../../src/state/workspace';
import { api } from '../../src/api/client';
import { nativeTelosVote, TelosVoteUnconfirmed } from '../../src/auth/telos-governance';
import { resourceInfo } from '../fixtures/resource-rpc';
const abi = ABI.from(telosDecideAbi),
  bytes = Serializer.encode({ object: abi }),
  chainId = 'ab'.repeat(32),
  key = PrivateKey.generate('K1');
const raw = API.v1.GetRawAbiResponse.from({
  account_name: 'telos.decide',
  code_hash: 'cd'.repeat(32),
  abi_hash: Checksum256.hash(bytes.array),
  abi: new ChainBlob(bytes.array),
});
const preparation = () =>
  TelosVotePreparationSchema.parse({
    source: {
      chainId,
      rpcUrl: 'https://native.example.test',
      contract: 'telos.decide',
      environment: 'testnet',
      codeHash: raw.code_hash.toString(),
      abiHash: raw.abi_hash.toString(),
    },
    ballot: {
      ballot_name: 'ballot',
      category: 'election',
      publisher: 'publisher',
      status: 'voting',
      title: 'Council',
      description: '',
      content: '',
      treasury_symbol: '4,VOTE',
      voting_method: '1token1vote',
      min_options: 1,
      max_options: 1,
      options: [{ key: 'yes', value: '0.0000 VOTE' }],
      total_voters: 0,
      total_delegates: 0,
      total_raw_weight: '0.0000 VOTE',
      cleaned_count: 0,
      settings: [
        { key: 'votestake', value: 1 },
        { key: 'revotable', value: 1 },
      ],
      begin_time: '2020-01-01T00:00:00',
      end_time: '2090-01-01T00:00:00',
    },
    voter: { account: 'alice', registered: true, weight: '10.0000 VOTE', alreadyVoted: false },
    options: ['yes'],
    expires: new Date(Date.now() + 60000).toISOString(),
  });
let wallet: Session,
  release: () => void,
  started = false,
  extra = false;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('location', { href: 'https://app.example.test/telos' });
  useWorkspace().network = {
    chainId,
    rpcUrl: 'https://native.example.test',
    runtime: 'daclifycore',
    hub: null,
    environment: 'testnet',
    interfaceVersion: 1,
    coreVersion: '0.14.0-alpha.1',
    capabilities: [],
  };
  wallet = new Session({
    chain: { id: chainId, url: 'https://native.example.test' },
    permissionLevel: 'alice@active',
    walletPlugin: new WalletPluginAnchor(),
  });
  nativeWallet.value = wallet;
  started = false;
  extra = false;
  const client = wallet.client;
  vi.spyOn(wallet, 'client', 'get').mockReturnValue(client);
  vi.spyOn(api, 'telosPrepare').mockImplementation(async () => preparation());
  vi.spyOn(wallet.client.v1.chain, 'get_info').mockResolvedValue(
    API.v1.GetInfoResponse.from(resourceInfo),
  );
  vi.spyOn(wallet.client.v1.chain, 'get_raw_abi').mockResolvedValue(raw);
  vi.spyOn(wallet, 'transact').mockImplementation(async (args) => {
    const actions =
      'actions' in args && args.actions
        ? args.actions.map((a) => Action.from(a))
        : 'action' in args && args.action
          ? [Action.from(args.action)]
          : [];
    if (extra && actions[0]) actions.push(actions[0]);
    const transaction = Transaction.from({
      expiration: new Date(Date.now() + 120000),
      ref_block_num: 1,
      ref_block_prefix: 2,
      actions,
    });
    const request = await SigningRequest.create(
      { chainId, transaction },
      { abiProvider: { getAbi: async () => abi } },
    );
    const resolved = request.resolve(new Map([['telos.decide', abi]]), wallet.permissionLevel, {
      chainId,
    });
    started = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      chain: wallet.chain,
      request,
      resolved,
      returns: [],
      revisions: new TransactRevisions(request),
      signatures: [key.signDigest(transaction.signingDigest(chainId))],
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
it('broadcasts the exact external vote after live state is checked again', async () => {
  let sent: SignedTransaction | undefined;
  vi.spyOn(wallet.client.v1.chain, 'push_transaction').mockImplementation(async (value) => {
    sent =
      value instanceof PackedTransaction
        ? value.getSignedTransaction()
        : SignedTransaction.from(value);
    return {
      transaction_id: sent.id.toString(),
      processed: {
        id: sent.id.toString(),
        block_num: 1,
        block_time: '2026-10-11T12:00:00',
        receipt: { status: 'executed', cpu_usage_us: 1, net_usage_words: 1 },
        elapsed: 1,
        net_usage: 1,
        scheduled: false,
        action_traces: [],
        account_ram_delta: null,
      },
    };
  });
  const operation = nativeTelosVote(preparation(), () => {});
  await vi.waitFor(() => expect(started).toBe(true));
  release();
  expect(await operation).toMatch(/^[0-9a-f]{64}$/);
  expect(
    sent?.actions.map((a) => [
      a.account.toString(),
      a.name.toString(),
      a.authorization[0]?.toString(),
    ]),
  ).toEqual([['telos.decide', 'castvote', 'alice@active']]);
});
it('refuses a modified transaction and a changed route during wallet approval', async () => {
  extra = true;
  const operation = nativeTelosVote(preparation(), () => {});
  const rejection = expect(operation).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  await vi.waitFor(() => expect(started).toBe(true));
  release();
  await rejection;
  extra = false;
  started = false;
  const moved = nativeTelosVote(preparation(), () => {});
  const rejected = expect(moved).rejects.toThrow('WALLET_CONTEXT_CHANGED');
  await vi.waitFor(() => expect(started).toBe(true));
  vi.stubGlobal('location', { href: 'https://app.example.test/other' });
  release();
  await rejected;
});
it('retains the signed transaction identity when the broadcast response is lost', async () => {
  let reference: string | undefined;
  vi.spyOn(wallet.client.v1.chain, 'push_transaction').mockImplementation(async () => {
    expect(reference).toMatch(/^[0-9a-f]{64}$/);
    throw new Error('Response lost');
  });
  const operation = nativeTelosVote(
    preparation(),
    () => {},
    (id) => {
      reference = id;
    },
  );
  const rejection = expect(operation).rejects.toBeInstanceOf(TelosVoteUnconfirmed);
  await vi.waitFor(() => expect(started).toBe(true));
  release();
  await rejection;
  try {
    await operation;
  } catch (cause) {
    expect(cause).toBeInstanceOf(TelosVoteUnconfirmed);
    if (cause instanceof TelosVoteUnconfirmed) expect(cause.transactionId).toBe(reference);
  }
});

it('refuses changed live ballot rules after wallet approval without broadcasting', async () => {
  const broadcast = vi.spyOn(wallet.client.v1.chain, 'push_transaction');
  const operation = nativeTelosVote(preparation(), () => {});
  const rejected = expect(operation).rejects.toThrow('TELOS_BALLOT_CHANGED');
  await vi.waitFor(() => expect(started).toBe(true));
  vi.spyOn(api, 'telosPrepare').mockImplementation(async () => {
    const value = preparation();
    return { ...value, ballot: { ...value.ballot, voting_method: '1acct1vote' } };
  });
  release();
  await rejected;
  expect(broadcast).not.toHaveBeenCalled();
});
