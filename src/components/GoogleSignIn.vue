<script setup lang="ts">
import { onMounted, onBeforeUnmount, nextTick, ref } from 'vue';
import type { Account } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { acceptProviderSession } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { mountGoogleButton } from '../auth/google-login';
const props = defineProps<{ inert: boolean }>();
const emit = defineEmits<{ authenticated: [account: Account]; busy: [value: boolean] }>();
const host = ref<HTMLElement>(),
  configured = ref(false),
  error = ref(''),
  busy = ref(false),
  state = useWorkspace();
let dispose = () => {},
  removed = false;
onMounted(async () => {
  try {
    const { clientId } = await api.googleSignInConfiguration();
    if (removed || !clientId || !host.value) return;
    configured.value = true;
    await nextTick();
    if (removed) return;
    dispose = mountGoogleButton(
      host.value,
      clientId,
      (proof, nonce) => {
        void signIn(proof, nonce);
      },
      (cause) => {
        error.value = friendlyError(cause);
      },
    );
  } catch (cause) {
    if (!removed) error.value = friendlyError(cause);
  }
});
async function signIn(proof: string, nonce: string) {
  if (removed || busy.value || props.inert) return;
  const accountId = state.account?.id;
  busy.value = true;
  emit('busy', true);
  error.value = '';
  try {
    const session = await api.loginWithGoogle(proof, nonce);
    if (removed || state.account?.id !== accountId) throw Error('WALLET_CONTEXT_CHANGED');
    emit('authenticated', acceptProviderSession(session.account, session.csrfToken));
  } catch (cause) {
    if (!removed) error.value = friendlyError(cause);
  } finally {
    if (!removed) {
      busy.value = false;
      emit('busy', false);
    }
  }
}
onBeforeUnmount(() => {
  removed = true;
  dispose();
  emit('busy', false);
});
</script>
<template>
  <section v-show="configured || error" aria-label="Paired Google sign-in" :inert="inert || busy">
    <p>Use a Google account already paired with this Daclify account.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div ref="host"></div>
  </section>
</template>
