<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { UserMembership } from '@daclify/core-protocol';
import { useWorkspace } from '../state/workspace';
import {
  configureQuickDefault,
  restoreQuickPending,
  pendingQuick,
  resumeQuickApproval,
} from '../quick-ballots/approval';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { selectedSigner, activateMemberWallet } from '../auth/action-signer';
import { preferredApproval, saveApprovalPreference } from '../auth/approval-preference';
import { nativeWallet, connectNative } from '../auth/telos-zero';
import { evmWallet, connectEvm } from '../auth/telos-evm';
import { canUseVaultKey, vaultUnlocked } from '../auth/session';
import NativeWalletPanel from './NativeWalletPanel.vue';
import LinkedAccounts from './LinkedAccounts.vue';
const emit = defineEmits<{ unlockNeeded: [] }>();
const state = useWorkspace(),
  route = useRoute();
const kind = ref(selectedSigner.value),
  busy = ref(false),
  loading = ref(false),
  paired = ref(false),
  error = ref('');
const chosen = ref<string[]>([]),
  completed = ref<string[]>([]);
const accessOpen = ref(true),
  unlockRequested = ref(false),
  approvalButton = ref<HTMLButtonElement>();
const bindings = ref(new Map<string, Awaited<ReturnType<typeof api.evmBinding>>['binding']>()),
  bindingsLoading = ref(false),
  bindingsReady = ref(false);
let bindingRevision = 0,
  connecting = false;
const members = computed(() =>
  state.memberships.filter(
    (member) =>
      member.active &&
      member.dao.chainId === state.network?.chainId &&
      member.dao.contract === state.network.runtime,
  ),
);
const memberKey = (member: UserMembership) => member.dao.daoId + '/' + member.memberId;
const wallet = computed(() =>
  kind.value === 'native'
    ? nativeWallet.value?.actor.toString()
    : kind.value === 'evm'
      ? evmWallet.value?.address.toLowerCase()
      : undefined,
);
const savedWallet = computed(() =>
  preferredApproval.value?.kind === kind.value && preferredApproval.value.kind !== 'vault'
    ? preferredApproval.value.wallet
    : undefined,
);
function enabled(member: UserMembership): boolean {
  if (kind.value === 'native') return !!wallet.value && member.nativeAccount === wallet.value;
  const binding = bindings.value.get(memberKey(member));
  return (
    kind.value === 'evm' &&
    bindingsReady.value &&
    !!binding?.active &&
    binding.chain_id === String(evmWallet.value?.chainId) &&
    binding.address === wallet.value?.slice(2)
  );
}
const needsUnlock = computed(
  () =>
    !vaultUnlocked.value &&
    kind.value !== 'vault' &&
    members.value.some(
      (member) =>
        chosen.value.includes(memberKey(member)) &&
        !enabled(member) &&
        !canUseVaultKey(member.signingKey),
    ),
);
watch(
  kind,
  (mode) => {
    accessOpen.value = mode === 'vault';
  },
  { immediate: true },
);
watch(vaultUnlocked, (ready) => {
  if (ready && unlockRequested.value && !needsUnlock.value)
    void nextTick(() => approvalButton.value?.focus());
});
function requestUnlock() {
  error.value = '';
  accessOpen.value = true;
  unlockRequested.value = true;
  emit('unlockNeeded');
}
function toggleAccess(event: Event) {
  if (event.target instanceof HTMLDetailsElement) accessOpen.value = event.target.open;
}
const context = () =>
  JSON.stringify([
    state.account?.id,
    state.account?.signingKey,
    state.network?.chainId,
    state.network?.runtime,
    resolveApiUrl('/'),
    route.fullPath,
    kind.value,
    wallet.value,
  ]);
