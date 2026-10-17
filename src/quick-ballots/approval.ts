import { ref } from 'vue';
import { z } from 'zod';
import { ABI, Serializer } from '@wharfkit/antelope';
import {
  QuickAccountContextSchema,
  QuickAccountIntentSchema,
  type QuickAccountContext,
  type QuickAccountAnchor,
} from '@daclify/core-protocol';
import {
  QuickAuthCodeHash,
  quickAuthAbi,
  quickAccountAction,
  quickAccountDigest,
  quickAccountRoot,
  validateQuickPreparation,
  decodeQuickAnchor,
} from '@daclify/core-protocol/sdk';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { api, ApiFailure } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import { selectedSigner } from '../auth/action-signer';
import { nativeWallet, transactNativeWithCosigners } from '../auth/telos-zero';
import { evmWallet, signEvmQuick } from '../auth/telos-evm';
import { signQuickApproval } from '../auth/session';
const pendingSchema = z.strictObject({ id: z.uuid(), expiresAt: z.iso.datetime() });
export const pendingQuick = ref<z.infer<typeof pendingSchema>>();
function scope() {
  const state = useWorkspace();
  if (!state.account || !state.network) throw Error('AUTH_REQUIRED');
  return JSON.stringify([
    resolveApiUrl('/'),
    state.account.id,
    state.network.chainId,
    state.network.runtime,
  ]);
}
const key = () => 'daclify.quick.pending.v1:' + scope();
export function restoreQuickPending() {
  pendingQuick.value = undefined;
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(localStorage.getItem(key()) ?? 'null'));
    if (parsed.success) pendingQuick.value = parsed.data;
  } catch {
    /* No local metadata can authorize an operation. */
  }
}
function clearPending() {
  localStorage.removeItem(key());
  pendingQuick.value = undefined;
}
async function submitQuick(input: Parameters<typeof api.quickAccountSubmit>[0], check: () => void) {
  try {
    return await api.quickAccountSubmit(input);
  } catch (cause) {
    check();
    if (
      cause instanceof ApiFailure &&
      ['QUICK_SUBMISSION_EXPIRED', 'QUICK_PREPARATION_EXPIRED'].includes(cause.code)
    )
      clearPending();
    throw cause;
  }
}
export async function resumeQuickApproval(check: () => void = () => {}) {
  const pending = pendingQuick.value;
  if (!pending) return;
  const before = scope();
  check();
  const result = await submitQuick({ id: pending.id, proof: '', incoming: '' }, () => {
    check();
    if (before !== scope()) throw Error('WALLET_CONTEXT_CHANGED');
  });
  check();
  if (before !== scope()) throw Error('WALLET_CONTEXT_CHANGED');
  if (result.state !== 'confirmed') throw Error('QUICK_SUBMISSION_PENDING');
  clearPending();
  return result.transactionId;
}
export function quickUsesDefault(context: QuickAccountContext) {
  const method = context.record ? decodeQuickAnchor(context.record.approval) : null;
  if (selectedSigner.value === 'native')
    return method?.kind === 'native' && method.account === nativeWallet.value?.actor.toString();
  if (selectedSigner.value === 'evm')
    return (
      method?.kind === 'evm' &&
      method.chainId === evmWallet.value?.chainId &&
      method.address === evmWallet.value.address.toLowerCase()
    );
  return false;
}
export async function approveQuick(
  value: unknown,
  intentValue: unknown,
  check: () => void = () => {},
): Promise<string> {
  const context = QuickAccountContextSchema.parse(value),
    intent = QuickAccountIntentSchema.parse(intentValue),
    state = useWorkspace(),
    before = scope(),
    native = nativeWallet.value,
    evm = evmWallet.value,
    mode = selectedSigner.value;
  const guard = () => {
    check();
    if (
      scope() !== before ||
      context.chainId !== state.network?.chainId ||
      context.runtime !== state.network.runtime ||
      native !== nativeWallet.value ||
      evm !== evmWallet.value ||
      mode !== selectedSigner.value
    )
      throw Error('WALLET_CONTEXT_CHANGED');
  };
  guard();
  if (
    context.authorityCodeHash !== QuickAuthCodeHash ||
    context.sourceCodeHash !== ModuleCodeHashes['quick-ballots']
  )
    throw Error('QUICK_UNAVAILABLE');
  restoreQuickPending();
  if (pendingQuick.value) throw Error('QUICK_SUBMISSION_PENDING');
  const prepared = validateQuickPreparation(
    await api.quickAccountPrepare({ expectedIdentity: context.identity, intent }),
    context,
    intent,
  );
  guard();
  const method =
    'useDefault' in intent && intent.useDefault
      ? context.record && decodeQuickAnchor(context.record.approval)
      : quickAccountRoot(context);
  if (!method) throw Error('QUICK_APPROVAL_REQUIRED');
  const digest = quickAccountDigest(prepared.action, prepared.request).toString();
  async function evmProof(credential: Extract<QuickAccountAnchor, { kind: 'evm' }>) {
    if (
      !evm ||
      evm.chainId !== credential.chainId ||
      evm.address.toLowerCase() !== credential.address
    )
      throw Error('WALLET_CONTEXT_CHANGED');
    const result = await signEvmQuick(
      { chainId: context.chainId, runtime: context.runtime },
      credential.chainId,
      digest,
    );
    guard();
    return result.slice(2);
  }
  const proof =
    method.kind === 'key'
      ? signQuickApproval(prepared)
      : method.kind === 'evm'
        ? await evmProof(method)
        : '';
  const incoming =
    intent.operation === 'default' && intent.method?.kind === 'evm'
      ? await evmProof(intent.method)
      : '';
  const action = quickAccountAction(prepared, { proof, incoming });
  const required = action.authorization.filter(
    (permission) =>
      permission.actor.toString() !== context.gateway.actor ||
      permission.permission.toString() !== context.gateway.permission,
  );
  let signedNative;
  if (required.length) {
    const signed = await transactNativeWithCosigners(action, required, guard, [
      { account: context.authority, abi: ABI.from(quickAuthAbi) },
    ]);
    signedNative = {
      packedTransaction: Serializer.encode({ object: signed.transaction }).hexString,
      signatures: signed.signatures.map((signature) => signature.toString()),
    };
  }
  guard();
  const pending = pendingSchema.parse({ id: prepared.id, expiresAt: prepared.expiresAt });
  localStorage.setItem(key(), JSON.stringify(pending));
  pendingQuick.value = pending;
  const result = await submitQuick(
    {
      id: prepared.id,
      proof,
      incoming,
      ...(signedNative ? { native: signedNative } : {}),
    },
    guard,
  );
  guard();
  if (result.state !== 'confirmed') throw Error('QUICK_SUBMISSION_PENDING');
  clearPending();
  return result.transactionId;
}

