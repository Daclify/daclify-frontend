<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Account } from '@daclify/core-protocol';
import { api, friendlyError, type SignInMethods, type SignInOptions } from '../api/client';
import { acceptProviderSession } from '../auth/session';
import { mountTelegramWidget } from '../auth/telegram-login';
import {
  assertionProof,
  creationOptions,
  registrationProof,
  requestOptions,
} from '../auth/webauthn';
const props = defineProps<{ mode: 'manage' | 'enter' }>();
const emit = defineEmits<{ authenticated: [account: Account] }>();
const options = ref<SignInOptions>();
const linked = ref<SignInMethods>();
const email = ref('');
const code = ref('');
const revealed = ref('');
const awaitingCode = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const host = ref<HTMLElement>();
let unmountTelegram = () => {};
const passkeysAvailable = computed(() => typeof PublicKeyCredential !== 'undefined');
const delivery = computed(
  () => linked.value?.email.delivery ?? options.value?.email.delivery ?? 'unavailable',
);
const telegramUsername = computed(
  () => linked.value?.telegram.username ?? options.value?.telegram.username ?? null,
);
const passkeyHost = computed(() => {
  const host = window.location.hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return '';
  return host;
});
function problem(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return 'The passkey prompt was cancelled.';
  }
  if (cause instanceof DOMException && cause.name === 'SecurityError') {
    return 'Passkeys need a hostname such as localhost. An IP address cannot hold a passkey.';
  }
  if (cause instanceof Error && cause.message === 'PASSKEY_INVALID') {
    return 'The passkey could not be verified. Try again.';
  }
  return friendlyError(cause);
}
async function load() {
  error.value = '';
  options.value = await api.signInOptions();
  if (props.mode === 'manage') linked.value = await api.signInMethods();
}
function signedIn(account: Account, csrfToken: string) {
  emit('authenticated', acceptProviderSession(account, csrfToken));
}
async function addPasskey() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const created = await navigator.credentials.create({
      publicKey: creationOptions(await api.passkeyRegisterOptions()),
    });
    await api.registerPasskey(registrationProof(created));
    notice.value = 'Passkey added.';
    linked.value = await api.signInMethods();
  } catch (cause) {
    error.value = problem(cause);
  } finally {
    busy.value = false;
  }
}
async function signInWithPasskey() {
  busy.value = true;
  error.value = '';
  try {
    const asserted = await navigator.credentials.get({
      publicKey: requestOptions(await api.passkeyLoginOptions()),
    });
    const session = await api.loginWithPasskey(assertionProof(asserted));
    signedIn(session.account, session.csrfToken);
  } catch (cause) {
    error.value = problem(cause);
  } finally {
    busy.value = false;
  }
}
async function sendCode() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  revealed.value = '';
  try {
    const started =
      props.mode === 'manage'
        ? await api.startEmailLink(email.value)
        : await api.startEmailLogin(email.value);
    awaitingCode.value = true;
    if ('code' in started) revealed.value = started.code;
    else notice.value = 'Check that mailbox for the code.';
  } catch (cause) {
    error.value = problem(cause);
  } finally {
    busy.value = false;
  }
}
async function confirmCode() {
  busy.value = true;
  error.value = '';
  try {
    if (props.mode === 'manage') {
      await api.confirmEmailLink(email.value, code.value);
      notice.value = 'Email paired.';
      awaitingCode.value = false;
      revealed.value = '';
      code.value = '';
      email.value = '';
      linked.value = await api.signInMethods();
    } else {
      const session = await api.loginWithEmail(email.value, code.value);
      signedIn(session.account, session.csrfToken);
    }
  } catch (cause) {
    error.value = problem(cause);
  } finally {
    busy.value = false;
  }
}
async function useTelegram(proof: string) {
  busy.value = true;
  error.value = '';
  try {
    if (props.mode === 'manage') {
      await api.linkTelegram(proof);
      notice.value = 'Telegram paired.';
      linked.value = await api.signInMethods();
    } else {
      const session = await api.loginWithTelegram(proof);
      signedIn(session.account, session.csrfToken);
    }
  } catch (cause) {
    error.value = problem(cause);
  } finally {
    busy.value = false;
  }
}
async function remove(method: 'telegram' | 'email' | 'passkey', subject: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.removeSignIn(method, subject);
    notice.value = 'Sign-in method removed.';
    linked.value = await api.signInMethods();
  } catch (cause) {
    error.value = problem(cause);
  } finally {
    busy.value = false;
  }
}
watch(telegramUsername, async (username) => {
  unmountTelegram();
  if (!username) return;
  await Promise.resolve();
  if (!host.value) return;
  unmountTelegram = mountTelegramWidget(host.value, username, (proof) => {
    void useTelegram(proof);
  });
});
onMounted(() => {
  void load().catch((cause: unknown) => {
    error.value = problem(cause);
  });
});
onUnmounted(() => {
  unmountTelegram();
});
</script>
<template>
  <section class="panel narrow">
    <h2>{{ mode === 'manage' ? 'Sign-in methods' : 'Other ways to sign in' }}</h2>
    <p>
      A passkey, Telegram, or email opens this account on the server. None of them unlocks the vault
      or replaces the recovery kit.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <h3>Passkey</h3>
    <ul v-if="linked" class="method-list">
      <li v-for="passkey in linked.passkeys" :key="passkey.id" class="method-row">
        <span class="mono">{{ passkey.id.slice(0, 10) }}</span>
        <button
          type="button"
          class="secondary"
          :disabled="busy"
          :aria-label="`Remove passkey ${passkey.id.slice(0, 10)}`"
          @click="remove('passkey', passkey.id)"
        >
          Remove
        </button>
      </li>
    </ul>
    <button
      v-if="mode === 'manage' && passkeysAvailable && passkeyHost"
      type="button"
      :disabled="busy"
      @click="addPasskey"
    >
      Add a passkey
    </button>
    <button
      v-else-if="passkeysAvailable && passkeyHost"
      type="button"
      :disabled="busy"
      @click="signInWithPasskey"
    >
      Sign in with a passkey
    </button>
    <p v-else-if="passkeysAvailable" class="muted">
      Open this page at localhost to use a passkey. An IP address cannot hold one.
    </p>
    <p v-else class="muted">This browser cannot create a passkey.</p>
    <h3>Telegram</h3>
    <ul v-if="linked" class="method-list">
      <li v-for="subject in linked.telegram.subjects" :key="subject" class="method-row">
        <span>Telegram {{ subject }}</span>
        <button
          type="button"
          class="secondary"
          :disabled="busy"
          @click="remove('telegram', subject)"
        >
          Remove
        </button>
      </li>
    </ul>
    <div ref="host" class="telegram-host"></div>
    <p v-if="!telegramUsername" class="muted">Telegram is not configured on this server.</p>
    <h3>Email</h3>
    <ul v-if="linked" class="method-list">
      <li v-for="subject in linked.email.subjects" :key="subject" class="method-row">
        <span>{{ subject }}</span>
        <button type="button" class="secondary" :disabled="busy" @click="remove('email', subject)">
          Remove
        </button>
      </li>
    </ul>
    <form
      v-if="delivery === 'mail' || (mode === 'manage' && delivery === 'local')"
      @submit.prevent="sendCode"
    >
      <label for="sign-in-email">Sign-in email</label>
      <input id="sign-in-email" v-model="email" type="email" autocomplete="username" required />
      <button type="submit" :disabled="busy">Send code</button>
    </form>
    <p v-if="revealed" class="notice" role="status">The code for this browser is {{ revealed }}.</p>
    <form v-if="awaitingCode" @submit.prevent="confirmCode">
      <label for="sign-in-code">Email code</label>
      <input
        id="sign-in-code"
        v-model="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        minlength="8"
        maxlength="8"
        required
      />
      <button type="submit" :disabled="busy">
        {{ mode === 'manage' ? 'Confirm email' : 'Sign in with email' }}
      </button>
    </form>
    <p v-if="delivery === 'unavailable'" class="muted">
      Email sign-in is not configured on this server.
    </p>
    <p v-else-if="mode === 'enter' && delivery === 'local'" class="muted">
      Email sign-in from this screen needs mail delivery. Pair an email from the account page after
      you unlock the vault.
    </p>
    <p v-else-if="mode === 'manage' && delivery === 'local'" class="field-help">
      Mail is not configured, so the pairing code is shown on this page. Signing in with email from
      another browser needs mail delivery.
    </p>
  </section>
</template>