let revision = 0;
onBeforeUnmount(() => {
  revision++;
  bindingRevision++;
});
watch(preferredApproval, (preference) => {
  kind.value = preference?.kind ?? selectedSigner.value;
});
watch(
  () =>
    JSON.stringify([
      state.account?.id,
      state.network?.chainId,
      state.network?.runtime,
      route.query.dao,
    ]),
  () => {
    chosen.value = [];
    completed.value = [];
  },
);
watch(
  members,
  (rows) => {
    chosen.value = chosen.value.filter((key) => rows.some((member) => memberKey(member) === key));
    const target = rows.find((member) => member.dao.daoId === route.query.dao);
    if (target && !chosen.value.length && !completed.value.length)
      chosen.value = [memberKey(target)];
  },
  { immediate: true },
);
async function checkPairing() {
  const current = ++revision,
    stamp = context();
  paired.value = kind.value === 'vault';
  error.value = '';
  if (state.account) restoreQuickPending();
  loading.value = true;
  try {
    if (kind.value === 'native' && nativeWallet.value) {
      const identity = nativeWallet.value;
      const result = await api.nativeLinks();
      if (current === revision && stamp === context())
        paired.value = result.links.some(
          (link) =>
            link.chainId === identity.chain.id.toString() &&
            link.account === identity.actor.toString() &&
            link.permission === identity.permission.toString(),
        );
    } else if (kind.value === 'evm' && evmWallet.value) {
      const identity = evmWallet.value;
      const result = await api.evmLinks();
      if (current === revision && stamp === context())
        paired.value = result.links.some(
          (link) =>
            link.controlVerified &&
            link.chainId === identity.chainId &&
            link.address.toLowerCase() === identity.address.toLowerCase(),
        );
    }
  } catch (cause) {
    if (current === revision && stamp === context()) error.value = friendlyError(cause);
  } finally {
    if (current === revision) loading.value = false;
  }
}
watch(
  context,
  () => {
    if (!connecting) busy.value = false;
    completed.value = [];
    unlockRequested.value = false;
    void checkPairing();
  },
  { immediate: true },
);
async function connect() {
  const mode = kind.value,
    account = state.account?.id,
    path = route.fullPath;
  connecting = true;
  busy.value = true;
  error.value = '';
  try {
    if (kind.value === 'native') await connectNative();
    else if (kind.value === 'evm')
      await connectEvm(state.network?.environment === 'mainnet' ? 40 : 41);
    if (mode !== kind.value || account !== state.account?.id || path !== route.fullPath)
      throw new Error('WALLET_CONTEXT_CHANGED');
    await checkPairing();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    connecting = false;
    busy.value = false;
  }
}
watch(
  () => JSON.stringify([context(), paired.value, chosen.value]),
  async () => {
    const current = ++bindingRevision,
      stamp = context();
    bindings.value.clear();
    bindingsReady.value = false;
    bindingsLoading.value = false;
    if (kind.value !== 'evm' || !paired.value) return;
    bindingsLoading.value = true;
    try {
      const results = await Promise.all(
        members.value
          .filter((member) => chosen.value.includes(memberKey(member)))
          .slice(0, 20)
          .map(async (member) => ({
            key: memberKey(member),
            binding: (await api.evmBinding(member.dao.daoId, member.memberId)).binding,
          })),
      );
      if (current === bindingRevision && stamp === context()) {
        bindings.value = new Map(results.map((result) => [result.key, result.binding]));
        bindingsReady.value = true;
      }
    } catch (cause) {
      if (current === bindingRevision && stamp === context()) error.value = friendlyError(cause);
    } finally {
      if (current === bindingRevision) bindingsLoading.value = false;
    }
  },
  { immediate: true },
);
function saveDefault() {
  if (!paired.value) throw new Error('NATIVE_UNLINKED');
  if (kind.value === 'vault') saveApprovalPreference({ kind: 'vault' });
  else if (wallet.value) saveApprovalPreference({ kind: kind.value, wallet: wallet.value });
  else throw new Error('NATIVE_WALLET_MISSING');
}
async function approve() {
  if (
    busy.value ||
    loading.value ||
    bindingsLoading.value ||
    (kind.value === 'evm' && !bindingsReady.value) ||
    !paired.value ||
    chosen.value.length > 20
  )
    return;
  if (needsUnlock.value) {
    requestUnlock();
    return;
  }
  const stamp = context(),
    generation = revision,
    mode = kind.value;
  const check = () => {
    if (generation !== revision || stamp !== context()) throw new Error('WALLET_CONTEXT_CHANGED');
  };
  const selections = members.value.filter((member) => chosen.value.includes(memberKey(member)));
  busy.value = true;
  error.value = '';
  completed.value = [];
  try {
    saveDefault();
    if (state.network?.capabilities.includes('quick-ballots-v1')) {
      const method =
        mode === 'native' && nativeWallet.value
          ? {
              kind: 'native' as const,
              account: nativeWallet.value.actor.toString(),
              permission: 'active' as const,
            }
          : mode === 'evm' && evmWallet.value
            ? {
                kind: 'evm' as const,
                chainId: evmWallet.value.chainId,
                address: evmWallet.value.address.toLowerCase(),
              }
            : null;
      await configureQuickDefault(method, check);
      check();
    }
    if (mode !== 'vault')
      for (const member of selections) {
        check();
        await activateMemberWallet(member, mode, check);
        check();
        completed.value.push(memberKey(member));
      }
  } catch (cause) {
    if (stamp === context()) {
      if (cause instanceof Error && cause.message === 'VAULT_LOCKED' && !vaultUnlocked.value)
        requestUnlock();
      else if (cause instanceof Error && cause.message === 'VAULT_LOCKED')
        error.value =
          'Your unlocked account keys do not match this DAO member. Use its currently authorized wallet or recover the matching keys.';
      else error.value = friendlyError(cause);
    }
  } finally {
    if (stamp === context()) {
      await state.refresh();
      if (stamp === context()) busy.value = false;
    }
  }
}
async function resumePending() {
  busy.value = true;
  error.value = '';
  const stamp = context();
  try {
    await resumeQuickApproval(() => {
      if (stamp !== context()) throw Error('WALLET_CONTEXT_CHANGED');
    });
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    if (stamp === context()) busy.value = false;
  }
}
function status(member: UserMembership): string {
  if (completed.value.includes(memberKey(member))) return 'Enabled';
  const ready = canUseVaultKey(member.signingKey)
    ? 'Ready to enable'
    : vaultUnlocked.value
      ? 'Different signing key'
      : 'Unlock account to enable';
  if (kind.value === 'native' && wallet.value)
    return member.nativeAccount === wallet.value
      ? 'Already enabled'
      : member.nativeAccount
        ? 'Replaces ' + member.nativeAccount
        : ready;
  if (kind.value === 'evm' && paired.value && chosen.value.includes(memberKey(member))) {
    const binding = bindings.value.get(memberKey(member));
    if (!bindingsReady.value) return 'Checking wallet authorization…';
    if (binding?.active)
      return binding.chain_id === String(evmWallet.value?.chainId) &&
        binding.address === wallet.value?.slice(2)
        ? 'Already enabled'
        : 'Replaces 0x' + binding.address;
    return ready;
  }
  return 'Current authorization will be checked before approval';
}
</script>
<template>
  <section
    class="panel approval-setup"
    aria-labelledby="approval-setup-title"
    :aria-busy="busy || loading"
  >
    <h2 id="approval-setup-title">Approval setup</h2>
    <p v-if="state.network?.capabilities.includes('quick-ballots-v1')" class="field-help">
      The same default also approves Quick ballots across Daclify.
    </p>
    <p v-if="pendingQuick" class="notice">
      An earlier approval is awaiting confirmation.
      <button type="button" class="secondary" :disabled="busy" @click="resumePending">
        Check approval
      </button>
    </p>
    <p>Choose one default method for your DAO actions. Your memberships and roles stay the same.</p>
    <label for="default-approval-method">Default approval method</label>
    <select id="default-approval-method" v-model="kind" :disabled="busy || loading">
      <option value="vault">Daclify keys</option>
      <option value="native">Telos Zero wallet</option>
      <option v-if="state.network?.capabilities.includes('evm-eoa-governance')" value="evm">
        Telos EVM wallet
      </option>
    </select>
    <p v-if="preferredApproval" class="field-help">
      Default saved for this account and network on this browser.
    </p>
    <p v-if="wallet" class="wrap">Wallet: {{ wallet }}</p>
    <p v-if="savedWallet && savedWallet !== wallet" class="notice wrap">
      Your saved default is {{ savedWallet }}. Connect it, or save the connected wallet as your new
      default.
    </p>
    <button
      v-if="kind !== 'vault' && !wallet"
      type="button"
      class="secondary"
      :disabled="busy || loading"
      @click="connect"
    >
      Connect your paired wallet
    </button>
    <template v-if="kind !== 'vault' && wallet && !paired && !loading">
      <p>Pair this wallet with your Daclify account here, then refresh its pairing.</p>
      <NativeWalletPanel v-if="kind === 'native'" mode="manage" />
      <LinkedAccounts v-else mode="manage" />
    </template>
    <button
      v-if="kind !== 'vault' && wallet"
      class="text-button"
      type="button"
      :disabled="busy || loading"
      @click="checkPairing"
    >
      Refresh wallet pairing
    </button>
    <template v-if="kind !== 'vault' && paired">
      <p v-if="needsUnlock" class="notice">
        Unlock your account once to enable this wallet in the selected DAOs. Choose the button below
        to continue with account recovery. Already enabled wallets can approve public actions while
        Daclify keys are locked.
      </p>
      <fieldset :disabled="busy || loading">
        <legend>Use this wallet in these DAOs</legend>
        <p class="field-help">
          Select up to 20 at a time. Your wallet can approve actions as your member, including
          signing-key changes permitted by the DAO.
        </p>
        <label v-for="member in members" :key="memberKey(member)" class="approval-dao check-row">
          <input
            v-model="chosen"
            type="checkbox"
            :value="memberKey(member)"
            :disabled="chosen.length >= 20 && !chosen.includes(memberKey(member))"
          />
          <span
            >{{
              state.daos.find((dao) => dao.reference.daoId === member.dao.daoId)?.title ??
              'DAO ' + member.dao.daoId
            }}
            <small>DAO {{ member.dao.daoId }} · {{ status(member) }}</small></span
          >
        </label>
        <p v-if="!members.length">
          Your wallet is ready to use as the default. DAO access is enabled here after you create or
          join a DAO.
        </p>
      </fieldset>
    </template>
    <p v-else-if="kind === 'vault'" class="field-help">
      Your existing Daclify keys work across your memberships. Unlock or recover them below when
      needed.
    </p>
    <p v-if="error" class="alert" role="alert">
      {{ error }}
      <span v-if="completed.length"
        >{{ completed.length }} selected DAOs completed; retry checks the remaining
        authorizations.</span
      >
    </p>
    <p v-if="completed.length" role="status">
      {{ completed.length }} of {{ chosen.length }} selected DAOs enabled.
    </p>
    <button
      ref="approvalButton"
      type="button"
      :disabled="
        busy || loading || bindingsLoading || (kind === 'evm' && !bindingsReady) || !paired
      "
      @click="approve"
    >
      {{
        busy
          ? 'Completing setup…'
          : needsUnlock
            ? 'Unlock account to continue'
            : chosen.length && kind !== 'vault'
              ? 'Approve selected DAOs'
              : 'Save default approval method'
      }}
    </button>
    <p v-if="unlockRequested && !needsUnlock && vaultUnlocked" role="status">
      Account unlocked. Approve selected DAOs to finish.
    </p>
    <details v-if="$slots.access" :open="accessOpen" class="approval-access" @toggle="toggleAccess">
      <summary>Account keys and recovery</summary>
      <slot name="access" :requested="unlockRequested" />
    </details>
  </section>
</template>
<style scoped>
.approval-setup {
  max-width: 640px;
  margin-bottom: 24px;
}
.approval-dao {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 44px;
  padding: 10px 0;
}
.approval-dao input[type='checkbox'] {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  margin: 0;
  accent-color: var(--accent-amber);
}
.approval-dao small {
  display: block;
  margin-top: 4px;
  font-size: 0.8rem;
}
fieldset {
  margin: 16px 0;
}
.approval-access {
  margin-top: 20px;
}
.approval-access summary {
  margin-bottom: 16px;
}
</style>
