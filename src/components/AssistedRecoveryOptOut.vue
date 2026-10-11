<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { RecoveryKitSchema, type Account, type RecoveryMethods } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { createVaultBackup, recoverVault, unlockVault, type CreatedVault } from '../auth/vault';
import {
  downloadBackup,
  recoveryContextGuard,
  savedVault,
  saveVault,
  vaultUnlocked,
  withUnlockedVault,
} from '../auth/session';

const props = defineProps<{ account: Account; methods?: RecoveryMethods | undefined }>();
const emit = defineEmits<{ changed: [methods: RecoveryMethods]; kitSaved: [] }>();
const opened = ref(false),
  busy = ref(false),
  error = ref(''),
  password = ref(''),
  created = ref<CreatedVault>(),
  downloaded = ref(false),
  acknowledged = ref(false);
const active = computed(
  () =>
    props.methods?.assistedEnabled ??
    props.methods?.methods.some((method) => method.mode === 'daclify-assisted'),
);
const independent = computed(() =>
  props.methods?.methods.some(
    (method) =>
      method.mode !== null &&
      method.mode !== 'daclify-assisted' &&
      method.availableModes.includes(method.mode),
  ),
);
let revision = 0;
function clear() {
  revision++;
  opened.value = false;
  password.value = '';
  created.value = undefined;
  downloaded.value = false;
  acknowledged.value = false;
  error.value = '';
  busy.value = false;
}
watch(() => props.account.id, clear);
onUnmounted(clear);
function guard() {
  const started = revision,
    check = recoveryContextGuard(props.account);
  return () => {
    check();
    if (started !== revision) throw new Error('WALLET_CONTEXT_CHANGED');
  };
}
async function prepareKit() {
  if (busy.value || !opened.value) return;
  busy.value = true;
  error.value = '';
  const check = guard();
  try {
    const backup = await withUnlockedVault(props.account, async (keys) => {
      const record = await createVaultBackup(keys, password.value);
      check();
      const byPassword = await unlockVault(record.localEnvelope, password.value);
      check();
      const byCode = await recoverVault(record.recoveryEnvelope, record.recoveryCredential);
      check();
      if (
        JSON.stringify(byPassword) !== JSON.stringify(keys) ||
        JSON.stringify(byCode) !== JSON.stringify(keys)
      )
        throw new Error('RECOVERY_KEY_MISMATCH');
      return record;
    });
    check();
    created.value = backup;
    password.value = '';
    downloaded.value = false;
    acknowledged.value = false;
  } catch (cause) {
    if (opened.value)
      error.value =
        cause instanceof Error && cause.message === 'Use at least 12 characters'
          ? 'Use at least 12 characters for your backup password.'
          : friendlyError(cause);
  } finally {
    if (opened.value) busy.value = false;
  }
}
function download() {
  if (!created.value || busy.value) return;
  downloadBackup(kit(created.value));
  downloaded.value = true;
}
async function confirm() {
  if (busy.value || !opened.value || !active.value) return;
  const backup = created.value;
  if (!independent.value && (!backup || !downloaded.value || !acknowledged.value)) return;
  busy.value = true;
  error.value = '';
  const check = guard();
  try {
    const response = await api.optOutAssisted(backup ? { fallbackKit: kit(backup) } : {});
    check();
    const saved = savedVault();
    if (
      backup &&
      (!saved ||
        (saved.signingPublicKey === props.account.signingKey &&
          JSON.stringify(saved.encryptionPublicKey) ===
            JSON.stringify(props.account.encryptionKey)))
    ) {
      saveVault(backup);
      emit('kitSaved');
    }
    emit('changed', response);
    clear();
  } catch (cause) {
    if (opened.value) error.value = friendlyError(cause);
  } finally {
    if (opened.value) busy.value = false;
  }
}
function kit(backup: CreatedVault) {
  return RecoveryKitSchema.parse({
    version: 1,
    localEnvelope: backup.localEnvelope,
    recoveryEnvelope: backup.recoveryEnvelope,
    signingPublicKey: backup.signingPublicKey,
    encryptionPublicKey: backup.encryptionPublicKey,
  });
}
</script>
<template>
  <section
    v-if="methods"
    class="assisted-opt-out"
    aria-labelledby="assisted-recovery-heading"
    :aria-busy="busy"
  >
    <h2 id="assisted-recovery-heading">Daclify-assisted recovery</h2>
    <p v-if="active">
      Assisted recovery is enabled or awaiting setup for your signing and private-document keys.
      Turn it off to remove every assisted route, including paused backups and pending setup.
    </p>
    <p v-else role="status">Daclify-assisted recovery off</p>
    <p v-if="methods.assistedEver" class="field-help">
      Turning recovery off stops future assisted recovery through these methods. It cannot erase
      keys or documents already recovered. This account retains its assisted-recovery history for
      DAO admission.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <button v-if="active && !opened" class="secondary" @click="opened = true">
      Turn off Daclify-assisted recovery
    </button>
    <template v-if="active && opened">
      <p>
        Your Telegram and email pairings remain available for sign-in. Assisted recovery will be
        removed from every paired method.
      </p>
      <p v-if="independent">
        An independently protected method remains enrolled. Keep access to that method before
        continuing.
      </p>
      <template v-else>
        <p>
          Create and save an independent kit for these same keys before removing your last assisted
          recovery route.
        </p>
        <p v-if="!vaultUnlocked" class="notice">
          Unlock your keys using a full-access sign-in method or approve this device first.
        </p>
        <form v-if="!created" @submit.prevent="prepareKit">
          <label for="backup-vault-password">Backup vault password</label
          ><input
            id="backup-vault-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            required
            :disabled="busy"
          />
          <button :disabled="busy || !vaultUnlocked">
            {{ busy ? 'Verifying your kit…' : 'Create independent recovery kit' }}
          </button>
        </form>
        <template v-else>
          <label for="backup-recovery-code">Backup recovery code</label
          ><input
            id="backup-recovery-code"
            :value="created.recoveryCredential"
            readonly
            autocomplete="off"
          />
          <p class="field-help">
            Keep this code separately from the kit. The kit requires either your saved password or
            this code.
          </p>
          <button class="secondary" :disabled="busy" @click="download">
            Download independent recovery kit
          </button>
          <label class="checkbox"
            ><input v-model="acknowledged" type="checkbox" :disabled="busy || !downloaded" />I saved
            this kit and its password or recovery code.</label
          >
        </template>
      </template>
      <div class="button-row">
        <button
          :disabled="busy || (!independent && (!created || !downloaded || !acknowledged))"
          @click="confirm"
        >
          {{ busy ? 'Turning recovery off…' : 'Confirm assisted recovery off' }}
        </button>
        <button class="text-button" :disabled="busy" @click="clear">Keep assisted recovery</button>
      </div>
    </template>
  </section>
</template>
<style scoped>
.assisted-opt-out {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--border-default);
}
.assisted-opt-out h2 {
  font-size: 1.125rem;
}
.assisted-opt-out p,
.assisted-opt-out label {
  font-size: 0.875rem;
}
.assisted-opt-out form > button,
.assisted-opt-out .checkbox {
  margin-top: 16px;
}
</style>
