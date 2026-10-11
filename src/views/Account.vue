<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowUpRight,
  KeyRound,
  ShieldCheck,
  LifeBuoy,
  FingerprintPattern,
  UserRound,
  CreditCard,
  ArrowLeft,
  ChevronRight,
} from '@lucide/vue';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError, type ServiceReceipt } from '../api/client';
import { formatReceiptAmount } from '../api/billing';
import {
  createVault,
  generateVaultPassword,
  restoreRecoveryKit,
  type CreatedVault,
} from '../auth/vault';
import {
  savedVault,
  saveVault,
  saveRestoredVault,
  unlockAndLogin,
  lockVault,
  downloadBackup,
  vaultUnlocked,
  acceptProviderSession,
} from '../auth/session';
import { JoinIdentitySchema, type Account, type RecoveryMethods } from '@daclify/core-protocol';
import { accountDestination } from '../auth/destination';
import ProfilePanel from '../components/ProfilePanel.vue';
import SignInMethods from '../components/SignInMethods.vue';
import FastSignInMethods from '../components/FastSignInMethods.vue';
import DeviceApproval from '../components/DeviceApproval.vue';
import QuickSignup from '../components/QuickSignup.vue';
import AssistedRecoveryOptOut from '../components/AssistedRecoveryOptOut.vue';
import { restoreFastSignIn } from '../auth/fast-sign-in';
const props = defineProps<{
  embedded?: boolean;
  profileDaoId?: string | undefined;
  profileMemberId?: string | undefined;
}>();
const emit = defineEmits<{ 'profile-updated': [] }>();
const accountTabs = [
  { id: 'keys', label: 'Access & recovery', icon: ShieldCheck },
  { id: 'sign-in', label: 'Sign-in methods', icon: FingerprintPattern },
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'service', label: 'Payment history', icon: CreditCard },
] as const;
type AccountTab = (typeof accountTabs)[number]['id'];
function billingTab(value: unknown): boolean {
  return value === 'submitted' || value === 'cancelled';
}
const restoring = ref(false);
const kitText = ref('');
const recoveryCredential = ref('');
const replacementAcknowledged = ref(false);
const route = useRoute();
const router = useRouter();
const destination = computed(() => accountDestination(route.query.returnTo));
const state = useWorkspace();
const recoveryInfo = ref<RecoveryMethods>();
const recoveryCheckFailed = ref(false);
watch(
  () => state.account?.id,
  async (id) => {
    recoveryInfo.value = undefined;
    recoveryCheckFailed.value = false;
    if (!id) return;
    try {
      const response = await api.recoveryMethods();
      if (state.account?.id === id) recoveryInfo.value = response;
    } catch {
      if (state.account?.id === id) recoveryCheckFailed.value = true;
    }
  },
  { immediate: true },
);
watch(restoring, (active) => {
  void nextTick(() =>
    document
      .getElementById(active ? 'kit' : state.account ? 'account-tab-keys' : 'entry-restore')
      ?.focus(),
  );
});
const joinIdentity = computed(() =>
  state.account && state.account.signingKey !== null && recoveryInfo.value
    ? JSON.stringify(
        JoinIdentitySchema.parse({
          version: 1,
          signingKey: state.account.signingKey,
          encryptionKey: state.account.encryptionKey,
          custody: recoveryInfo.value.assistedEver ? 'managed' : state.account.custody,
        }),
        null,
        2,
      )
    : '',
);
const joinCopied = ref(false);
async function copyJoinIdentity() {
  try {
    await navigator.clipboard.writeText(joinIdentity.value);
    joinCopied.value = true;
  } catch {
    joinCopied.value = false;
  }
}

