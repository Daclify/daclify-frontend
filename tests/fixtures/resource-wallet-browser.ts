// Disposable signing fixture for browser tests; never imported by application code.
import { Session, SigningRequest, TransactRevisions } from '@wharfkit/session';
import { PrivateKey, Transaction, Action } from '@wharfkit/antelope';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { nativeWallet } from '../../src/auth/telos-zero';
import { useWorkspace } from '../../src/state/workspace';
import { resourceAbi } from './resource-rpc';

let approve: (() => void) | undefined;
export function approveResourceWallet() {
  approve?.();
}
export function installResourceWallet(waitForApproval = false) {
  const network = useWorkspace().network;
  if (!network) throw new Error('EXPECTED_NETWORK');
  const key = PrivateKey.generate('K1');
  const wallet = new Session({
    chain: { id: network.chainId, url: network.rpcUrl },
    permissionLevel: 'alice@active',
    walletPlugin: new WalletPluginAnchor(),
  });
  wallet.transact = async (args) => {
    const actions =
      'actions' in args && args.actions
        ? args.actions.map((row) => Action.from(row))
        : 'action' in args && args.action
          ? [Action.from(args.action)]
          : [];
    const transaction = Transaction.from({
      expiration: new Date(Date.now() + 120000).toISOString().slice(0, -5),
      ref_block_num: 100,
      ref_block_prefix: 100,
      actions,
    });
    const request = await SigningRequest.create(
      { chainId: network.chainId, transaction },
      {
        abiProvider: { getAbi: async () => resourceAbi },
      },
    );
    const resolved = request.resolve(new Map([['eosio', resourceAbi]]), wallet.permissionLevel, {
      chainId: network.chainId,
    });
    if (waitForApproval)
      await new Promise<void>((resolve) => {
        approve = resolve;
      });
    return {
      chain: wallet.chain,
      request,
      resolved,
      returns: [],
      revisions: new TransactRevisions(request),
      signatures: [key.signDigest(resolved.transaction.signingDigest(network.chainId))],
      signer: wallet.permissionLevel,
      transaction: resolved.resolvedTransaction,
    };
  };
  nativeWallet.value = wallet;
}
