import { useWorkspace } from '../state/workspace';
import { ref, watch } from 'vue';
import type { UserMembership } from '@daclify/core-protocol';
import type { instruction } from '@daclify/core-protocol/sdk';
import { api } from '../api/client';
import { canUseVaultKey, relayWithVault, signInstruction } from './session';
import { resolveApiUrl, assertOperatorDao } from '../api/networks';
import { nativeWallet, nativeGovernance, nativeIdentity } from './telos-zero';
import { evmWallet, signEvmGovernance, signEvmBinding } from './telos-evm';
import { makeInstruction, encodeAction } from '@daclify/core-protocol/sdk';
import { preferredApproval } from './approval-preference';
export const selectedSigner = ref<'vault' | 'native' | 'evm'>('vault');
const evmAuthorizations = ref(
  new Map<string, NonNullable<Awaited<ReturnType<typeof api.evmBinding>>['binding']>>(),
);
let authorizationRevision = 0;
const memberKey = (member: UserMembership) =>
  JSON.stringify([
    useWorkspace().account?.id,
    useWorkspace().network?.chainId,
    useWorkspace().network?.runtime,
    resolveApiUrl('/v1'),
    member.dao.chainId,
    member.dao.contract,
    member.dao.daoId,
    member.memberId,
  ]);