const tab = ref<AccountTab>(
  props.embedded ? 'profile' : billingTab(route.query.billing) ? 'service' : 'keys',
);
const opened = ref<Record<AccountTab, boolean>>({
  keys: true,
  'sign-in': false,
  profile: !!props.embedded,
  service: true,
});
function openTab(next: AccountTab) {
  tab.value = next;
  opened.value = { ...opened.value, [next]: true };
  void nextTick(() => document.getElementById(`account-tab-${next}`)?.focus());
}
function navigateTabs(event: KeyboardEvent) {
  const current = accountTabs.findIndex((item) => item.id === tab.value);
  const index =
    event.key === 'ArrowRight'
      ? (current + 1) % accountTabs.length
      : event.key === 'ArrowLeft'
        ? (current + accountTabs.length - 1) % accountTabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? accountTabs.length - 1
            : undefined;
  if (index === undefined) return;
  const item = accountTabs[index];
  if (!item) return;
  event.preventDefault();
  openTab(item.id);
}
onMounted(async () => {
  if (typeof route.query.telegramPair === 'string') openTab('sign-in');
  if (route.query.telegram === 'complete') {
    try {
      const session = await api.resumeSession();
      await router.replace({ query: { ...route.query, telegram: undefined } });
      await onSignedIn(acceptProviderSession(session.account, session.csrfToken));
    } catch (cause) {
      error.value = friendlyError(cause);
    }
  }
});
watch(
  () => route.query.billing,
  (value) => {
    if (billingTab(value)) openTab('service');
  },
);
const saved = ref(savedVault());
const entry = ref<'choices' | 'login' | 'new'>(
    typeof route.query.signup === 'string' ? 'new' : 'choices',
  ),
  ownKeys = ref(false),
  quickBusy = ref(false);
