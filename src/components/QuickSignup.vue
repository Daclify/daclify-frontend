<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { Account, SignupTicket, SignupVerification } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { csrfStorageKey } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import { acceptProviderSession } from '../auth/session';
import { cancelQuickSignup, completeQuickSignup } from '../auth/signup';
import { mountTelegramWidget, telegramMiniAppProof } from '../auth/telegram-login';
import { accountDestination } from '../auth/destination';
import { Mail, Send, Wallet, KeyRound } from '@lucide/vue';
import NativeWalletPanel from './NativeWalletPanel.vue';

const props = defineProps<{ disabled?: boolean; pendingId?: string | undefined }>();
const emit = defineEmits<{
  authenticated: [account: Account];
  busy: [active: boolean];
  ownKeys: [active: boolean];
}>();
const state = useWorkspace(),
  route = useRoute();
const options = ref<Awaited<ReturnType<typeof api.signupOptions>>>(),
  consent = ref(false),
  busy = ref(false),
  nativeBusy = ref(false),
  error = ref(''),
  loading = ref(true),
  selected = ref<'email' | 'telegram' | 'native' | 'keys'>(),
  email = ref(''),
  code = ref(''),
  awaitingCode = ref(false),
  ticket = ref<SignupTicket>(),
  host = ref<HTMLElement>();
const miniAppProof = telegramMiniAppProof(window, window.location.hash);
const telegramUsable = computed(
  () =>
    !!options.value?.telegram.configured &&
    Boolean(
      options.value.telegram.oidc ||
      options.value.telegram.username ||
      (miniAppProof && options.value.telegram.miniApp),
    ),
);
const available = computed(
  () =>
    !!options.value?.assisted.available &&
    (options.value.email.delivery === 'mail' || telegramUsable.value),
);
const operating = computed(() => busy.value || nativeBusy.value);
const working = computed(() => operating.value || props.disabled);
const username = computed(() =>
  selected.value === 'telegram' && consent.value && !options.value?.telegram.oidc
    ? options.value?.telegram.username
    : undefined,
);
let disposed = false,
  revision = 0,
  unmountTelegram = () => {};
