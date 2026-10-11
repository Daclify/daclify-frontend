// Disposable Anchor boundary fixture; application code never imports this file.
import {
  Session,
  SessionKit,
  LoginContext,
  SigningRequest,
  TransactRevisions,
} from '@wharfkit/session';
import WebRenderer from '@wharfkit/web-renderer';
import { ABI, Action, PrivateKey, Transaction } from '@wharfkit/antelope';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { runtimeAbi } from '@daclify/core-protocol/sdk';
import { telosDecideAbi } from '@daclify/modules/sdk';
import { nativeWallet } from '../../src/auth/telos-zero';
import { useWorkspace } from '../../src/state/workspace';
export function installTelosWallet(privateKey: string, interceptLogin = false) {
  const network = useWorkspace().network;
  if (!network) throw new Error('Network required');
  const key = PrivateKey.from(privateKey),
    core = ABI.from(runtimeAbi),
    decide = ABI.from(telosDecideAbi);
  const wallet = new Session({
    chain: { id: network.chainId, url: network.rpcUrl },
    permissionLevel: 'alice@active',
    walletPlugin: new WalletPluginAnchor(),
  });
  wallet.transact = async (args) => {
    const actions =
      'actions' in args && args.actions
        ? args.actions.map((a) => Action.from(a))
        : 'action' in args && args.action
          ? [Action.from(args.action)]
          : [];
    const transaction = Transaction.from({
      expiration: new Date(Date.now() + 120000),
      ref_block_num: 1,
      ref_block_prefix: 2,
      actions,
    });
    const abis = new Map([
      [network.runtime, core],
      ['telos.decide', decide],
    ]);
    const request = await SigningRequest.create(
      { chainId: network.chainId, transaction },
      {
        abiProvider: {
          getAbi: async (name) => {
            const abi = abis.get(name.toString());
            if (!abi) throw new Error('Unexpected contract');
            return abi;
          },
        },
      },
    );
    const resolved = request.resolve(abis, wallet.permissionLevel, { chainId: network.chainId });
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
  };
  nativeWallet.value = wallet;
  if (interceptLogin)
    SessionKit.prototype.login = async () => ({
      context: new LoginContext({
        fetch: window.fetch.bind(window),
        ui: new WebRenderer(),
        chain: wallet.chain,
      }),
      response: { chain: wallet.chain.id, permissionLevel: wallet.permissionLevel },
      session: wallet,
    });
}
