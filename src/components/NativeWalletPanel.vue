<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { NativeLinksSchema, SessionSchema, type Account } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { acceptProviderSession, canUseVaultKey, completeNativeReconnect } from '../auth/session';
import { connectNative, nativeWallet, nativeIdentity, nativeIntentProof } from '../auth/telos-zero';
import { useRouter } from 'vue-router';
import { lockVault } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { selectedSigner } from '../auth/action-signer';
import { z } from 'zod';
const props = defineProps<{ mode: 'enter' | 'manage' | 'signup' }>(),
  emit = defineEmits<{
    authenticated: [account: Account];
    busy: [active: boolean];
    reconnected: [];
  }>();
const state = useWorkspace(),
  links = ref<z.infer<typeof NativeLinksSchema>['links']>([]),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const label = computed(() =>
  props.mode === 'signup'
    ? 'Create with Telos Zero'
    : props.mode === 'enter'
      ? 'Continue with Telos Zero'
      : 'Pair Telos Zero',
);
const router = useRouter();
watch(busy, (active) => emit('busy', active), { flush: 'sync' });
let disposed = false,
  revision = 0;
const context = () =>
  JSON.stringify([
    props.mode,
    state.account?.id,
    state.network?.chainId,
    state.network?.runtime,
    router.currentRoute.value.fullPath,
  ]);
