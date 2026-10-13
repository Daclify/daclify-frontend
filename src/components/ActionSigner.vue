<script setup lang="ts">
import { useRoute } from 'vue-router';
import { computed, ref, useId, watch } from 'vue';
import type { GovernanceState } from '@daclify/core-protocol';
import { executiveStatus } from '../auth/executives';
import type { UserMembership } from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { selectedSigner, canSignMember, refreshEvmAuthorization } from '../auth/action-signer';
import {
  vaultUnlocked,
  signInstruction,
  relayInstruction,
  relayWithVault,
  savedVault,
  unlockAndLogin,
  lockVault,
} from '../auth/session';
import { nativeWallet, connectNative, nativeIdentity, nativeGovernance } from '../auth/telos-zero';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError } from '../api/client';
import { evmWallet, connectEvm, signEvmBinding } from '../auth/telos-evm';
const props = defineProps<{ member: UserMembership | undefined; compact?: boolean }>();
const inputId = useId();
const password = ref('');
const state = useWorkspace(),
  busy = ref(false),
  error = ref('');
const localKeys = computed(
  () => !!state.account?.signingKey && savedVault()?.signingPublicKey === state.account.signingKey,
);
const route = useRoute();
const ready = computed(() => canSignMember(props.member));
async function unlock() {
  const account = state.account;
  if (!account || !localKeys.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const opened = await unlockAndLogin(password.value, account, 'recover');
    if (opened.id !== account.id) {
      lockVault();
      throw new Error('ACCOUNT_KEY_MISMATCH');
    }
    state.account = opened;
    await state.refresh();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    password.value = '';
    busy.value = false;
  }
}
watch(
  [() => props.member, evmWallet],
  () => {
    const member = props.member;
    if (member && evmWallet.value)
      void refreshEvmAuthorization(member).catch((cause: unknown) => {
        error.value = friendlyError(cause);
      });
  },
  { immediate: true },
);
async function connect() {
  busy.value = true;
  error.value = '';
  try {
    await connectNative();
    selectedSigner.value = 'native';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function bind() {
  const member = props.member;
  if (!member) return;
  busy.value = true;
  error.value = '';
  try {
    const identity = nativeIdentity();
    if (identity.chainId !== member.dao.chainId) throw new Error('WALLET_CONTEXT_CHANGED');
    const request = makeInstruction(
      member.dao,
      member.memberId,
      member.nonce,
      Math.floor(Date.now() / 1000) + 120,
      member.dao.contract,
      'linknative',
      encodeAction('linknative', {
        runtime: member.dao.contract,
        dao_id: member.dao.daoId,
        member_id: member.memberId,
        account: identity.account,
      }),
    );
    await nativeGovernance(request, member.nativeAccount, signInstruction(request));
    await state.refresh();
    selectedSigner.value = 'native';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
const governanceState = ref<GovernanceState>();
const governanceLoading = ref(true);
let governanceRequest = 0;
watch(
  () => props.member?.dao,
  async (dao) => {
    const request = ++governanceRequest;
    governanceLoading.value = true;
    governanceState.value = undefined;
    if (!dao) return;
    try {
      const result = await api.governance(dao.daoId);
      if (request === governanceRequest) governanceState.value = result;
    } catch (cause) {
      if (request === governanceRequest) error.value = friendlyError(cause);
    } finally {
      if (request === governanceRequest) governanceLoading.value = false;
    }
  },
  { immediate: true },
);
const lastNativeExecutive = computed(
  () =>
    executiveStatus(governanceState.value, props.member?.memberId, Math.floor(Date.now() / 1000))
      .lastPaired,
);
async function unbind() {
  const member = props.member;
  if (!member || governanceLoading.value || !governanceState.value || lastNativeExecutive.value)
    return;
  busy.value = true;
  error.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        member.dao,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 120,
        member.dao.contract,
        'unlinknat',
        encodeAction('unlinknat', {
          runtime: member.dao.contract,
          dao_id: member.dao.daoId,
          member_id: member.memberId,
        }),
      ),
    );
    await state.refresh();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function connectEthereum() {
  busy.value = true;
  error.value = '';
  try {
    await connectEvm(state.network?.environment === 'mainnet' ? 40 : 41);
    selectedSigner.value = 'evm';
    if (props.member) await refreshEvmAuthorization(props.member);
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function bindEthereum() {
  const member = props.member,
    wallet = evmWallet.value;
  if (!member || !wallet) return;
  busy.value = true;
  error.value = '';
  try {
    if (
      !(await api.evmLinks()).links.some(
        (link) =>
          link.controlVerified &&
          link.chainId === wallet.chainId &&
          link.address.toLowerCase() === wallet.address.toLowerCase(),
      )
    )
      throw new Error('EVM_LINKED_REQUIRED');
    const current = (await api.evmBinding(member.dao.daoId, member.memberId)).binding;
    const epoch = String(current ? BigInt(current.epoch) + 1n : 1n),
      expires = Math.floor(Date.now() / 1000) + 120;
    const proof = await signEvmBinding(
      member.dao,
      member.memberId,
      { chainId: wallet.chainId, address: wallet.address, epoch },
      member.nonce,
      expires,
    );
    if (wallet !== evmWallet.value || props.member !== member)
      throw new Error('WALLET_CONTEXT_CHANGED');
    await relayWithVault(
      makeInstruction(
        member.dao,
        member.memberId,
        member.nonce,
        expires,
        member.dao.contract,
        'linkevm',
        encodeAction('linkevm', {
          runtime: member.dao.contract,
          dao_id: member.dao.daoId,
          member_id: member.memberId,
          evm_chain_id: String(wallet.chainId),
          address: wallet.address.slice(2).toLowerCase(),
          epoch,
          nonce: member.nonce,
          expires,
          proof: proof.slice(2),
        }),
      ),
    );
    await state.refresh();
    if (props.member) await refreshEvmAuthorization(props.member);
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function revokeEthereum() {
  const member = props.member;
  if (!member) return;
  busy.value = true;
  error.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        member.dao,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 120,
        member.dao.contract,
        'unlinkevm',
        encodeAction('unlinkevm', {
          runtime: member.dao.contract,
          dao_id: member.dao.daoId,
          member_id: member.memberId,
        }),
      ),
    );
    await state.refresh();
    if (props.member) await refreshEvmAuthorization(props.member);
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section
    v-if="member"
    :class="compact ? 'document-signer' : 'panel narrow'"
    aria-label="Action signer"
  >
    <label :for="inputId">{{ compact ? 'Approve with' : 'Authorize actions with' }}</label>
    <select :id="inputId" v-model="selectedSigner" :disabled="busy">
      <option value="vault">Daclify keys {{ vaultUnlocked ? '(unlocked)' : '(locked)' }}</option>
      <option value="native">
        Telos Zero wallet {{ nativeWallet ? `(${nativeWallet.actor})` : '(connect wallet)' }}
      </option>
      <option v-if="state.network?.capabilities.includes('evm-eoa-governance')" value="evm">
        Telos EVM wallet
        {{ evmWallet ? `(${evmWallet.address.slice(0, 10)}…)` : '(connect wallet)' }}
      </option>
    </select>
    <form
      v-if="compact && selectedSigner === 'vault' && !vaultUnlocked && localKeys"
      @submit.prevent="unlock"
    >
      <label :for="inputId + '-password'">Vault password</label>
      <input
        :id="inputId + '-password'"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        :disabled="busy"
      />
      <button :disabled="busy || !password">{{ busy ? 'Unlocking…' : 'Unlock keys' }}</button>
    </form>
    <RouterLink
      v-else-if="selectedSigner === 'vault' && !vaultUnlocked"
      class="button secondary"
      :to="{ path: '/account', query: { returnTo: route.fullPath } }"
      >Unlock Daclify keys</RouterLink
    >
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <button
      v-if="selectedSigner === 'native' && !nativeWallet"
      type="button"
      :disabled="busy"
      @click="connect"
    >
      Connect Telos Zero wallet
    </button>
    <template v-else-if="selectedSigner === 'native' && !ready">
      <p>
        This wallet is not authorized for this DAO member. Activating it requires your existing
        Daclify keys and the incoming wallet’s consent.
      </p>
      <button type="button" :disabled="busy || !vaultUnlocked || !member.active" @click="bind">
        {{
          member.nativeAccount ? 'Replace DAO wallet atomically' : 'Authorize wallet for this DAO'
        }}
      </button>
    </template>
    <template v-if="selectedSigner === 'evm'">
      <button v-if="!evmWallet" type="button" :disabled="busy" @click="connectEthereum">
        Connect Telos EVM wallet
      </button>
      <template v-else-if="!ready"
        ><p>
          Pair this wallet in Account first, then activate it for this DAO using your existing
          Daclify keys. EOA signatures are supported; ERC-1271 contract-wallet signatures require a
          separate integration.
        </p>
        <button
          type="button"
          :disabled="busy || !vaultUnlocked || !member.active"
          @click="bindEthereum"
        >
          Authorize EVM wallet for this DAO
        </button></template
      >
      <button
        v-else-if="!compact"
        type="button"
        class="secondary"
        :disabled="busy"
        @click="revokeEthereum"
      >
        Remove EVM DAO authorization
      </button>
    </template>
    <p v-if="ready && !compact" class="muted">
      The DAO checks your membership and permissions for every action. Private documents require
      separate decryption keys.
    </p>
    <button
      v-if="!compact && member.nativeAccount && ready"
      type="button"
      class="secondary"
      :disabled="
        busy || !member.active || governanceLoading || !governanceState || lastNativeExecutive
      "
      @click="unbind"
    >
      {{
        lastNativeExecutive
          ? 'Last executive: replace wallet to continue'
          : 'Remove native DAO authorization'
      }}
    </button>
  </section>
</template>
