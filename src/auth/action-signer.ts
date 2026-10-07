import { useWorkspace } from '../state/workspace';
import { ref, watch } from 'vue';
import type { UserMembership } from '@daclify/core-protocol';
import type { instruction } from '@daclify/core-protocol/sdk';
import { api } from '../api/client';
import { canUseVaultKey, relayWithVault } from './session';
import { resolveApiUrl, assertOperatorDao } from '../api/networks';
import { nativeWallet, nativeGovernance } from './telos-zero';
import { evmWallet, signEvmGovernance } from './telos-evm';
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
export async function refreshEvmAuthorization(member: UserMembership): Promise<void> {
  const revision = ++authorizationRevision,
    key = memberKey(member),
    wallet = evmWallet.value;
  const { binding } = await api.evmBinding(member.dao.daoId, member.memberId);
  if (revision !== authorizationRevision || wallet !== evmWallet.value || key !== memberKey(member))
    return;
  if (binding) evmAuthorizations.value.set(key, binding);
  else evmAuthorizations.value.delete(key);
}
export function canSignMember(member: UserMembership | undefined): boolean {
  if (!member) return false;
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
