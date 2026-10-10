<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { FingerprintPattern, Mail, Send, Wallet, RefreshCw, ChevronRight } from '@lucide/vue';
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
const emit = defineEmits<{ authenticated: [account: Account]; busy: [active: boolean] }>();
const options = ref<SignInOptions>();
const optionsLoading = ref(true),
  optionsError = ref('');
const choices = [
  { id: 'passkey', name: 'Passkey', icon: FingerprintPattern },
  { id: 'telegram', name: 'Telegram', icon: Send },
  { id: 'email', name: 'Email', icon: Mail },
  { id: 'native', name: 'Telos Zero', icon: Wallet },
  { id: 'evm', name: 'Telos EVM', icon: Wallet },
] as const;
const selected = ref<(typeof choices)[number]['id']>();
function choose(id: (typeof choices)[number]['id']) {
  if (!working.value) {
    selected.value = id;
    error.value = '';
    notice.value = '';
  }
}
const linked = ref<SignInMethods>();
const history = ref<Awaited<ReturnType<typeof api.credentialHistory>>>();
const email = ref('');
const code = ref('');
const revealed = ref('');
const awaitingCode = ref(false);
const busy = ref(false);
const walletBusy = ref(false);
const working = computed(() => busy.value || walletBusy.value);
watch(working, (active) => emit('busy', active), { flush: 'sync' });
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
const telegramUsername = computed(() => {
  const telegram = linked.value?.telegram ?? options.value?.telegram;
  return !oidcAvailable.value && telegram?.configured ? telegram.username : null;
});
const passkeyHost = computed(() => {
  const host = window.location.hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return '';
  return host;
});
function availability(id: (typeof choices)[number]['id']): string {
  if (id === 'native') return 'Use Anchor';
  if (id === 'evm') return 'Use your EVM wallet';
  if (optionsLoading.value) return 'Checking availability…';
  if (!options.value) return 'Could not be checked';
  if (id === 'passkey')
    return passkeysAvailable.value && passkeyHost.value
      ? 'Device or password manager'
      : 'Unavailable in this browser';
  if (id === 'telegram')
    return miniAppAvailable.value
      ? 'Use this Mini App identity'
      : options.value.telegram.configured
        ? 'Use your paired Telegram'
        : 'Not configured';
  return delivery.value === 'mail'
    ? 'Receive a sign-in code'
    : delivery.value === 'local'
      ? 'Mail delivery needed'
      : 'Not configured';
}
function problem(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return 'The passkey prompt was cancelled.';
  }
  if (cause instanceof DOMException && cause.name === 'SecurityError') {
    return 'This passkey does not match this site or its browser security requirements. Use the site where you paired it, or choose another sign-in method.';
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
  if (working.value) return;
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
async function loadOptions() {
  const generation = revision;
  optionsLoading.value = true;
  optionsError.value = '';
  try {
    await load();
  } catch (cause) {
    if (!disposed && generation === revision) optionsError.value = problem(cause);
  } finally {
    if (!disposed && generation === revision) optionsLoading.value = false;
  }
}
function changeEmail() {
  if (working.value) return;
  awaitingCode.value = false;
  code.value = '';
  revealed.value = '';
  notice.value = '';
  error.value = '';
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
  options.value = undefined;
  history.value = undefined;
  pendingTelegram.value = undefined;
  email.value = '';
  code.value = '';
  revealed.value = '';
  awaitingCode.value = false;
  error.value = '';
  notice.value = '';
  void loadOptions();
});
watch(
  [telegramUsername, host],
  ([username, element]) => {
    unmountTelegram();
    unmountTelegram = () => {};
    if (disposed || !username || !element) return;
    unmountTelegram = mountTelegramWidget(element, username, (proof) => {
      void useTelegram(proof);
    });
  },
  { flush: 'post' },
);
onMounted(() => {
  void loadOptions();
});
onUnmounted(() => {
  disposed = true;
  revision++;
  unmountTelegram();
  emit('busy', false);
});
</script>
<template>
  <section :class="mode === 'manage' ? 'panel narrow' : 'sign-in-choices'">
    <h2 v-if="mode === 'manage'">Sign-in methods</h2>
    <h3 v-else>Choose your sign-in method</h3>
    <p class="sign-in-scope">
      A passkey, Telegram or email opens your account without unlocking your Daclify keys. Use a
      method you’ve already paired.
    </p>
    <p v-if="mode === 'manage' && !vaultUnlocked" class="notice">
      Prove account control before adding or removing a method. Unlock your keys from the Keys tab,
      or use an authorized linked wallet.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="optionsLoading" class="muted" role="status">Checking sign-in options…</p>
    <div v-else-if="optionsError" class="sign-in-options-error" role="alert">
      <div>
        <strong>Sign-in options could not be checked.</strong>
        <p>{{ optionsError }}</p>
      </div>
      <button class="secondary" :disabled="working" @click="loadOptions">
        <RefreshCw aria-hidden="true" />Retry sign-in options
      </button>
    </div>
    <div
      v-if="mode === 'enter'"
      class="sign-in-picker"
      role="group"
      aria-label="Paired sign-in methods"
    >
      <button
        v-for="choice in choices"
        :key="choice.id"
        type="button"
        class="secondary sign-in-choice"
        :aria-label="choice.name"
        :aria-describedby="`signin-${choice.id}-description`"
        :aria-pressed="selected === choice.id"
        :disabled="working"
        @click="choose(choice.id)"
      >
        <component :is="choice.icon" aria-hidden="true" /><span
          ><strong>{{ choice.name }}</strong
          ><small :id="`signin-${choice.id}-description`">{{
            availability(choice.id)
          }}</small></span
        ><ChevronRight aria-hidden="true" />
      </button>
    </div>
    <p v-if="mode === 'enter' && !selected" class="sign-in-hint">Select a method to continue.</p>
    <div
      v-if="mode === 'manage' || selected === 'native'"
      :class="{ 'sign-in-detail': mode === 'enter' }"
    >
      <NativeWalletPanel
        :mode="mode"
        :inert="busy"
        @authenticated="emit('authenticated', $event)"
        @busy="walletBusy = $event"
      />
    </div>
    <div v-if="mode === 'enter' && selected === 'evm'" class="sign-in-detail">
      <LinkedAccounts
        mode="enter"
        @authenticated="emit('authenticated', $event)"
        @busy="walletBusy = $event"
      />
    </div>
    <div
      v-if="mode === 'manage' || selected === 'passkey'"
      :class="{ 'sign-in-detail': mode === 'enter' }"
    >
      <h3>Passkey</h3>
      <ul v-if="linked" class="method-list">
        <li v-for="passkey in linked.passkeys" :key="passkey.id" class="method-row">
          <span class="mono">{{ passkey.id.slice(0, 10) }}</span>
          <button
            type="button"
            class="secondary"
            :disabled="working"
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
        :disabled="working || optionsLoading || !options"
        @click="addPasskey"
      >
        Add a passkey
      </button>
      <button
        v-else-if="passkeysAvailable && passkeyHost"
        type="button"
        :disabled="working || optionsLoading || !options"
        @click="signInWithPasskey"
      >
        Sign in with a passkey
      </button>
      <p v-else-if="passkeysAvailable" class="muted">
        Passkeys need a secure hostname. For local testing, open this page at localhost instead of
        an IP address.
      </p>
      <p v-else class="muted">This browser cannot create a passkey.</p>
    </div>
    <div
      v-if="mode === 'manage' || selected === 'telegram'"
      :class="{ 'sign-in-detail': mode === 'enter' }"
    >
      <h3>Telegram</h3>
      <button
        v-if="miniAppAvailable"
        type="button"
        :disabled="working"
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
            :disabled="working"
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
        <button type="button" :disabled="working" @click="confirmTelegram">
          Confirm Telegram pairing
        </button>
      </div>
      <button v-if="oidcAvailable" type="button" :disabled="working" @click="startTelegram">
        {{ mode === 'manage' ? 'Pair Telegram' : 'Continue with Telegram' }}
      </button>
      <div v-else-if="telegramUsername" ref="host" class="telegram-host"></div>
      <p v-if="telegramUsername" class="field-help">
        Telegram login uses the domain linked to this bot. If it reports “Bot domain invalid”, use
        another paired method and ask the operator to check the Telegram setup.
      </p>
      <p
        v-if="(options || linked) && !telegramUsername && !oidcAvailable && !miniAppAvailable"
        class="muted"
      >
        Telegram is not configured on this server.
      </p>
    </div>
    <div
      v-if="mode === 'manage' || selected === 'email'"
      :class="{ 'sign-in-detail': mode === 'enter' }"
    >
      <h3>Email</h3>
      <ul v-if="linked" class="method-list">
        <li v-for="subject in linked.email.subjects" :key="subject" class="method-row">
          <span>{{ subject }}</span>
          <button
            type="button"
            class="secondary"
            :disabled="working"
            @click="remove('email', subject)"
          >
            Remove
          </button>
        </li>
      </ul>
      <form
        v-if="!awaitingCode && (delivery === 'mail' || (mode === 'manage' && delivery === 'local'))"
        @submit.prevent="sendCode"
      >
        <label for="sign-in-email">Sign-in email</label>
        <input
          id="sign-in-email"
          v-model="email"
          type="email"
          autocomplete="username"
          required
          :disabled="working"
        />
        <button type="submit" :disabled="working">
          {{ busy ? 'Sending code…' : 'Send code' }}
        </button>
      </form>
      <p v-if="revealed" class="notice" role="status">
        The code for this browser is {{ revealed }}.
      </p>
      <form v-if="awaitingCode" @submit.prevent="confirmCode">
        <p class="email-code-destination">
          Enter the 8-digit code for <strong class="wrap">{{ email }}</strong
          >.
        </p>
        <label for="sign-in-code">Email code</label>
        <input
          id="sign-in-code"
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          minlength="8"
          maxlength="8"
          required
          :disabled="working"
        />
        <button type="submit" :disabled="working">
          {{ busy ? 'Checking code…' : mode === 'manage' ? 'Confirm email' : 'Sign in with email' }}
        </button>
        <div class="button-row">
          <button type="button" class="text-button" :disabled="working" @click="sendCode">
            Send another code</button
          ><button type="button" class="text-button" :disabled="working" @click="changeEmail">
            Use another email
          </button>
        </div>
      </form>
      <p v-if="(options || linked) && delivery === 'unavailable'" class="muted">
        Email sign-in is not configured on this server.
      </p>
      <p v-else-if="mode === 'enter' && delivery === 'local'" class="muted">
        Email sign-in from this screen needs mail delivery. Pair an email from the account page
        after you unlock the vault.
      </p>
      <p v-else-if="mode === 'manage' && delivery === 'local'" class="field-help">
        Mail is not configured, so the pairing code is shown on this page. Signing in with email
        from another browser needs mail delivery.
      </p>
    </div>
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
        :disabled="working"
        @click="earlierHistory"
      >
        Earlier changes
      </button></template
    >
  </section>