watch(operating, (active) => emit('busy', active), { flush: 'sync' });
function guard() {
  const started = revision,
    scope = csrfStorageKey(),
    href = window.location.origin + window.location.pathname + window.location.search,
    account = state.account?.id;
  return () => {
    if (
      disposed ||
      revision !== started ||
      props.disabled ||
      scope !== csrfStorageKey() ||
      href !== window.location.origin + window.location.pathname + window.location.search ||
      account !== state.account?.id
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
  };
}
async function run(work: (check: () => void) => Promise<void>) {
  if (working.value) return;
  busy.value = true;
  error.value = '';
  const check = guard();
  try {
    await work(check);
  } catch (cause) {
    if (!disposed) error.value = friendlyError(cause);
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function loadOptions() {
  loading.value = true;
  error.value = '';
  const check = guard();
  try {
    const result = await api.signupOptions();
    check();
    options.value = result;
    if (props.pendingId && !ticket.value) {
      const result = await api.signupPending(props.pendingId);
      check();
      ticket.value = result;
    }
  } catch (cause) {
    if (!disposed) error.value = friendlyError(cause);
  } finally {
    if (!disposed) loading.value = false;
  }
}
async function complete(check: () => void) {
  if (!ticket.value || !consent.value) throw new Error('RECOVERY_CONSENT_REQUIRED');
  const account = await completeQuickSignup(ticket.value, check);
  check();
  emit('authenticated', account);
}
async function verified(result: SignupVerification, check: () => void) {
  check();
  if (result.status === 'existing')
    emit('authenticated', acceptProviderSession(result.account, result.csrfToken));
  else {
    ticket.value = result;
    await complete(check);
  }
}
function choose(provider: 'email' | 'telegram' | 'native' | 'keys') {
  if (working.value) return;
  if ((provider === 'email' || provider === 'telegram') && (!consent.value || !available.value))
    return;
  selected.value = provider;
  emit('ownKeys', provider === 'keys');
  error.value = '';
}
async function sendCode() {
  await run(async (check) => {
    await api.signupEmailStart(email.value);
    check();
    awaitingCode.value = true;
    code.value = '';
  });
}
async function verifyEmail() {
  await run(async (check) => verified(await api.signupEmailVerify(email.value, code.value), check));
}
async function useTelegram(proof: string) {
  if (!consent.value) return;
  await run(async (check) => verified(await api.signupTelegram(proof), check));
}
async function startTelegram() {
  await run(async (check) => {
    const result = await api.startSignupTelegram(accountDestination(route.query.returnTo));
    check();
    window.location.assign(result.authorizationUrl);
  });
}
function startOver() {
  if (working.value) return;
  revision++;
  cancelQuickSignup();
  ticket.value = undefined;
  selected.value = undefined;
  emit('ownKeys', false);
  awaitingCode.value = false;
  email.value = '';
  code.value = '';
  error.value = '';
}
watch(
  [username, host],
  ([name, element]) => {
    unmountTelegram();
    unmountTelegram = () => {};
    if (!disposed && name && element)
      unmountTelegram = mountTelegramWidget(element, name, (proof) => void useTelegram(proof));
  },
  { flush: 'post' },
);
onMounted(() => void loadOptions());
onUnmounted(() => {
  disposed = true;
  revision++;
  unmountTelegram();
  cancelQuickSignup();
  emit('busy', false);
});
</script>
<template>
  <section class="quick-signup" aria-labelledby="quick-signup-title" :aria-busy="operating">
    <h3 id="quick-signup-title">Get started quickly</h3>
    <p>
      Use Telegram or email to create your account and unlock your keys. No vault password or
      recovery kit is needed to get started.
    </p>
    <p v-if="loading" role="status">Checking quick signup…</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="options?.assisted.reason && !options.assisted.available" class="notice" role="status">
      {{ options.assisted.reason }}
    </p>
    <p class="field-help">
      Email and Telegram use assisted recovery. Telos Zero pairs your wallet; Own Keys keeps your
      keys with you.
    </p>
    <div v-if="available">
      <p class="field-help">
        Already paired this email or Telegram? We’ll open your existing account with its current
        recovery settings.
      </p>
      <p class="field-help">
        Daclify-assisted recovery holds a spare unlocking key for your signing and private-document
        keys. Daclify can recover those keys, so this option does not qualify for DAOs that require
        keys never exposed to an operator. You can turn assisted recovery off later after securing
        independent recovery.
      </p>
      <label class="checkbox"
        ><input v-model="consent" type="checkbox" :disabled="working" />I allow Daclify-assisted
        recovery for my signing and private-document keys.</label
      >
    </div>
    <p v-if="!ticket" class="create-with-label" id="create-with-label">Create with:</p>
    <div v-if="!ticket" class="signup-choices" role="group" aria-labelledby="create-with-label">
      <button
        type="button"
        class="secondary"
        :aria-pressed="selected === 'email'"
        :disabled="working || !consent || !available || options?.email.delivery !== 'mail'"
        @click="choose('email')"
      >
        <Mail aria-hidden="true" />E-Mail
      </button>
      <button
        type="button"
        class="secondary"
        :aria-pressed="selected === 'telegram'"
        :disabled="working || !consent || !available || !telegramUsable"
        @click="choose('telegram')"
      >
        <Send aria-hidden="true" />Telegram
      </button>
      <button
        type="button"
        class="secondary"
        :aria-pressed="selected === 'native'"
        :disabled="working"
        @click="choose('native')"
      >
        <Wallet aria-hidden="true" />Telos Zero
      </button>
      <button
        type="button"
        class="secondary"
        :aria-pressed="selected === 'keys'"
        :disabled="working"
        @click="choose('keys')"
      >
        <KeyRound aria-hidden="true" />Own Keys
      </button>
    </div>
    <NativeWalletPanel
      v-if="!ticket && selected === 'native'"
      mode="signup"
      @authenticated="emit('authenticated', $event)"
      @busy="nativeBusy = $event"
    />
    <template v-if="available">
      <p v-if="ticket" class="notice">
        Your {{ ticket.provider }} identity is verified. Complete encrypted account setup below.
      </p>
      <form v-if="!ticket && selected === 'email' && !awaitingCode" @submit.prevent="sendCode">
        <label for="signup-email">Email address</label
        ><input
          id="signup-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          :disabled="working"
        />
        <button :disabled="working || !consent">{{ busy ? 'Sending code…' : 'Send code' }}</button>
      </form>
      <form v-if="!ticket && selected === 'email' && awaitingCode" @submit.prevent="verifyEmail">
        <p>Enter the 8-digit code sent to {{ email }}.</p>
        <label for="signup-code">Email code</label
        ><input
          id="signup-code"
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{8}"
          minlength="8"
          maxlength="8"
          required
          :disabled="working"
        />
        <button :disabled="working || !consent">
          {{ busy ? 'Setting up your account…' : 'Verify email and create account' }}
        </button>
        <button type="button" class="text-button" :disabled="working" @click="sendCode">
          Send another code
        </button>
      </form>
      <div v-if="!ticket && selected === 'telegram'">
        <button
          v-if="miniAppProof && options?.telegram.miniApp"
          :disabled="working || !consent"
          @click="useTelegram(miniAppProof)"
        >
          Create account from Telegram Mini App
        </button>
        <button
          v-if="options?.telegram.oidc"
          :disabled="working || !consent"
          @click="startTelegram"
        >
          Verify with Telegram
        </button>
        <div v-else-if="username" ref="host" :inert="working" class="telegram-host"></div>
        <p class="field-help">
          Telegram uses the domain configured for this bot. If login is unavailable, use email or
          ask the operator to check Telegram setup.
        </p>
      </div>
      <button v-if="ticket" :disabled="working || !consent" @click="run(complete)">
        {{ busy ? 'Setting up your account…' : error ? 'Retry account setup' : 'Create account' }}
      </button>
      <button v-if="selected || ticket" class="text-button" :disabled="working" @click="startOver">
        Start over
      </button>
    </template>
    <p v-else-if="!loading">
      Quick signup is unavailable on this operator. Choose Telos Zero or Own Keys, or sign in with a
      method already paired to your account.
    </p>
    <button v-if="!loading && !options" class="secondary" :disabled="working" @click="loadOptions">
      Retry quick signup options
    </button>
  </section>
</template>
<style scoped>
.quick-signup {
  padding-bottom: 20px;
}
.quick-signup h3 {
  margin-top: 20px;
}
.quick-signup p,
.quick-signup label {
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.quick-signup form {
  margin-top: 20px;
}
.quick-signup form > button {
  margin-top: 16px;
}
.create-with-label {
  margin-bottom: 10px;
  font-weight: 600;
}
.signup-choices {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 20px;
}
.signup-choices button {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  min-height: 76px;
  padding: 12px 8px;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
}
.signup-choices button[aria-pressed='true'] {
  border-color: var(--accent-amber);
  background: var(--surface-raised);
}
.signup-choices svg {
  width: 20px;
  height: 20px;
  color: var(--accent-amber);
}
@media (max-width: 440px) {
  .signup-choices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
