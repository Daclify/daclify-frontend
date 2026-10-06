<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError, type ServiceReceipt } from '../api/client';
import { formatReceiptAmount, hostedCheckoutUrl } from '../api/billing';
import { createVault, restoreRecoveryKit, type CreatedVault } from '../auth/vault';
import {
  savedVault,
  saveVault,
  saveRestoredVault,
  unlockAndLogin,
  lockVault,
  downloadBackup,
  vaultUnlocked,
} from '../auth/session';
const restoring = ref(false);
const kitText = ref('');
const recoveryCredential = ref('');
const replacementAcknowledged = ref(false);
const route = useRoute();
const state = useWorkspace();
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
const created = ref<CreatedVault>();
const acknowledged = ref(false);
const busy = ref(false);
const error = ref('');
const heading = computed(() =>
  restoring.value
    ? 'Recover your account'
    : created.value
      ? 'Save your recovery kit'
      : state.account
        ? 'Your account'
        : saved.value
          ? 'Unlock your account'
          : 'Choose how you control your account',
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
async function create() {
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
async function finish() {
  if (!created.value || !acknowledged.value) return;
  saveVault(created.value);
  saved.value = savedVault();
  await unlock();
  created.value = undefined;
}
async function unlock() {
  busy.value = true;
  error.value = '';
  try {
    state.account = await unlockAndLogin(password.value);
    password.value = '';
    await state.refresh();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
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
  <div class="page-heading">
    <div>
      <p class="eyebrow">IDENTITY &amp; RECOVERY</p>
      <h1>{{ heading }}</h1>
      <p class="lead">An internal account works without creating an account on the blockchain.</p>
    </div>
    <RouterLink class="help-link" to="/docs/accounts">Account help ↗</RouterLink>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <section v-if="restoring" class="panel narrow">
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
        @change="selectKit"
      /><label for="recover-credential">Recovery credential</label
      ><input
        id="recover-credential"
        v-model="recoveryCredential"
        type="password"
        autocomplete="off"
        required
      /><label for="recover-password">New vault password</label
      ><input
        id="recover-password"
        v-model="password"
        type="password"
        autocomplete="new-password"
        minlength="12"
        required
      /><label v-if="saved" class="checkbox"
        ><input v-model="replacementAcknowledged" type="checkbox" required />I have backed up the
        account currently on this device</label
      ><button :disabled="busy || !kitText">
        {{ busy ? 'Restoring…' : 'Restore and sign in' }}</button
      ><button type="button" class="text-button" @click="restoring = false">Cancel recovery</button>
    </form>
  </section>
  <section v-else-if="created" class="panel narrow">
    <h2>Keep access on a new device</h2>
    <p>
      Your password unlocks this device. Your encrypted recovery kit and separate credential restore
      your keys on another device.
    </p>
    <button class="secondary" @click="backup">Download encrypted recovery kit</button
    ><label for="recovery">Recovery credential — save separately</label
    ><textarea
      id="recovery"
      readonly
      :value="created.recoveryCredential"
      rows="2"
      spellcheck="false"
    ></textarea>
    <p class="muted">
      Daclify cannot recover user-controlled keys without this credential and your kit.
    </p>
    <label class="checkbox"
      ><input v-model="acknowledged" type="checkbox" />I have saved my recovery kit and
      credential</label
    ><button :disabled="!acknowledged || busy" @click="finish">
      {{ busy ? 'Finishing…' : 'Finish account setup' }}
    </button>
  </section>
  <template v-else-if="state.account"
    ><section class="panel narrow">
      <div class="panel-heading">
        <h2>
          {{
            state.account.custody === 'user-controlled'
              ? 'User-controlled account'
              : 'Managed account'
          }}
        </h2>
        <span class="pill">{{ state.account.custody }}</span>
      </div>
      <p class="muted">Account ID</p>
      <p class="mono wrap">{{ state.account.id }}</p>
      <p class="muted">Signing public key</p>
      <p class="mono wrap">{{ state.account.signingKey }}</p>
      <form v-if="!vaultUnlocked" @submit.prevent="unlock">
        <label for="unlock">Vault password</label
        ><input
          id="unlock"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        /><button :disabled="busy">Unlock and sign in</button>
      </form>
      <div v-else class="button-row">
        <button class="secondary" @click="lockVault">Lock vault</button
        ><button class="secondary" @click="backup">Download encrypted backup</button>
      </div>
      <button class="text-button danger" :disabled="busy" @click="logout">Sign out</button>
      <p class="muted">
        Keys lock after ten minutes without a signing action. Signing keys are separate from
        document encryption keys.
      </p>
    </section>
    <section class="panel narrow">
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
    </section></template
  >
  <section v-else-if="saved" class="panel narrow">
    <h2>Use your vault password</h2>
    <p>Unlock your local encrypted vault to prove ownership of your account.</p>
    <form @submit.prevent="unlock">
      <label for="unlock">Vault password</label
      ><input
        id="unlock"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
      /><button :disabled="busy">{{ busy ? 'Unlocking…' : 'Unlock and sign in' }}</button>
    </form>
    <RouterLink class="help-link" to="/docs/recovery">Recover on a new device ↗</RouterLink>
  </section>
  <div v-else class="two-column">
    <section class="panel">
      <span class="pill success">User-controlled</span>
      <h2>You hold the keys</h2>
      <p>
        Your signing and decryption keys are encrypted in your browser. Keep a recovery kit: losing
        it and your password means losing access.
      </p>
      <form @submit.prevent="create">
        <label for="password">Vault password</label
        ><input
          id="password"
          v-model="password"
          type="password"
          minlength="12"
          autocomplete="new-password"
          required
        />
        <p class="field-help">At least 12 characters. Use a unique passphrase.</p>
        <button :disabled="busy">
          {{ busy ? 'Encrypting vault…' : 'Create encrypted vault' }}
        </button>
      </form>
    </section>
    <section class="panel">
      <span class="pill">Managed recovery</span>
      <h2>Recovery through a service</h2>
      <p>
        An operator can recover managed signing and decryption access. This is a different trust
        model and is excluded from DAOs that require user-controlled keys.
      </p>
      <p class="notice">Provider setup is required before managed accounts can be offered.</p>
      <button disabled>Managed signup unavailable</button
      ><RouterLink class="help-link" to="/docs/accounts">Compare account modes ↗</RouterLink>
    </section>
  </div>
  <button
    v-if="!state.account && !created && !restoring"
    class="text-button"
    @click="restoring = true"
  >
    Recover from an encrypted kit
  </button>
  <aside class="info-strip">
    <div>
      <strong>Social &amp; Telegram login</strong>
      <p>
        Google and Telegram require provider configuration. Social login identifies an account; it
        does not decrypt a user-controlled vault.
      </p>
    </div>
    <RouterLink to="/docs/providers">Setup guide</RouterLink>
  </aside>
</template>
