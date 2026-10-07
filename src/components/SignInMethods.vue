<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Account } from '@daclify/core-protocol';
import { api, friendlyError, type SignInMethods, type SignInOptions } from '../api/client';
import { acceptProviderSession, vaultUnlocked, lockVault } from '../auth/session';
import { mountTelegramWidget, telegramMiniAppProof } from '../auth/telegram-login';
import { useWorkspace } from '../state/workspace';
import { accountDestination } from '../auth/destination';
import NativeWalletPanel from './NativeWalletPanel.vue';
import LinkedAccounts from './LinkedAccounts.vue';
import {
  assertionProof,
  creationOptions,
  registrationProof,
  requestOptions,
} from '../auth/webauthn';
const props = defineProps<{ mode: 'manage' | 'enter' }>();
const route = useRoute(),
  router = useRouter();
const pendingTelegram = ref<Awaited<ReturnType<typeof api.telegramPendingPair>>>();
const oidcAvailable = computed(
  () => linked.value?.telegram.oidc ?? options.value?.telegram.oidc ?? false,
);
const emit = defineEmits<{ authenticated: [account: Account] }>();
const options = ref<SignInOptions>();
const linked = ref<SignInMethods>();
const history = ref<Awaited<ReturnType<typeof api.credentialHistory>>>();
const email = ref('');
const code = ref('');
const revealed = ref('');
const awaitingCode = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const host = ref<HTMLElement>();
const miniAppProof = telegramMiniAppProof(window, window.location.hash);
const miniAppAvailable = computed(
  () => !!miniAppProof && (linked.value?.telegram.miniApp ?? options.value?.telegram.miniApp),
);
let unmountTelegram = () => {};
const passkeysAvailable = computed(() => typeof PublicKeyCredential !== 'undefined');
const delivery = computed(
  () => linked.value?.email.delivery ?? options.value?.email.delivery ?? 'unavailable',
);
const telegramUsername = computed(() =>
  oidcAvailable.value
    ? null
    : (linked.value?.telegram.username ?? options.value?.telegram.username ?? null),
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
let disposed = false,
  revision = 0;
const state = useWorkspace();
const context = () => JSON.stringify([props.mode, state.account?.id]);
type Check = () => void;
function checkContext(stamp: string, generation: number) {
  if (disposed || generation !== revision || context() !== stamp)
    throw new Error('WALLET_CONTEXT_CHANGED');
}
async function run(work: (check: Check) => Promise<void>) {
  const stamp = context(),
    generation = revision;
  const check = () => checkContext(stamp, generation);
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await work(check);
  } catch (cause) {
    if (!disposed && generation === revision) error.value = problem(cause);
  } finally {
    if (!disposed && generation === revision) busy.value = false;
  }
}
function review(message: string) {
  return window.confirm(
    message + '\nPairing opens this service account; DAO governance and private keys are separate.',
  );
}
async function refreshMethods(check: Check) {
  try {
    const [methods, changes] = await Promise.all([api.signInMethods(), api.credentialHistory()]);
    check();
    linked.value = methods;
    history.value = changes;
  } catch (cause) {
    check();
    if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') {
      lockVault();
      await state.refresh();
      await router.replace({ path: '/account', query: { notice: 'signin-removed' } });
      return;
    }
    throw cause;
  }
}
async function load() {
  const stamp = context(),
    generation = revision,
    check = () => checkContext(stamp, generation);
  const settings = await api.signInOptions();
  check();
  options.value = settings;
  if (props.mode === 'manage') {
    await refreshMethods(check);
    check();
    if (typeof route.query.telegramPair === 'string') {
      const result = await api.telegramPendingPair(route.query.telegramPair);
      check();
      pendingTelegram.value = result;
    }
  }
}
async function startTelegram() {
  await run(async (check) => {
    if (
      props.mode === 'manage' &&
      !review('Pair the Telegram identity verified on the next screen?')
    )
      return;
    const authorization = await api.startTelegram(
      props.mode === 'manage' ? 'pair' : 'login',
      accountDestination(route.query.returnTo),
    );
    check();
    const url = new URL(authorization.authorizationUrl);
    if (url.origin !== 'https://oauth.telegram.org' || url.pathname !== '/auth')
      throw new Error('PROVIDER_INVALID');
    window.location.assign(url.href);
  });
}
async function confirmTelegram() {
  await run(async (check) => {
    const pending = pendingTelegram.value;
    if (!pending?.subject || !review('Pair Telegram ' + pending.subject + '?')) return;
    await api.confirmTelegramPair(pending.id);
    check();
    pendingTelegram.value = undefined;
    await router.replace({ query: { ...route.query, telegramPair: undefined } });
    check();
    await refreshMethods(check);
    check();
    notice.value = 'Telegram paired.';
  });
}
function signedIn(account: Account, csrfToken: string) {
  emit('authenticated', acceptProviderSession(account, csrfToken));
}
async function addPasskey() {
  await run(async (check) => {
    if (!review('Add a new passkey to this Daclify account?')) return;
    const options = await api.passkeyRegisterOptions();
    check();
    const created = await navigator.credentials.create({ publicKey: creationOptions(options) });
    check();
    await api.registerPasskey(registrationProof(created));
    check();
    await refreshMethods(check);
    check();
    notice.value = 'Passkey added.';
  });
}
async function signInWithPasskey() {
  await run(async (check) => {
    const options = await api.passkeyLoginOptions();
    check();
    const asserted = await navigator.credentials.get({ publicKey: requestOptions(options) });
    check();
    const session = await api.loginWithPasskey(assertionProof(asserted));
    check();
    signedIn(session.account, session.csrfToken);
  });
}
async function sendCode() {
  await run(async (check) => {
    const mailbox = email.value;
    revealed.value = '';
    code.value = '';
    const started =
      props.mode === 'manage'
        ? await api.startEmailLink(mailbox)
        : await api.startEmailLogin(mailbox);
    check();
    awaitingCode.value = true;
    if ('code' in started) revealed.value = started.code;
    else notice.value = 'Check that mailbox for the code.';
  });
}
async function confirmCode() {
  await run(async (check) => {
    const mailbox = email.value,
      entered = code.value;
    if (props.mode === 'manage') {
      if (!review('Pair ' + mailbox + ' with this Daclify account?')) return;
      await api.confirmEmailLink(mailbox, entered);
      check();
      awaitingCode.value = false;
      revealed.value = '';
      code.value = '';
      email.value = '';
      await refreshMethods(check);
      check();
      notice.value = 'Email paired.';
    } else {
      const session = await api.loginWithEmail(mailbox, entered);
      check();
      signedIn(session.account, session.csrfToken);
    }
  });
}
async function useTelegram(proof: string) {
  await run(async (check) => {
    if (props.mode === 'manage') {
      if (!review('Pair the Telegram identity from this signed Telegram proof?')) return;
      await api.linkTelegram(proof);
      check();
      await refreshMethods(check);
      check();
      notice.value = 'Telegram paired.';
    } else {
      const session = await api.loginWithTelegram(proof);
      check();
      signedIn(session.account, session.csrfToken);
    }
  });
}
async function remove(method: 'telegram' | 'email' | 'passkey', subject: string) {
  await run(async (check) => {
    if (
      !review(
        'Remove ' + method + ' ' + subject + '? Sessions opened with this method will be revoked.',
      )
    )
      return;
    await api.removeSignIn(method, subject);
    check();
    await refreshMethods(check);
    check();
    notice.value = 'Sign-in method removed.';
  });
}
async function earlierHistory() {
  await run(async (check) => {
    const current = history.value;
    if (!current?.next) return;
    const result = await api.credentialHistory(current.next);
    check();
    history.value = { entries: [...current.entries, ...result.entries], next: result.next };
  });
}
watch(context, () => {
  revision++;
  busy.value = false;
  linked.value = undefined;
  history.value = undefined;
  pendingTelegram.value = undefined;
  email.value = '';
  code.value = '';
  revealed.value = '';
  awaitingCode.value = false;
  error.value = '';
  notice.value = '';
  const generation = revision;
  void load().catch((cause) => {
    if (!disposed && generation === revision) error.value = problem(cause);
  });
});
watch(telegramUsername, async (username) => {
  unmountTelegram();
  if (!username) return;
  await Promise.resolve();
  if (disposed || !host.value) return;
  unmountTelegram = mountTelegramWidget(host.value, username, (proof) => {
    void useTelegram(proof);
  });
});
onMounted(() => {
  const generation = revision;
  void load().catch((cause: unknown) => {
    if (!disposed && generation === revision) error.value = problem(cause);
  });
});
onUnmounted(() => {
  disposed = true;
  revision++;
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
    <p v-if="mode === 'manage' && !vaultUnlocked" class="notice">
      Prove account control before adding or removing a method. Unlock your keys from the Keys tab,
      or use an authorized linked wallet.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <NativeWalletPanel :mode="mode" @authenticated="emit('authenticated', $event)" />
    <LinkedAccounts
      v-if="mode === 'enter'"
      mode="enter"
      @authenticated="emit('authenticated', $event)"
    />
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
    <button
      v-if="miniAppAvailable"
      type="button"
      :disabled="busy"
      @click="miniAppProof && useTelegram(miniAppProof)"
    >
      {{
        mode === 'manage'
          ? 'Pair this Telegram Mini App identity'
          : 'Continue from Telegram Mini App'
      }}
    </button>
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
    <div v-if="pendingTelegram?.subject" class="notice">
      <p>
        Verified Telegram identity: <span class="mono wrap">{{ pendingTelegram.subject }}</span>
      </p>
      <p>
        Confirm that this is the Telegram account you want to pair. Existing account-control proof
        is required.
      </p>
      <button type="button" :disabled="busy" @click="confirmTelegram">
        Confirm Telegram pairing
      </button>
    </div>
    <button v-if="oidcAvailable" type="button" :disabled="busy" @click="startTelegram">
      {{ mode === 'manage' ? 'Pair Telegram' : 'Continue with Telegram' }}
    </button>
    <div v-else ref="host" class="telegram-host"></div>
    <p v-if="!telegramUsername && !oidcAvailable" class="muted">
      Telegram is not configured on this server.
    </p>
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
    <template v-if="mode === 'manage' && history"
      ><h3>Sign-in changes</h3>
      <p class="field-help">
        Recorded credential changes for this account. Sign-in pairing and DAO wallet authorization
        are separate.
      </p>
      <ul class="method-list">
        <li v-for="entry in history.entries" :key="entry.id">
          <time :datetime="entry.at">{{ new Date(entry.at).toLocaleString() }}</time> ·
          {{ entry.method }} {{ entry.action }} · <span class="mono wrap">{{ entry.subject }}</span>
        </li>
      </ul>
      <p v-if="!history.entries.length" class="muted">
        No changes recorded since credential history was enabled.
      </p>
      <button
        v-if="history.next"
        type="button"
        class="secondary"
        :disabled="busy"
        @click="earlierHistory"
      >
        Earlier changes
      </button></template
    >
  </section>
</template>
