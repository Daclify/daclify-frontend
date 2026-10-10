import { shallowRef } from 'vue';
import { SessionKit, type Session } from '@wharfkit/session';
import { WebRenderer } from '@wharfkit/web-renderer';
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor';
import { Action, Serializer, SignedTransaction, Transaction } from '@wharfkit/antelope';
import {
  NativeIdentitySchema,
  NativeProofSchema,
  type NativeProof,
  type Network,
  RamQuoteSchema,
  type RamQuote,
  AssetRefSchema,
  type AssetRef,
  RecoveryContextSchema,
  recoverySigningMessage,
} from '@daclify/core-protocol';
import {
  encodeAction,
  runtimeAbi,
  nativeRamActions,
  nativeTokenOpenAction,
  recoveryMaterialFromSignature,
  type instruction,
} from '@daclify/core-protocol/sdk';
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
  action: Action | Action[],
  broadcast: boolean,
  checkContext: () => void = () => {},
) {
  const selected = nativeWallet.value;
  if (!selected) throw new Error('NATIVE_WALLET_MISSING');
  const workspace = useWorkspace(),
    accountId = workspace.account?.id,
    network = JSON.stringify([workspace.network?.chainId, workspace.network?.runtime]),
    location = globalThis.location?.href;
  const actions = Array.isArray(action) ? action : [action];
  const first = actions[0];
  if (!first) throw new Error('NATIVE_ACTION_REQUIRED');
  const result = await selected.transact(actions.length === 1 ? { action: first } : { actions }, {
    broadcast: false,
    allowModify: false,
    expireSeconds: 120,
    abis: [
      {
        account: workspace.network?.runtime ?? actions[0]?.account.toString() ?? '',
        abi: runtimeAbi,
      },
    ],
  });
  const transaction = result.resolved?.transaction;
  if (!transaction) throw new Error('NATIVE_PROOF_INVALID');
  if (
    network !== JSON.stringify([workspace.network?.chainId, workspace.network?.runtime]) ||
    location !== globalThis.location?.href ||
    accountId !== workspace.account?.id ||
    selected !== nativeWallet.value ||
    !result.signer.equals(selected.permissionLevel) ||
    result.chain.id.toString() !== selected.chain.id.toString() ||
    transaction.actions.length !== actions.length ||
    !actions.every((expected, index) => transaction.actions[index]?.equals(expected)) ||
    transaction.context_free_actions.length ||
    transaction.transaction_extensions.length ||
    Number(transaction.delay_sec) !== 0
  )
    throw new Error('WALLET_CONTEXT_CHANGED');
  checkContext();
  if (broadcast) {
    const executed = await selected.client.v1.chain.push_transaction(
      SignedTransaction.from({ ...transaction, signatures: result.signatures }),
    );
    if (
      executed.transaction_id !== transaction.id.toString() ||
      executed.processed.id !== transaction.id.toString() ||
      executed.processed.receipt.status !== 'executed'
    )
      throw new Error('NATIVE_EXECUTION_UNCONFIRMED');
  }
  return { transaction, signatures: result.signatures };
}
export async function nativeRamPurchase(
  value: RamQuote,
  checkContext: () => void,
): Promise<string> {
  const quote = RamQuoteSchema.parse(value),
    identity = nativeIdentity();
  const check = () => {
    const state = useWorkspace();
    if (
      nativeIdentity().account !== quote.order.payer ||
      identity.chainId !== quote.dao.chainId ||
      state.network?.chainId !== quote.dao.chainId ||
      state.network.runtime !== quote.dao.contract
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    if (quote.order.expires <= Date.now() / 1000) throw new Error('RAM_QUOTE_EXPIRED');
    checkContext();
  };
  check();
  const result = await transactNative(nativeRamActions(quote), true, check);
  return result.transaction.id.toString();
}
export async function nativeTokenPreparation(
  value: AssetRef,
  destination: string,
  checkContext: () => void,
): Promise<string> {
  const token = AssetRefSchema.parse(value),
    identity = nativeIdentity();
  const action = nativeTokenOpenAction(token, identity, destination);
  const check = () => {
    if (
      useWorkspace().network?.chainId !== token.chainId ||
      nativeIdentity().chainId !== token.chainId ||
      nativeIdentity().account !== destination
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    checkContext();
  };
  check();
  return (await transactNative(action, true, check)).transaction.id.toString();
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
export async function nativeRecoveryMaterial(input: unknown): Promise<Uint8Array> {
  const context = RecoveryContextSchema.parse(input),
    selected = nativeWallet.value,
    state = useWorkspace();
  if (!selected || !state.network) throw new Error('NATIVE_WALLET_MISSING');
  const identity = nativeIdentity(),
    runtime = state.network.runtime;
  if (
    context.mode !== 'wallet-protected' ||
    context.credentialKey !== `native:${identity.chainId}:${identity.account}` ||
    state.network.chainId !== identity.chainId ||
    globalThis.location?.origin !== context.origin
  )
    throw new Error('WALLET_CONTEXT_CHANGED');
  const accountId = state.account?.id,
    location = globalThis.location?.href;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(recoverySigningMessage(context)),
  );
  const intent = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const transaction = Transaction.from({
    expiration: '1970-01-01T00:00:01',
    ref_block_num: 0,
    ref_block_prefix: 0,
    max_net_usage_words: 0,
    max_cpu_usage_ms: 0,
    delay_sec: 0,
    context_free_actions: [],
    transaction_extensions: [],
    actions: [
      Action.from({
        account: runtime,
        name: 'authproof',
        authorization: [{ actor: identity.account, permission: identity.permission }],
        data: encodeAction('authproof', { account: identity.account, intent }),
      }),
    ],
  });
  const result = await selected.transact(
    { transaction },
    { broadcast: false, allowModify: false, abis: [{ account: runtime, abi: runtimeAbi }] },
  );
  if (
    nativeWallet.value !== selected ||
    state.account?.id !== accountId ||
    state.network.chainId !== identity.chainId ||
    state.network.runtime !== runtime ||
    globalThis.location?.href !== location ||
    !result.signer.equals(selected.permissionLevel) ||
    result.chain.id.toString() !== identity.chainId ||
    !result.resolved?.transaction.equals(transaction)
  )
    throw new Error('WALLET_CONTEXT_CHANGED');
  if (result.signatures.length !== 1 || !result.signatures[0])
    throw new Error('RECOVERY_WALLET_UNSUPPORTED');
  return recoveryMaterialFromSignature(result.signatures[0].toString());
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

export async function nativeNamesTransaction(
  actions: Action[],
  expectedHash: string,
  checkContext: () => void = () => {},
): Promise<string> {
  const action = actions[0];
  if (!action) throw new Error('NATIVE_ACTION_REQUIRED');
  const identity = nativeIdentity(),
    state = useWorkspace();
  if (
    identity.chainId !== state.network?.chainId ||
    !actions.every(
      (item) =>
        item.authorization.length === 1 &&
        item.authorization[0]?.actor.toString() === identity.account &&
        item.authorization[0]?.permission.toString() === 'active',
    )
  )
    throw new Error('NATIVE_UNLINKED');
  const wallet = nativeWallet.value;
  if (!wallet) throw new Error('NATIVE_WALLET_MISSING');
  const contract = action.account.toString();
  const context = JSON.stringify([
      state.account?.id,
      state.network?.chainId,
      state.network?.runtime,
      nativeWallet.value?.actor.toString(),
    ]),
    location = globalThis.location.href;
  const check = () => {
    checkContext();
    if (
      context !==
        JSON.stringify([
          state.account?.id,
          state.network?.chainId,
          state.network?.runtime,
          nativeWallet.value?.actor.toString(),
        ]) ||
      wallet !== nativeWallet.value ||
      location !== globalThis.location.href
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
  };
  const raw = await wallet.client.v1.chain.get_raw_abi(contract);
  check();
  if (raw.code_hash.toString() !== expectedHash) throw new Error('MODULE_CODE_CHANGED');
  return (await transactNative(actions, true, check)).transaction.id.toString();
}