watch(
  evmWallet,
  () => {
    authorizationRevision++;
    evmAuthorizations.value.clear();
  },
  { flush: 'sync' },
);
export async function refreshEvmAuthorization(
  member: UserMembership,
): Promise<Awaited<ReturnType<typeof api.evmBinding>>['binding'] | undefined> {
  const revision = ++authorizationRevision,
    key = memberKey(member),
    wallet = evmWallet.value;
  const { binding } = await api.evmBinding(member.dao.daoId, member.memberId);
  if (revision !== authorizationRevision || wallet !== evmWallet.value || key !== memberKey(member))
    return;
  if (binding) evmAuthorizations.value.set(key, binding);
  else evmAuthorizations.value.delete(key);
  return binding;
}
function matchesPreferredWallet(mode = selectedSigner.value): boolean {
  const preference = preferredApproval.value;
  if (!preference || preference.kind !== mode || preference.kind === 'vault') return true;
  return preference.kind === 'native'
    ? nativeWallet.value?.actor.toString() === preference.wallet
    : evmWallet.value?.address.toLowerCase() === preference.wallet;
}
export function canSignMember(member: UserMembership | undefined): boolean {
  if (!member || !matchesPreferredWallet()) return false;
  if (selectedSigner.value === 'vault') return canUseVaultKey(member.signingKey);
  if (selectedSigner.value === 'evm') {
    const binding = evmAuthorizations.value.get(memberKey(member)),
      wallet = evmWallet.value;
    return (
      !!wallet &&
      !!binding?.active &&
      binding.chain_id === String(wallet.chainId) &&
      binding.address === wallet.address.slice(2).toLowerCase()
    );
  }
  const wallet = nativeWallet.value;
  return (
    selectedSigner.value === 'native' &&
    !!wallet &&
    wallet.chain.id.toString() === member.dao.chainId &&
    wallet.actor.toString() === member.nativeAccount
  );
}
export async function activateMemberWallet(
  member: UserMembership,
  kind: 'native' | 'evm',
  checkContext: () => void,
): Promise<void> {
  const state = useWorkspace(),
    account = state.account,
    native = nativeWallet.value,
    evm = evmWallet.value,
    location = globalThis.location?.href,
    scope = memberKey(member);
  const check = () => {
    checkContext();
    if (
      !account ||
      state.account?.id !== account.id ||
      state.account.signingKey !== account.signingKey ||
      scope !== memberKey(member) ||
      location !== globalThis.location?.href ||
      (kind === 'native' ? native !== nativeWallet.value : evm !== evmWallet.value)
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
  };
  check();
  assertOperatorDao(member.dao);
  if (
    member.dao.chainId !== state.network?.chainId ||
    member.dao.contract !== state.network.runtime
  )
    throw new Error('DAO_REFERENCE');
  const current = (await api.memberships()).find(
    (row) =>
      row.dao.chainId === member.dao.chainId &&
      row.dao.contract === member.dao.contract &&
      row.dao.daoId === member.dao.daoId &&
      row.memberId === member.memberId,
  );
  check();
  if (!current?.active) throw new Error('NATIVE_UNLINKED');
  if (kind === 'native') {
    const identity = nativeIdentity();
    if (identity.chainId !== current.dao.chainId) throw new Error('WALLET_CONTEXT_CHANGED');
    const links = await api.nativeLinks();
    check();
    if (
      !links.links.some(
        (link) =>
          link.chainId === identity.chainId &&
          link.account === identity.account &&
          link.permission === identity.permission,
      )
    )
      throw new Error('NATIVE_UNLINKED');
    if (current.nativeAccount === identity.account) return;
    if (!canUseVaultKey(current.signingKey) || current.signingKey !== account?.signingKey)
      throw new Error('VAULT_LOCKED');
    const request = makeInstruction(
      current.dao,
      current.memberId,
      current.nonce,
      Math.floor(Date.now() / 1000) + 120,
      current.dao.contract,
      'linknative',
      encodeAction('linknative', {
        runtime: current.dao.contract,
        dao_id: current.dao.daoId,
        member_id: current.memberId,
        account: identity.account,
      }),
    );
    check();
    await nativeGovernance(request, current.nativeAccount, signInstruction(request), check);
    check();
    return;
  }
  if (!evm || !state.network?.capabilities.includes('evm-eoa-governance'))
    throw new Error('EVM_WALLET_MISSING');
  const links = await api.evmLinks();
  check();
  if (
    !links.links.some(
      (link) =>
        link.controlVerified &&
        link.chainId === evm.chainId &&
        link.address.toLowerCase() === evm.address.toLowerCase(),
    )
  )
    throw new Error('EVM_LINKED_REQUIRED');
  const binding = (await api.evmBinding(current.dao.daoId, current.memberId)).binding;
  check();
  const confirm = async () => {
    const confirmed = await refreshEvmAuthorization(current);
    check();
    if (
      !confirmed?.active ||
      confirmed.chain_id !== String(evm.chainId) ||
      confirmed.address !== evm.address.slice(2).toLowerCase()
    )
      throw new Error('EVM_BINDING');
  };
  if (
    binding?.active &&
    binding.chain_id === String(evm.chainId) &&
    binding.address === evm.address.slice(2).toLowerCase()
  ) {
    await confirm();
    return;
  }
  if (!canUseVaultKey(current.signingKey) || current.signingKey !== account?.signingKey)
    throw new Error('VAULT_LOCKED');
  const epoch = String(binding ? BigInt(binding.epoch) + 1n : 1n),
    expires = Math.floor(Date.now() / 1000) + 120;
  const proof = await signEvmBinding(
    current.dao,
    current.memberId,
    { chainId: evm.chainId, address: evm.address, epoch },
    current.nonce,
    expires,
  );
  check();
  await relayWithVault(
    makeInstruction(
      current.dao,
      current.memberId,
      current.nonce,
      expires,
      current.dao.contract,
      'linkevm',
      encodeAction('linkevm', {
        runtime: current.dao.contract,
        dao_id: current.dao.daoId,
        member_id: current.memberId,
        evm_chain_id: String(evm.chainId),
        address: evm.address.slice(2).toLowerCase(),
        epoch,
        nonce: current.nonce,
        expires,
        proof: proof.slice(2),
      }),
    ),
  );
  check();
  await confirm();
}
export async function dispatchInstruction(request: instruction): Promise<string> {
  assertOperatorDao({
    chainId: request.chain_id,
    contract: request.deployment,
    daoId: request.dao_id,
    interfaceVersion: 1,
  });
  const mode = selectedSigner.value,
    state = useWorkspace(),
    account = state.account?.id,
    location = globalThis.location?.href,
    network = JSON.stringify([state.network?.chainId, state.network?.runtime]),
    native = nativeWallet.value,
    evm = evmWallet.value;
  if (!matchesPreferredWallet(mode)) throw new Error('WALLET_CONTEXT_CHANGED');
  const checkContext = () => {
    if (
      mode !== selectedSigner.value ||
      account !== state.account?.id ||
      location !== globalThis.location?.href ||
      network !== JSON.stringify([state.network?.chainId, state.network?.runtime]) ||
      (mode === 'native' && native !== nativeWallet.value) ||
      (mode === 'evm' && evm !== evmWallet.value)
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
  };
  if (mode === 'vault') return relayWithVault(request);
  if (mode === 'evm') {
    const wallet = evmWallet.value;
    if (!wallet) throw new Error('EVM_WALLET_MISSING');
    const { binding } = await api.evmBinding(request.dao_id, request.member_id);
    if (
      !binding?.active ||
      binding.chain_id !== String(wallet.chainId) ||
      binding.address !== wallet.address.slice(2).toLowerCase()
    )
      throw new Error('EVM_BINDING');
    checkContext();
    const signature = await signEvmGovernance(request, {
      chainId: wallet.chainId,
      address: wallet.address,
      epoch: binding.epoch,
    });
    checkContext();
    return (
      await api.relayEvm({
        request,
        evm_chain_id: binding.chain_id,
        address: binding.address,
        binding_epoch: binding.epoch,
        proof: signature.slice(2),
      })
    ).transactionId;
  }
  const selected = nativeWallet.value;
  const memberships = await api.memberships();
  const member = memberships.find(
    (row) =>
      row.dao.chainId === request.chain_id &&
      row.dao.contract === request.deployment &&
      row.dao.daoId === request.dao_id &&
      row.memberId === request.member_id,
  );
  if (selected !== nativeWallet.value || !canSignMember(member)) throw new Error('NATIVE_UNLINKED');
  checkContext();
  return nativeGovernance(request, member?.nativeAccount ?? '', undefined, checkContext);
}