</template>
<style scoped>
.sign-in-choices h3 {
  font-size: 1rem;
}
.sign-in-scope,
.sign-in-hint {
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.sign-in-hint {
  margin-bottom: 0;
}
.sign-in-picker {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
  gap: 12px;
  margin: 20px 0;
}
.sign-in-choice {
  display: flex;
  gap: 12px;
  align-items: center;
  text-align: left;
  border-radius: var(--radius-md);
  padding: 16px;
  color: var(--text-primary);
  background: var(--surface-panel);
  border-color: var(--border-default);
  box-shadow: none;
}
.sign-in-choice > svg {
  width: 22px;
  height: 22px;
  flex: none;
  color: var(--accent-amber);
}
.sign-in-choice > svg:last-child {
  margin-left: auto;
  width: 16px;
  height: 16px;
}
.sign-in-choice > span {
  min-width: 0;
}
.sign-in-choice strong {
  display: block;
  font-size: 0.875rem;
}
.sign-in-choice small {
  display: block;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-weight: 400;
  line-height: 1.5;
  margin-top: 6px;
}
.sign-in-choice[aria-pressed='true'] {
  border-color: var(--accent-amber);
  background: var(--accent-soft);
}
.sign-in-detail {
  border-top: 1px solid var(--border-default);
  padding-top: 20px;
}
.sign-in-detail :deep(h3) {
  margin: 0 0 12px;
  font-size: 1rem;
}
.sign-in-detail :deep(p),
.sign-in-detail :deep(label) {
  font-size: 0.875rem;
}
.sign-in-detail :deep(form > button) {
  margin-top: 16px;
}
.sign-in-detail :deep(button) {
  min-height: 44px;
}
.sign-in-options-error {
  border: 1px solid var(--border-warm);
  background: var(--accent-soft);
  border-radius: var(--radius-md);
  padding: 16px;
  margin: 16px 0;
}
.sign-in-options-error strong,
.sign-in-options-error p {
  font-size: 0.875rem;
}
.sign-in-options-error p {
  margin: 8px 0;
}
.sign-in-options-error button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.sign-in-options-error svg {
  width: 16px;
  height: 16px;
}
.email-code-destination {
  overflow-wrap: anywhere;
}
@media (max-width: 500px) {
  .sign-in-picker {
    grid-template-columns: 1fr;
  }
}
</style>