const entryChoices = [
  { id: 'login', label: 'Login', description: 'Open your existing account.', icon: KeyRound },
  { id: 'new', label: 'New Account', description: 'Get started with Daclify.', icon: UserRound },
  {
    id: 'restore',
    label: 'Restore Account',
    description: 'Use your encrypted recovery kit.',
    icon: LifeBuoy,
  },
] as const;
function openEntry(next: 'login' | 'new' | 'restore') {
  if (busy.value || providerBusy.value || quickBusy.value) return;
  error.value = '';
  password.value = '';
  if (next === 'restore') restoring.value = true;
  else {
    entry.value = next;
    void nextTick(() =>
      document.getElementById(next === 'login' ? 'returning-title' : 'new-title')?.focus(),
    );
  }
}
function backToChoices() {
  if (busy.value || providerBusy.value || quickBusy.value) return;
  const previous = entry.value;
  entry.value = 'choices';
  ownKeys.value = false;
  password.value = '';
  error.value = '';
  void nextTick(() => document.getElementById('entry-' + previous)?.focus());
}
watch(ownKeys, (active) => {
  if (active) void nextTick(() => document.getElementById('password')?.focus());
});
const accountKit = computed(() => {
  const record = saved.value,
    account = state.account;
  if (!record || !account) return undefined;
  if (account.signingKey === null) return record;
  return record.signingPublicKey === account.signingKey &&
    JSON.stringify(record.encryptionPublicKey) === JSON.stringify(account.encryptionKey)
    ? record
    : undefined;
});
const receipts = ref<ServiceReceipt[]>([]);
const receiptsLoading = ref(false);
const billingError = ref('');
const billingNote = computed(() => {
  if (route.query.billing === 'submitted') {
    return 'The card payment is recorded when Stripe notifies this service. Refresh history if it is not listed yet.';
  }
  if (route.query.billing === 'cancelled') return 'The card payment was cancelled.';
  return '';
});
watch(
  () => state.account?.id,
  (id) => {
    receipts.value = [];
    receiptsLoading.value = false;
    billingError.value = '';
    if (id) void loadReceipts();
  },
  { immediate: true },
);
async function loadReceipts() {
  const accountId = state.account?.id;
  if (!accountId) return;
  receiptsLoading.value = true;
  billingError.value = '';
  try {
    const response = await api.serviceReceipts();
    if (state.account?.id === accountId) receipts.value = response.receipts;
  } catch (cause) {
    if (state.account?.id !== accountId) return;
    receipts.value = [];
    billingError.value =
      cause instanceof Error && cause.message === 'STRIPE_NOT_CONFIGURED'
        ? 'Payment history is unavailable on this service.'
        : friendlyError(cause);
  } finally {
    if (state.account?.id === accountId) receiptsLoading.value = false;
  }
}
const password = ref('');
const passwordVisible = ref(false);
const passwordCopied = ref(false);
const created = ref<CreatedVault>();
const acknowledged = ref(false);
const recoveryCopied = ref(false);
const busy = ref(false);
const providerBusy = ref(false);
const error = ref('');
const heading = computed(() =>
  restoring.value
    ? 'Recover your account'
    : created.value
      ? 'Save your recovery kit'
      : state.account
        ? 'Your account'
        : entry.value === 'login'
          ? 'Sign in to Daclify'
          : entry.value === 'new'
            ? 'Create your Daclify account'
            : 'Your Daclify account',
);
async function selectKit(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.[0];
  kitText.value = '';
  error.value = '';
  if (!file) return;
  if (file.size > 65536) {
    error.value = 'Choose an encrypted recovery kit smaller than 64 KB.';
    return;
  }
  kitText.value = await file.text();
}
async function restore() {
  if (providerBusy.value || quickBusy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (saved.value && !replacementAcknowledged.value) {
      error.value = 'Confirm that you have backed up the account currently on this device.';
      return;
    }
    const record = await restoreRecoveryKit(
      JSON.parse(kitText.value),
      recoveryCredential.value,
      password.value,
    );
    saveRestoredVault(record);
    saved.value = record;
    recoveryCredential.value = '';
    kitText.value = '';
    restoring.value = false;
    await unlock();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function generatePassword() {
  password.value = generateVaultPassword();
  passwordVisible.value = true;
  passwordCopied.value = false;
  error.value = '';
}
async function copyPassword() {
  if (password.value.length === 0) return;
  error.value = '';
  try {
    await navigator.clipboard.writeText(password.value);
    passwordCopied.value = true;
  } catch {
    passwordCopied.value = false;
    error.value = 'Select the vault password and copy it manually.';
  }
}
async function create() {
  if (busy.value || providerBusy.value || quickBusy.value) return;
  busy.value = true;
  error.value = '';
  try {
    created.value = await createVault(password.value);
  } catch (cause) {
    error.value =
      cause instanceof Error && cause.message === 'Use at least 12 characters'
        ? 'Use at least 12 characters for your vault password.'
        : friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function copyRecovery() {
  if (!created.value) return;
  error.value = '';
  try {
    await navigator.clipboard.writeText(created.value.recoveryCredential);
    recoveryCopied.value = true;
  } catch {
    recoveryCopied.value = false;
    error.value = 'Select the recovery credential and copy it manually.';
  }
}
async function finish() {
  if (!created.value || !acknowledged.value || (saved.value && !replacementAcknowledged.value))
    return;
  saveVault(created.value);
  saved.value = savedVault();
  await unlock();
  created.value = undefined;
}
async function unlock() {
  if (providerBusy.value || quickBusy.value) return;
  busy.value = true;
  error.value = '';
  try {
    state.account = await unlockAndLogin(password.value, state.account);
    password.value = '';
    await state.refresh();
    if (destination.value) await router.push(destination.value);
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function onSignedIn(account: Account) {
  state.account = account;
  password.value = '';
  error.value = '';
  if (route.query.signup) await router.replace({ query: { ...route.query, signup: undefined } });
  try {
    await restoreFastSignIn(account);
  } catch (cause) {
    error.value = friendlyError(cause);
  }
  await state.refresh();
  if (destination.value) await router.push(destination.value);
}
async function logout() {
  busy.value = true;
  try {
    await api.logout();
    lockVault();
    state.account = undefined;
    state.memberships = [];
    entry.value = 'choices';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function backup() {
  const record = created.value
    ? {
        version: 1 as const,
        localEnvelope: created.value.localEnvelope,
        recoveryEnvelope: created.value.recoveryEnvelope,
        signingPublicKey: created.value.signingPublicKey,
        encryptionPublicKey: created.value.encryptionPublicKey,
      }
    : state.account
      ? accountKit.value
      : saved.value;
  if (record) downloadBackup(record);
}
</script>
<template>
  <div
    v-if="!embedded"
    class="page-heading account-heading"
    :class="{ 'settings-heading': state.account }"
  >
    <div>
      <p class="eyebrow">{{ state.account ? 'ACCOUNT SETTINGS' : 'IDENTITY & RECOVERY' }}</p>
      <h1>{{ heading }}</h1>
      <p class="lead">
        {{
          state.account
            ? 'Your sign-in methods, devices and public profile.'
            : 'One Daclify identity for your communities. A blockchain account is optional.'
        }}
      </p>
    </div>
  </div>
  <p v-if="route.query.telegram === 'failed'" class="alert" role="alert">
    Telegram verification could not be completed. Try again from this browser, or use email.
  </p>
  <p v-if="route.query.notice === 'signin-removed'" class="notice" role="status">
    Sign-in method removed. Its sessions were revoked; sign in with a remaining method.
  </p>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <section v-if="restoring" class="panel narrow account-flow">
    <h2>Restore your existing keys</h2>
    <p>
      Choose your encrypted kit and enter the vault password saved with that kit, or its separate
      recovery code. Your new password protects this device.
    </p>
    <form @submit.prevent="restore">
      <label for="kit">Encrypted recovery kit</label
      ><input
        id="kit"
        type="file"
        accept="application/json,.json"
        required
        :disabled="busy"
        @change="selectKit"
      /><label for="recover-credential">Vault password or recovery code</label
      ><input
        id="recover-credential"
        v-model="recoveryCredential"
        type="password"
        autocomplete="off"
        required
        :disabled="busy"
      /><label for="recover-password">New vault password</label
      ><input
        id="recover-password"
        v-model="password"
        type="password"
        autocomplete="new-password"
        minlength="12"
        required
        :disabled="busy"
      /><label v-if="saved" class="checkbox"
        ><input v-model="replacementAcknowledged" type="checkbox" required />I have backed up the
        account currently on this device</label
      >
      <div class="button-row recovery-actions">
        <button type="submit" :disabled="busy || !kitText">
          {{ busy ? 'Restoring…' : 'Restore' }}
        </button>
        <button type="button" class="secondary" :disabled="busy" @click="restoring = false">
          Cancel
        </button>
      </div>
    </form>
  </section>
  <section v-else-if="created" class="panel narrow account-flow">
    <h2>Keep access on a new device</h2>
    <p>
      Your password unlocks this device and the password-protected copy in your downloaded kit. The
      separate recovery code below restores your keys if you forget that password.
    </p>
    <button class="secondary" @click="backup">Download encrypted recovery kit</button
    ><label for="recovery">Recovery credential — generated for this vault</label
    ><textarea
      id="recovery"
      readonly
      :value="created.recoveryCredential"
      rows="2"
      spellcheck="false"
    ></textarea>
    <div class="button-row">
      <button type="button" class="secondary" @click="copyRecovery">
        Copy recovery credential
      </button>
    </div>
    <p v-if="recoveryCopied" class="notice" role="status">Recovery credential copied.</p>
    <p class="muted">
      Store this recovery code away from the downloaded kit. Restoring your keys requires the kit
      and either its vault password or this code.
    </p>
    <label class="checkbox"
      ><input v-model="acknowledged" type="checkbox" />I have saved my recovery kit and
      credential</label
    ><label v-if="saved" class="checkbox"
      ><input v-model="replacementAcknowledged" type="checkbox" />I backed up the other account
      currently saved on this device before replacing its local vault.</label
    >
    <button
      :disabled="!acknowledged || busy || (saved && !replacementAcknowledged)"
      @click="finish"
    >
      {{ busy ? 'Finishing…' : 'Finish account setup' }}
    </button>
  </section>
  <div v-else-if="state.account" class="account-settings">
    <div class="account-session-bar">
      <span class="pill">{{
        state.account.signingKey === null
          ? 'Wallet only'
          : !recoveryInfo
            ? recoveryCheckFailed
              ? 'Recovery status unavailable'
              : 'Checking recovery…'
            : recoveryInfo.assistedEver
              ? (recoveryInfo.assistedEnabled ??
                recoveryInfo.methods.some((method) => method.mode === 'daclify-assisted'))
                ? 'Assisted recovery'
                : 'Assisted recovery off'
              : state.account.custody === 'user-controlled'
                ? 'You hold the keys'
                : 'Managed account'
      }}</span>
      <button class="text-button danger" :disabled="busy" @click="logout">Sign out</button>
    </div>
    <p v-if="recoveryInfo?.assistedEver" class="notice" role="status">
      This vault previously authorized Daclify-assisted recovery. Recovery status below shows
      whether assisted methods are still enabled. Its history remains part of DAO admission.
    </p>
    <div class="account-tabs" role="tablist" @keydown="navigateTabs" aria-label="Account sections">
      <button
        v-for="item in accountTabs"
        :id="`account-tab-${item.id}`"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="tab === item.id"
        :aria-controls="`account-panel-${item.id}`"
        :tabindex="tab === item.id ? 0 : -1"
        @click="openTab(item.id)"
      >
        <component :is="item.icon" aria-hidden="true" /><span>{{ item.label }}</span>
      </button>
    </div>
    <section
      v-show="tab === 'keys'"
      id="account-panel-keys"
      class="panel settings-panel"
      role="tabpanel"
      aria-labelledby="account-tab-keys"
    >
      <div class="access-grid">
        <section class="device-access" aria-labelledby="this-device-title">
          <div class="panel-heading">
            <h2 id="this-device-title">This device</h2>
            <span :class="['pill', { success: vaultUnlocked }]">{{
              vaultUnlocked ? 'Keys unlocked' : 'Sign-in only'
            }}</span>
          </div>
          <p v-if="vaultUnlocked">Ready to sign actions and open your private documents.</p>
          <p
            v-if="state.account.signingKey === null && state.account.walletOrigin === 'signup'"
            class="notice"
            role="status"
          >
            Your Telos Zero wallet opens this Daclify account. Set up Daclify keys when you want to
            join or create another DAO and use its private content.
          </p>
          <p v-else-if="state.account.signingKey === null" class="notice" role="status">
            Your wallet restores access to its current on-chain memberships and permissions. Your
            original document-decryption keys and lost social-login pairings have not been restored.
            To recover private content, import your original encrypted kit and confirm with your
            wallet.
          </p>
          <form v-if="!vaultUnlocked && accountKit" @submit.prevent="unlock">
            <label for="unlock">Vault password</label
            ><input
              id="unlock"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
            /><button :disabled="busy">Unlock and sign in</button>
          </form>
          <div v-else-if="vaultUnlocked" class="button-row">
            <button class="secondary" @click="lockVault">Lock vault</button
            ><button v-if="accountKit" class="secondary" @click="backup">
              Download encrypted backup
            </button>
          </div>
          <p v-if="!vaultUnlocked && !accountKit" class="muted">
            Your account is signed in. To sign actions and open private documents, use a paired
            method with full access, approve this device, or restore your encrypted kit.
          </p>
          <button
            v-if="!vaultUnlocked && !accountKit"
            type="button"
            class="secondary"
            @click="restoring = true"
          >
            Recover from an encrypted kit
          </button>
          <p class="field-help">Keys lock after ten minutes without a signing action.</p>
          <button
            v-if="!vaultUnlocked"
            type="button"
            class="text-button"
            @click="openTab('sign-in')"
          >
            View paired sign-in methods <ArrowUpRight aria-hidden="true" />
          </button>
        </section>
        <DeviceApproval
          :account="state.account"
          :approve-id="
            typeof route.query.deviceApproval === 'string' ? route.query.deviceApproval : undefined
          "
        />
      </div>
      <AssistedRecoveryOptOut
        :account="state.account"
        :methods="recoveryInfo"
        @changed="recoveryInfo = $event"
        @kit-saved="saved = savedVault()"
      />
      <details class="identity-details">
        <summary>
          {{ state.account.signingKey === null ? 'Account details' : 'Public join identity' }}
        </summary>
        <p class="muted">Account ID</p>
        <p class="mono wrap">{{ state.account.id }}</p>
        <template v-if="state.account.signingKey !== null">
          <p class="muted">Signing public key</p>
          <p class="mono wrap">{{ state.account.signingKey }}</p>
          <p>
            Share this JSON with the DAO administrator to request admission. It contains public
            signing and encryption keys only. Keep your recovery kit private.
          </p>
          <label for="public-join-identity">Public join identity JSON</label>
          <textarea id="public-join-identity" readonly rows="7" :value="joinIdentity"></textarea>
          <button class="secondary" :disabled="!joinIdentity" @click="copyJoinIdentity">
            Copy public join identity
          </button>
          <p v-if="!recoveryInfo" class="field-help">
            Recovery authority must be checked before sharing a join identity.
          </p>
          <p v-if="joinCopied" role="status">Public join identity copied.</p>
        </template>
      </details>
      <RouterLink v-if="destination" class="button secondary" :to="destination"
        >Return to your DAO or setup</RouterLink
      >
      <details v-if="state.account.signingKey === null && !saved">
        <summary>Create Daclify keys for a new DAO</summary>
        <p>
          New keys support new DAOs and content. They cannot decrypt your existing private
          documents. Keep your wallet connected: attaching keys requires both your wallet approval
          and proof of the new keys.
        </p>
        <form @submit.prevent="create">
          <label for="wallet-vault-password">New vault password</label>
          <input
            id="wallet-vault-password"
            v-model="password"
            type="password"
            minlength="12"
            autocomplete="new-password"
            required
          />
          <button :disabled="busy">Create encrypted vault</button>
        </form>
      </details>
    </section>
    <div
      v-if="opened['sign-in']"
      v-show="tab === 'sign-in'"
      id="account-panel-sign-in"
      role="tabpanel"
      aria-labelledby="account-tab-sign-in"
    >
      <SignInMethods mode="manage" />
      <FastSignInMethods
        v-if="state.account"
        :account="state.account"
        @changed="recoveryInfo = $event"
        @unlock-needed="openTab('keys')"
      />
    </div>
    <div
      v-if="opened.profile"
      v-show="tab === 'profile'"
      id="account-panel-profile"
      role="tabpanel"
      aria-labelledby="account-tab-profile"
    >
      <ProfilePanel
        :dao-id="profileDaoId"
        :member-id="profileMemberId"
        @updated="emit('profile-updated')"
      />
    </div>
    <section
      v-show="tab === 'service'"
      id="account-panel-service"
      class="panel settings-panel"
      role="tabpanel"
      aria-labelledby="account-tab-service"
      :aria-busy="receiptsLoading"
    >
      <h2>Payment history</h2>
      <p>Your Daclify service payment receipts.</p>
      <p v-if="billingNote">{{ billingNote }}</p>
      <p v-if="billingError" class="alert" role="alert">{{ billingError }}</p>
      <p v-if="receiptsLoading" role="status">Loading payment history…</p>
      <ul v-if="receipts.length" class="receipt-list" aria-label="Service payment receipts">
        <li v-for="(receipt, index) in receipts" :key="index">
          {{ receipt.status === 'paid' ? 'Paid' : 'Failed' }} ·
          {{ formatReceiptAmount(receipt.currency, receipt.amountMinor) }}
        </li>
      </ul>
      <p v-else-if="!receiptsLoading && !billingError" class="muted">
        No service payment receipts yet.
      </p>
      <div class="button-row">
        <button type="button" class="secondary" :disabled="receiptsLoading" @click="loadReceipts">
          Refresh history
        </button>
      </div>
    </section>
  </div>
  <div v-else class="account-access">
    <div
      v-if="entry === 'choices'"
      class="account-choices"
      role="group"
      aria-label="Account options"
    >
      <button
        v-for="choice in entryChoices"
        :id="'entry-' + choice.id"
        :key="choice.id"
        type="button"
        class="account-choice"
        :aria-label="choice.label"
        :disabled="busy || providerBusy || quickBusy"
        @click="openEntry(choice.id)"
      >
        <component :is="choice.icon" aria-hidden="true" />
        <span class="choice-title">{{ choice.label }}<ChevronRight aria-hidden="true" /></span>
        <span class="choice-description">{{ choice.description }}</span>
      </button>
    </div>
    <div v-else class="account-entry">
      <section
        v-if="entry === 'login'"
        class="panel account-returning"
        aria-labelledby="returning-title"
        :inert="busy || quickBusy"
      >
        <div class="account-section-title">
          <KeyRound aria-hidden="true" />
          <div>
            <h2 id="returning-title" tabindex="-1">Welcome back</h2>
            <p>Sign in to continue to your communities.</p>
          </div>
          <button
            type="button"
            class="text-button account-back"
            :disabled="busy || providerBusy || quickBusy"
            @click="backToChoices"
          >
            <ArrowLeft aria-hidden="true" /> Back
          </button>
        </div>
        <div v-if="saved" class="local-vault">
          <span class="pill success">Saved on this device</span>
          <h3>Use your Daclify keys</h3>
          <p>Your vault password unlocks signing and decryption keys in this browser.</p>
          <form @submit.prevent="unlock">
            <label for="unlock">Vault password</label
            ><input
              id="unlock"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              :disabled="busy || providerBusy"
            />
            <button :disabled="busy || providerBusy">
              {{ busy ? 'Unlocking…' : 'Unlock and sign in' }}
            </button>
          </form>
        </div>
        <SignInMethods
          mode="enter"
          @authenticated="onSignedIn"
          @busy="providerBusy = $event"
          @create-account="openEntry('new')"
        />
      </section>
      <section
        v-else-if="entry === 'new'"
        id="new-account"
        class="panel account-new"
        aria-labelledby="new-title"
        tabindex="-1"
      >
        <div class="account-section-title">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2 id="new-title" tabindex="-1">New to Daclify?</h2>
            <p>Create your identity, then join or start a DAO.</p>
          </div>
          <button
            type="button"
            class="text-button account-back"
            :disabled="busy || providerBusy || quickBusy"
            @click="backToChoices"
          >
            <ArrowLeft aria-hidden="true" /> Back
          </button>
        </div>
        <QuickSignup
          :disabled="busy || providerBusy"
          :pending-id="typeof route.query.signup === 'string' ? route.query.signup : undefined"
          @authenticated="onSignedIn"
          @busy="quickBusy = $event"
          @own-keys="ownKeys = $event"
        />
        <section v-if="ownKeys" class="own-vault" :inert="quickBusy">
          <span class="pill success">User-controlled</span>
          <h3>You hold the keys</h3>
          <p>
            Your keys are encrypted in this browser. You’ll save a recovery kit before finishing
            setup. No blockchain account is needed.
          </p>
          <form @submit.prevent="create">
            <label for="password">Vault password</label>
            <div class="password-field">
              <input
                id="password"
                v-model="password"
                :type="passwordVisible ? 'text' : 'password'"
                minlength="12"
                autocomplete="new-password"
                spellcheck="false"
                required
                :disabled="busy || providerBusy"
                @input="passwordCopied = false"
              />
              <div class="field-actions">
                <button
                  type="button"
                  aria-label="Generate vault password"
                  :disabled="busy || providerBusy"
                  @click="generatePassword"
                >
                  Generate
                </button>
                <button
                  type="button"
                  aria-label="Copy vault password"
                  :disabled="busy || providerBusy || password.length === 0"
                  @click="copyPassword"
                >
                  {{ passwordCopied ? 'Copied' : 'Copy' }}
                </button>
              </div>
            </div>
            <div class="account-password-help">
              <p class="field-help">
                At least 12 characters. Generate one or use your password manager.
              </p>
              <button
                type="button"
                class="text-button"
                :aria-label="passwordVisible ? 'Hide vault password' : 'Show vault password'"
                :aria-pressed="passwordVisible"
                :disabled="busy || providerBusy"
                @click="passwordVisible = !passwordVisible"
              >
                {{ passwordVisible ? 'Hide' : 'Show' }}
              </button>
            </div>
            <button :disabled="busy || providerBusy">
              {{ busy ? 'Encrypting vault…' : 'Create encrypted vault' }}
            </button>
          </form>
        </section>
      </section>
    </div>
    <p class="account-access-note">
      An account gets you into Daclify. Each DAO controls membership, voting rights and permissions
      separately. <RouterLink to="/docs/accounts">How access works</RouterLink>
    </p>
  </div>
</template>
<style scoped>
.account-settings {
  max-width: 960px;
}
.account-session-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: -12px;
  margin-bottom: 12px;
}
.account-settings .account-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  background: var(--surface-soft);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  margin-bottom: 20px;
}
.account-settings .account-tabs button {
  min-width: 0;
  min-height: 44px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  padding: 8px;
  box-shadow: none;
  transform: none;
  font-size: 0.8125rem;
}
.account-settings .account-tabs button[aria-selected='true'] {
  border-color: var(--border-warm);
  background: var(--surface-raised);
  color: var(--accent-amber);
}
.account-settings .account-tabs svg {
  width: 17px;
  height: 17px;
  flex: none;
}
.settings-panel {
  padding: 24px;
}
.access-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}
.device-access {
  min-width: 0;
}
.device-access h2 {
  font-size: 1.125rem;
}
.device-access .panel-heading {
  flex-wrap: wrap;
}
.device-access .button-row {
  gap: 8px;
}
.device-access button {
  font-size: 0.8125rem;
}
.identity-details {
  border-top: 1px solid var(--border-default);
  margin-top: 24px;
  padding-top: 8px;
}
.identity-details summary {
  min-height: 44px;
  padding-block: 10px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
}
@media (max-width: 740px) {
  .settings-heading {
    gap: 4px;
    margin-bottom: 20px;
  }
  .settings-heading h1 {
    font-size: 1.75rem;
  }
  .settings-heading .lead {
    font-size: 0.875rem;
  }
  .access-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .settings-panel {
    padding: 20px;
  }
  .account-settings .account-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.account-heading h1 {
  font-size: clamp(2rem, 3vw, 2.5rem);
}
.account-heading .lead {
  font-size: 1rem;
  max-width: 65ch;
}
.account-access {
  display: grid;
  gap: 24px;
}
.account-choices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  max-width: 900px;
}
.account-choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  min-height: 140px;
  padding: 22px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  color: var(--text-primary);
  text-align: left;
  box-shadow: none;
}
.account-choice:hover {
  border-color: var(--border-warm);
  background: var(--surface-raised);
}
.account-choice > svg {
  width: 24px;
  height: 24px;
  color: var(--accent-amber);
}
.choice-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  font-weight: 700;
  font-size: 1rem;
}
.choice-title svg {
  width: 16px;
  height: 16px;
  color: var(--accent-amber);
}
.choice-description {
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1.5;
  color: var(--text-secondary);
}
.account-back {
  display: inline-flex;
  align-items: center;
  flex: none;
  margin-left: auto;
  gap: 8px;
}
.account-back svg {
  width: 18px;
  height: 18px;
}
@media (max-width: 640px) {
  .account-choices {
    grid-template-columns: 1fr;
  }
  .account-choice {
    min-height: 120px;
  }
}
.account-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  max-width: 680px;
  gap: 24px;
  align-items: start;
}
.account-entry > .panel {
  margin: 0;
  min-width: 0;
}
.account-entry p,
.account-flow p {
  font-size: 0.875rem;
}
.account-entry h2,
.account-flow h2 {
  font-size: 1.25rem;
}
.account-entry h3 {
  font-size: 1rem;
  margin-top: 20px;
}
.account-section-title {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 24px;
}
.account-section-title > svg {
  width: 24px;
  height: 24px;
  flex: none;
  color: var(--accent-amber);
}
.account-section-title h2 {
  margin: 0 0 8px;
}
.account-section-title p {
  color: var(--text-secondary);
  margin: 0;
}
.account-entry label,
.account-flow label {
  font-size: 0.875rem;
}
.account-entry button,
.account-flow button {
  min-height: 44px;
}
.account-entry form > button {
  margin-top: 16px;
}
.account-entry .field-actions button {
  padding-inline: 10px;
  font-size: 0.8125rem;
}
.account-entry .password-field {
  flex-wrap: wrap;
}
.account-entry .password-field input {
  min-width: min(100%, 10rem);
}
.account-entry .field-actions {
  margin-left: auto;
}
.account-password-help {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.account-password-help p {
  flex: 1;
}
.account-password-help button {
  flex: none;
  font-size: 0.875rem;
}
.local-vault {
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-default);
  margin-bottom: 24px;
}
.local-vault h3 {
  margin-bottom: 8px;
}
.managed-recovery {
  border-top: 1px solid var(--border-default);
  margin-top: 24px;
  padding-top: 12px;
}
.managed-recovery summary {
  min-height: 44px;
  font-size: 0.875rem;
}
.account-access-note {
  color: var(--text-muted);
  font-size: 0.875rem;
  margin: 0;
}
.account-entry .help-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.account-entry .help-link svg {
  width: 16px;
  height: 16px;
}
.account-flow {
  max-width: 42rem;
}
.account-flow form > button {
  margin-top: 16px;
}
.recovery-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-width: 20rem;
  margin-top: 20px;
}
@media (max-width: 440px) {
  .account-entry > .panel {
    padding: 20px;
  }
}
</style>