export async function configureQuickDefault(
  method: Exclude<QuickAccountAnchor, { kind: 'key' }> | null,
  check: () => void = () => {},
) {
  if (!useWorkspace().network?.capabilities.includes('quick-ballots-v1')) return;
  let status = await api.quickAccountStatus();
  check();
  if (!status.available) throw Error('QUICK_UNAVAILABLE');
  if (!status.context.record?.active) {
    await approveQuick(status.context, { operation: 'register' }, check);
    status = await api.quickAccountStatus();
    check();
    if (!status.available || !status.context.record?.active) throw Error('QUICK_ACCOUNT_CHANGED');
  }
  const context = status.context,
    current = context.record ? decodeQuickAnchor(context.record.approval) : null;
  const desired =
    method && JSON.stringify(context.anchor) !== JSON.stringify(method) ? method : null;
  if (JSON.stringify(current) !== JSON.stringify(desired))
    await approveQuick(context, { operation: 'default', method: desired }, check);
}
export async function deactivateQuickAccount(check: () => void = () => {}) {
  if (!useWorkspace().network?.capabilities.includes('quick-ballots-v1')) return;
  const status = await api.quickAccountStatus();
  check();
  if (status.available && status.context.record?.active)
    await approveQuick(
      status.context,
      { operation: 'deactivate', useDefault: quickUsesDefault(status.context) },
      check,
    );
}
