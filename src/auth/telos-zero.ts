import { shallowRef } from 'vue';
import { SessionKit, type Session } from '@wharfkit/session';
import { WebRenderer } from '@wharfkit/web-renderer';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { Action, Serializer, SignedTransaction } from '@wharfkit/antelope';
import {
  NativeIdentitySchema,
  NativeProofSchema,
  type NativeProof,
  type Network,
} from '@daclify/core-protocol';
import { encodeAction, runtimeAbi, type instruction } from '@daclify/core-protocol/sdk';
import { api } from '../api/client';
import { useWorkspace } from '../state/workspace';
export const nativeWallet = shallowRef<Session>();
let kit: SessionKit | undefined;
let configuredChain = '';
function walletKit(network: Network): SessionKit {
  if (!kit || configuredChain !== network.chainId) {
    nativeWallet.value = undefined;
    kit = new SessionKit(
      {
        appName: 'Daclify',
        chains: [{ id: network.chainId, url: network.rpcUrl }],
        ui: new WebRenderer(),
        walletPlugins: [new WalletPluginAnchor()],
      },
      { allowModify: false, expireSeconds: 120 },
    );
    configuredChain = network.chainId;
  }
  return kit;
}
export async function connectNative(): Promise<Session> {
  const network = await api.network(),
    current = walletKit(network);
  const { session } = await current.login();
  if (session.chain.id.toString() !== network.chainId || session.permission.toString() !== 'active')
    throw new Error('NATIVE_AUTHORITY_UNSUPPORTED');
  nativeWallet.value = session;
  return session;
}
export async function disconnectNative(): Promise<void> {
  const previous = nativeWallet.value;
  nativeWallet.value = undefined;
  if (previous && kit) await kit.logout(previous);
}
export function nativeIdentity() {
  const session = nativeWallet.value;
  if (!session) throw new Error('NATIVE_WALLET_MISSING');
  return NativeIdentitySchema.parse({
    chainId: session.chain.id.toString(),
    account: session.actor.toString(),
    permission: session.permission.toString(),
  });
}
async function transactNative(
  action: Action,
  broadcast: boolean,
  checkContext: () => void = () => {},
) {
  const selected = nativeWallet.value;
  if (!selected) throw new Error('NATIVE_WALLET_MISSING');
  const workspace = useWorkspace(),
    accountId = workspace.account?.id,
    network = JSON.stringify([workspace.network?.chainId, workspace.network?.runtime]),
    location = globalThis.location?.href;
  const result = await selected.transact(
    { action },
    {
      broadcast: false,
      allowModify: false,
      expireSeconds: 120,
      abis: [{ account: action.account, abi: runtimeAbi }],
    },
  );
  const transaction = result.resolved?.transaction;
  if (!transaction) throw new Error('NATIVE_PROOF_INVALID');
  if (
    network !== JSON.stringify([workspace.network?.chainId, workspace.network?.runtime]) ||
    location !== globalThis.location?.href ||
    accountId !== workspace.account?.id ||
    selected !== nativeWallet.value ||
    !result.signer.equals(selected.permissionLevel) ||
    result.chain.id.toString() !== selected.chain.id.toString() ||
    transaction.actions.length !== 1 ||
    !transaction.actions[0]?.equals(action) ||
    transaction.context_free_actions.length ||
    transaction.transaction_extensions.length ||
    Number(transaction.delay_sec) !== 0
  )
    throw new Error('WALLET_CONTEXT_CHANGED');
  checkContext();
  if (broadcast)
    await selected.client.v1.chain.push_transaction(
      SignedTransaction.from({ ...transaction, signatures: result.signatures }),
    );
  return { transaction, signatures: result.signatures };
}
export async function nativeIntentProof(runtime: string, message: string): Promise<NativeProof> {
  const selected = nativeIdentity();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  const intent = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const action = Action.from({
    account: runtime,
    name: 'authproof',
    authorization: [{ actor: selected.account, permission: selected.permission }],
    data: encodeAction('authproof', { account: selected.account, intent }),
  });
  const result = await transactNative(action, false);
  if (!result.transaction) throw new Error('NATIVE_PROOF_INVALID');
  return NativeProofSchema.parse({
    packedTransaction: Serializer.encode({ object: result.transaction }).hexString,
    signatures: result.signatures.map((signature) => signature.toString()),
  });
}
export async function nativeGovernance(
  request: instruction,
  memberAccount: string,
  rootSignature?: string,
  checkContext?: () => void,
): Promise<string> {
  const identity = nativeIdentity();
  if (
    identity.chainId !== request.chain_id ||
    (!rootSignature && memberAccount !== identity.account)
  )
    throw new Error('NATIVE_UNLINKED');
  const action = Action.from({
    account: request.deployment,
    name: rootSignature ? 'submit' : 'submitnat',
    authorization: [{ actor: identity.account, permission: identity.permission }],
    data: rootSignature
      ? encodeAction('submit', { request, sig: rootSignature })
      : encodeAction('submitnat', { request }),
  });
  const result = await transactNative(action, true, checkContext);
  if (!result.transaction) throw new Error('NATIVE_PROOF_INVALID');
  // Broadcast confirmation comes from the configured chain; browser connection alone grants nothing.
  return result.transaction.id.toString();
}
