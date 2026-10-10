<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowUpRight, KeyRound, ShieldCheck, LifeBuoy } from '@lucide/vue';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError, type ServiceReceipt } from '../api/client';
import { formatReceiptAmount, hostedCheckoutUrl } from '../api/billing';
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
import { JoinIdentitySchema, type Account } from '@daclify/core-protocol';
import { accountDestination } from '../auth/destination';
import ProfilePanel from '../components/ProfilePanel.vue';
import SignInMethods from '../components/SignInMethods.vue';
import LinkedAccounts from '../components/LinkedAccounts.vue';
const props = defineProps<{
  embedded?: boolean;
  profileDaoId?: string | undefined;
  profileMemberId?: string | undefined;
}>();
const emit = defineEmits<{ 'profile-updated': [] }>();
const accountTabs = [
  { id: 'keys', label: 'Keys' },
  { id: 'sign-in', label: 'Sign-in' },
  { id: 'profile', label: 'Profile' },
  { id: 'linked', label: 'Linked' },
  { id: 'service', label: 'Service' },
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
watch(restoring, (active) => {
  void nextTick(() =>
    document
      .getElementById(active ? 'kit' : state.account ? 'account-tab-keys' : 'recover-account')
      ?.focus(),
  );
});
const joinIdentity = computed(() =>
  state.account && state.account.signingKey !== null
    ? JSON.stringify(
        JoinIdentitySchema.parse({
          version: 1,
          signingKey: state.account.signingKey,
          encryptionKey: state.account.encryptionKey,
          custody: state.account.custody,
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
  linked: false,
  service: true,
});
function openTab(next: AccountTab) {
  tab.value = next;
  opened.value = { ...opened.value, [next]: true };
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
  void nextTick(() => document.getElementById(`account-tab-${item.id}`)?.focus());
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
const receipts = ref<ServiceReceipt[]>([]);
const billingError = ref('');
const billingNote = computed(() => {
  if (route.query.billing === 'submitted') {
    return 'The card payment is recorded when Stripe notifies this service. Refresh the receipt if it is not listed yet.';
  }
  if (route.query.billing === 'cancelled') return 'The card payment was cancelled.';
  return '';
});
watch(
  () => state.account?.id,
  (id) => {
    receipts.value = [];
    if (id) void loadReceipts();
  },
  { immediate: true },
);
async function loadReceipts() {
  billingError.value = '';
  try {
    receipts.value = (await api.serviceReceipts()).receipts;
  } catch (cause) {
    receipts.value = [];
    if (!(cause instanceof Error) || cause.message !== 'STRIPE_NOT_CONFIGURED') {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return;
      billingError.value = friendlyError(cause);
    }
  }
}
async function pay() {
  busy.value = true;
  billingError.value = '';
  try {
    const checkout = await api.serviceCheckout();
    window.location.assign(hostedCheckoutUrl(checkout.url));
  } catch (cause) {
    billingError.value = friendlyError(cause);
    busy.value = false;
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
        : 'Sign in to Daclify',
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
  if (busy.value || providerBusy.value) return;
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
  if (!created.value || !acknowledged.value) return;
  saveVault(created.value);
  saved.value = savedVault();
  await unlock();
  created.value = undefined;
}
async function unlock() {
  if (providerBusy.value) return;
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
    : saved.value;
  if (record) downloadBackup(record);
}
</script>
<template>
  <div v-if="!embedded" class="page-heading account-heading">
    <div>
      <p class="eyebrow">IDENTITY &amp; RECOVERY</p>
      <h1>{{ heading }}</h1>
      <p class="lead">
        One Daclify identity for your communities. A blockchain account is optional.
      </p>
    </div>
    <RouterLink class="help-link" to="/docs/accounts">Account help ↗</RouterLink>
  </div>
  <p v-if="route.query.telegram === 'failed'" class="alert" role="alert">
    Telegram sign-in could not be completed. Try again from this browser. New Telegram identities
    must first be paired from an existing account.
  </p>
  <p v-if="route.query.notice === 'signin-removed'" class="notice" role="status">
    Sign-in method removed. Its sessions were revoked; sign in with a remaining method.
  </p>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <section v-if="restoring" class="panel narrow account-flow">
    <h2>Restore your existing keys</h2>
    <p>
      Choose your encrypted kit and enter its separate recovery credential. A new password protects
      this device.
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
      /><label for="recover-credential">Recovery credential</label
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
      ><button :disabled="busy || !kitText">
        {{ busy ? 'Restoring…' : 'Restore and sign in' }}</button
      ><button type="button" class="text-button" :disabled="busy" @click="restoring = false">
        Cancel recovery
      </button>
    </form>
  </section>
  <section v-else-if="created" class="panel narrow account-flow">
    <h2>Keep access on a new device</h2>
    <p>
      Your password unlocks this device. Your encrypted recovery kit and separate credential restore
      your keys on another device.
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
      Store this credential away from the downloaded kit. Daclify cannot recover user-controlled
      keys without both.
    </p>
    <label class="checkbox"
      ><input v-model="acknowledged" type="checkbox" />I have saved my recovery kit and
      credential</label
    ><button :disabled="!acknowledged || busy" @click="finish">
      {{ busy ? 'Finishing…' : 'Finish account setup' }}
    </button>
  </section>
  <template v-else-if="state.account">
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
        {{ item.label }}
      </button>
    </div>
    <section
      v-show="tab === 'keys'"
      id="account-panel-keys"
      class="panel narrow"
      role="tabpanel"
      aria-labelledby="account-tab-keys"
    >
      <div class="panel-heading">
        <h2>
          {{
            state.account.signingKey === null
              ? 'Blockchain wallet access'
              : state.account.custody === 'user-controlled'
                ? 'User-controlled account'
                : 'Managed account'
          }}
        </h2>
        <span class="pill">{{
          state.account.signingKey === null ? 'Wallet only' : state.account.custody
        }}</span>
      </div>
      <p class="muted">Server login id</p>
      <p class="mono wrap">{{ state.account.id }}</p>
      <p class="field-help">
        This service ID connects your paired sign-in methods. DAO membership and permissions are
        verified separately.
      </p>
      <p v-if="state.account.signingKey === null" class="notice" role="status">
        Your wallet restores access to its current on-chain memberships and permissions. Your
        original document-decryption keys and lost social-login pairings have not been restored. To
        recover private content, import your original encrypted kit and confirm with your wallet.
      </p>
      <template v-else
        ><p class="muted">Signing public key</p>
        <p class="mono wrap">{{ state.account.signingKey }}</p></template
      >
      <details v-if="state.account.signingKey !== null">
        <summary>Public join identity</summary>
        <p>
          Share this JSON with the DAO administrator to request admission. It contains public
          signing and encryption keys only. Keep your recovery kit private.
        </p>
        <label for="public-join-identity">Public join identity JSON</label>
        <textarea id="public-join-identity" readonly rows="7" :value="joinIdentity"></textarea>
        <button class="secondary" @click="copyJoinIdentity">Copy public join identity</button>
        <p v-if="joinCopied" role="status">Public join identity copied.</p>
      </details>
      <RouterLink v-if="destination" class="button secondary" :to="destination"
        >Return to your DAO or setup</RouterLink
      >
      <form v-if="!vaultUnlocked && saved" @submit.prevent="unlock">
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
        ><button class="secondary" @click="backup">Download encrypted backup</button>
      </div>
      <p v-if="!vaultUnlocked && !saved" class="muted">
        This sign-in opened the server session. Restore the recovery kit on this device to unlock
        your keys.
      </p>
      <button
        v-if="!vaultUnlocked && !saved"
        type="button"
        class="secondary"
        @click="restoring = true"
      >
        Recover from an encrypted kit
      </button>
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
      <button class="text-button danger" :disabled="busy" @click="logout">Sign out</button>
      <p class="muted">
        Keys lock after ten minutes without a signing action. Signing keys are separate from
        document encryption keys.
      </p>
    </section>
    <div
      v-if="opened['sign-in']"
      v-show="tab === 'sign-in'"
      id="account-panel-sign-in"
      role="tabpanel"
      aria-labelledby="account-tab-sign-in"
    >
      <SignInMethods mode="manage" />
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
    <div
      v-if="opened.linked"
      v-show="tab === 'linked'"
      id="account-panel-linked"
      role="tabpanel"
      aria-labelledby="account-tab-linked"
    >
      <LinkedAccounts />
    </div>
    <section
      v-show="tab === 'service'"
      id="account-panel-service"
      class="panel narrow"
      role="tabpanel"
      aria-labelledby="account-tab-service"
    >
      <h2>Service payment</h2>
      <p>
        Card checkout uses the Stripe price configured for this service. A card payment does not
        change votes, permissions, withdrawals, or a DAO treasury.
      </p>
      <p v-if="billingNote">{{ billingNote }}</p>
      <p v-if="billingError" class="alert" role="alert">{{ billingError }}</p>
      <ul v-if="receipts.length" class="receipt-list">
        <li v-for="(receipt, index) in receipts" :key="index">
          {{ receipt.status }} · {{ formatReceiptAmount(receipt.currency, receipt.amountMinor) }}
        </li>
      </ul>
      <div class="button-row">
        <button type="button" :disabled="busy" @click="pay">Continue to card payment</button
        ><button type="button" class="secondary" :disabled="busy" @click="loadReceipts">
          Refresh receipt
        </button>
      </div>
    </section>
  </template>
  <div v-else class="account-access">
    <nav class="account-shortcuts" aria-label="Account options">
      <a v-if="!saved" href="#new-account">Create an account <ArrowUpRight aria-hidden="true" /></a>
      <a href="#recover-account">Recovery options <ArrowUpRight aria-hidden="true" /></a>
    </nav>
    <div class="account-entry">
      <section class="panel account-returning" aria-labelledby="returning-title" :inert="busy">
        <div class="account-section-title">
          <KeyRound aria-hidden="true" />
          <div>
            <h2 id="returning-title">Welcome back</h2>
            <p>Sign in to continue to your communities.</p>
          </div>
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
        <SignInMethods mode="enter" @authenticated="onSignedIn" @busy="providerBusy = $event" />
      </section>
      <section
        v-if="!saved"
        id="new-account"
        class="panel account-new"
        aria-labelledby="new-title"
        tabindex="-1"
      >
        <div class="account-section-title">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2 id="new-title">New to Daclify?</h2>
            <p>Create your identity, then join or start a DAO.</p>
          </div>
        </div>
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
        <details class="managed-recovery">
          <summary>Managed recovery option</summary>
          <span class="pill">Managed recovery</span>
          <h3>Recovery through a service</h3>
          <p>
            An operator can recover managed signing and decryption access. This is a different trust
            model and is excluded from DAOs that require user-controlled keys.
          </p>
          <p class="notice">Provider setup is required before managed accounts can be offered.</p>
          <button disabled>Managed signup unavailable</button
          ><RouterLink class="help-link" to="/docs/accounts"
            >Compare account modes <ArrowUpRight aria-hidden="true"
          /></RouterLink>
        </details>
      </section>
      <aside v-else class="panel account-key-guide" aria-labelledby="key-guide-title">
        <ShieldCheck aria-hidden="true" />
        <h2 id="key-guide-title">Your keys stay with you</h2>
        <p>
          Signing in with email, Telegram or a passkey opens your account without unlocking this
          device’s vault.
        </p>
        <p>
          A linked blockchain wallet can authorize supported DAO actions. Encrypted documents still
          need your granted decryption keys.
        </p>
        <p>
          Keep your recovery kit and its separate credential. They restore your original keys on a
          new device.
        </p>
        <RouterLink class="help-link" to="/docs/accounts"
          >Account and key guide <ArrowUpRight aria-hidden="true"
        /></RouterLink>
      </aside>
    </div>
    <aside class="account-recovery" aria-labelledby="recovery-choice-title">
      <LifeBuoy aria-hidden="true" />
      <div>
        <h2 id="recovery-choice-title">Moving devices or restoring access?</h2>
        <p>
          Use your encrypted recovery kit and its separate credential to restore your existing keys.
        </p>
      </div>
      <button
        id="recover-account"
        class="secondary"
        :disabled="busy || providerBusy"
        @click="restoring = true"
      >
        Recover from an encrypted kit
      </button>
    </aside>
    <p class="account-access-note">
      An account gets you into Daclify. Each DAO controls membership, voting rights and permissions
      separately. <RouterLink to="/docs/accounts">How access works</RouterLink>
    </p>
  </div>
</template>
<style scoped>
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
.account-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}
.account-shortcuts a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  font-size: 0.875rem;
}
.account-shortcuts svg {
  width: 16px;
  height: 16px;
}
#new-account,
#recover-account {
  scroll-margin-top: 24px;
}
.account-entry {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
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
.account-section-title > svg,
.account-key-guide > svg {
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
.account-recovery {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  padding: 20px;
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
}
.account-recovery > svg {
  width: 24px;
  height: 24px;
  color: var(--accent-amber);
  flex: none;
}
.account-recovery > div {
  flex: 1;
  min-width: min(100%, 18rem);
}
.account-recovery h2 {
  font-size: 1rem;
  margin: 0 0 6px;
}
.account-recovery p {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
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
@media (max-width: 440px) {
  .account-entry > .panel {
    padding: 20px;
  }
  .account-recovery > button {
    width: 100%;
  }
}
</style>
