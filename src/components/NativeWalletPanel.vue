<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { NativeLinksSchema, SessionSchema, type Account } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { acceptProviderSession } from '../auth/session';
import { connectNative, nativeWallet, nativeIdentity, nativeIntentProof } from '../auth/telos-zero';
import { useRouter } from 'vue-router';
import { lockVault } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { selectedSigner } from '../auth/action-signer';
import { z } from 'zod';
const props = defineProps<{ mode: 'enter' | 'manage' }>(),
  emit = defineEmits<{ authenticated: [account: Account] }>();
const state = useWorkspace(),
  links = ref<z.infer<typeof NativeLinksSchema>['links']>([]),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const label = computed(() =>
  props.mode === 'enter' ? 'Continue with Telos Zero' : 'Pair Telos Zero',
);
const router = useRouter();
let disposed = false,
  revision = 0;
const context = () => JSON.stringify([props.mode, state.account?.id]);
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
});
async function useWallet() {
  const stamp = context(),
    generation = revision;
  if (
    props.mode === 'manage' &&
    !window.confirm(
      'Pair the native account selected in Anchor with this Daclify account? DAO governance must be activated separately.',
    )
  )
    return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await connectNative();
    guard(stamp, generation);
    const identity = nativeIdentity(),
      purpose = props.mode === 'manage' ? 'pair' : 'login';
    const challenge = await api.nativeChallenge(purpose, identity.account);
    if (
      challenge.identity.chainId !== identity.chainId ||
      challenge.identity.account !== identity.account
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    const proof = await nativeIntentProof(challenge.runtime, challenge.message);
    guard(stamp, generation);
    const result = await api.nativeFinish(purpose, challenge.id, proof);
    guard(stamp, generation);
    if (purpose === 'login') {
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
  <section aria-label="Telos Zero sign-in">
    <h3>Telos Zero</h3>
    <p>
      Use a paired native account with an Anchor wallet. Sign-in preserves your Daclify identity; it
      does not create membership or decrypt documents.
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
    <button type="button" :disabled="busy" @click="useWallet">
      {{ busy ? 'Waiting for wallet…' : label }}
    </button>
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