function guard(stamp: string, generation: number) {
  if (disposed || revision !== generation || context() !== stamp)
    throw new Error('WALLET_CONTEXT_CHANGED');
}
async function load() {
  const stamp = context(),
    generation = revision;
  try {
    const result = await api.nativeLinks();
    guard(stamp, generation);
    links.value = result.links;
  } catch (cause) {
    if (!disposed && generation === revision) error.value = friendlyError(cause);
    throw cause;
  }
}
watch(context, () => {
  revision++;
  busy.value = false;
  links.value = [];
  error.value = '';
  notice.value = '';
  if (props.mode === 'manage') void load().catch(() => {});
});
onMounted(() => {
  if (props.mode === 'manage') void load().catch(() => {});
});
onUnmounted(() => {
  disposed = true;
  revision++;
  emit('busy', false);
});
async function useWallet(reconnect = false) {
  const stamp = context(),
    generation = revision;
  if (
    props.mode === 'manage' &&
    !window.confirm(
      reconnect
        ? 'Reconnect all sign-ins from the wallet-only account controlled by your Telos Zero wallet to this restored account? This brings over its email, Telegram, passkeys and wallets, keeps your current methods, and signs out other devices. Your account keys and DAO memberships are preserved.'
        : 'Pair the native account selected in Anchor with this Daclify account? DAO governance must be activated separately.',
    )
  )
    return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const current = state.account;
    if (reconnect && (!current?.signingKey || !canUseVaultKey(current.signingKey)))
      throw new Error('VAULT_LOCKED');
    await connectNative();
    guard(stamp, generation);
    const identity = nativeIdentity(),
      purpose = props.mode === 'manage' ? 'pair' : props.mode === 'signup' ? 'signup' : 'login';
    const challenge = await api.nativeChallenge(purpose, identity.account);
    guard(stamp, generation);
    if (
      challenge.identity.chainId !== identity.chainId ||
      challenge.identity.account !== identity.account
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    const proof = await nativeIntentProof(challenge.runtime, challenge.message);
    guard(stamp, generation);
    if (reconnect && current) {
      state.account = await completeNativeReconnect(current, challenge.id, proof, () =>
        guard(stamp, generation),
      );
      await load();
      guard(stamp, generation);
      notice.value =
        'Your existing sign-ins are reconnected. Use any paired method to open this account.';
      emit('reconnected');
      return;
    }
    const result = await api.nativeFinish(purpose, challenge.id, proof);
    guard(stamp, generation);
    if (purpose !== 'pair') {
      const session = SessionSchema.parse(result);
      selectedSigner.value = 'native';
      emit('authenticated', acceptProviderSession(session.account, session.csrfToken));
    } else {
      await load();
      guard(stamp, generation);
      notice.value =
        'Native account paired for sign-in. Activate its DAO authorization separately in the workspace.';
    }
  } catch (cause) {
    if (!disposed && generation === revision) error.value = friendlyError(cause);
  } finally {
    if (!disposed && generation === revision) busy.value = false;
  }
}
async function remove(chainId: string) {
  const stamp = context(),
    generation = revision;
  const link = links.value.find((l) => l.chainId === chainId);
  if (
    !link ||
    !window.confirm(
      'Remove sign-in pairing ' +
        link.account +
        '@' +
        link.permission +
        '? Its sessions will be revoked. DAO governance bindings are revoked separately.',
    )
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    await api.unlinkNative(chainId);
    guard(stamp, generation);
    try {
      links.value = (await api.nativeLinks()).links;
      guard(stamp, generation);
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') {
        lockVault();
        await state.refresh();
        await router.replace({ path: '/account', query: { notice: 'signin-removed' } });
        return;
      }
      throw cause;
    }
    notice.value = 'Sign-in pairing removed. DAO wallet authorizations must be revoked separately.';
  } catch (cause) {
    if (!disposed && generation === revision) error.value = friendlyError(cause);
  } finally {
    if (!disposed && generation === revision) busy.value = false;
  }
}
async function useControl() {
  const stamp = context(),
    generation = revision;
  busy.value = true;
  error.value = '';
  try {
    await connectNative();
    guard(stamp, generation);
    const identity = nativeIdentity();
    if (
      !links.value.some(
        (link) => link.chainId === identity.chainId && link.account === identity.account,
      )
    )
      throw new Error('NATIVE_UNLINKED');
    selectedSigner.value = 'native';
    notice.value = 'Paired native wallet selected for account-control proofs.';
  } catch (cause) {
    if (!disposed && generation === revision) error.value = friendlyError(cause);
  } finally {
    if (!disposed && generation === revision) busy.value = false;
  }
}
</script>
<template>
  <section :aria-label="mode === 'signup' ? 'Telos Zero account creation' : 'Telos Zero sign-in'">
    <h3 v-if="mode !== 'manage'">Telos Zero</h3>
    <p v-if="mode === 'signup'">
      Create or open your Daclify account paired with your existing Telos Zero wallet. Approve the
      account proof in Anchor. You can add Daclify keys for new DAOs and private documents afterward
      in Account.
    </p>
    <p v-else>
      Use an Anchor wallet to sign in with a paired account or recover its existing on-chain DAO
      access after a service failure. Recovery uses the current blockchain binding; it creates no
      new DAO membership. Original document keys require an enabled full-access method, an encrypted
      kit or approval from an unlocked device.
    </p>
    <p v-if="mode === 'manage'" class="field-help">
      Sign-in pairing and DAO wallet authority are separate. Remove or replace executive bindings in
      the DAO before changing this sign-in pairing.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <ul v-if="mode === 'manage' && links.length" class="method-list">
      <li v-for="link in links" :key="`${link.chainId}:${link.account}`" class="method-row">
        <span>{{ link.account }}@{{ link.permission }}</span
        ><button type="button" class="secondary" :disabled="busy" @click="remove(link.chainId)">
          Remove sign-in pairing
        </button>
      </li>
    </ul>
    <p v-if="nativeWallet" class="muted">
      Connected wallet: {{ nativeWallet.actor }}@{{ nativeWallet.permission }}
    </p>
    <button type="button" :disabled="busy" @click="useWallet()">
      {{ busy ? 'Waiting for wallet…' : label }}
    </button>
    <div v-if="mode === 'manage' && state.account?.signingKey" class="reconnect-sign-ins">
      <h3>Already paired your sign-ins before restoring your kit?</h3>
      <p>
        Unlock your keys in Access &amp; recovery, then approve with your previously paired Telos
        Zero wallet. This reconnects its existing email, Telegram, passkeys and wallets to your
        restored account and keeps the methods you have added here.
      </p>
      <button type="button" class="secondary" :disabled="busy" @click="useWallet(true)">
        Reconnect existing sign-ins
      </button>
    </div>
    <button
      v-if="mode === 'manage' && links.length"
      type="button"
      class="secondary"
      :disabled="busy"
      @click="useControl"
    >
      Use paired wallet for account control
    </button>
  </section>
</template>
<style scoped>
.reconnect-sign-ins {
  margin-top: 24px;
  border-top: 1px solid var(--border-default);
  padding-top: 16px;
}
</style>
