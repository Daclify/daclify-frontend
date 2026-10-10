<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import type {
  Account,
  RecoveryMethods,
  RecoveryMethod,
  RecoveryContext,
} from '@daclify/core-protocol';
import { RecoveryModeSchema } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { vaultUnlocked } from '../auth/session';
import { enableFastSignIn } from '../auth/fast-sign-in';
const props = defineProps<{ account: Account }>();
const emit = defineEmits<{ changed: [methods: RecoveryMethods]; unlockNeeded: [] }>();
const methods = ref<RecoveryMethods>(),
  error = ref(''),
  busy = ref('');
const selected = ref<Record<string, RecoveryContext['mode']>>({}),
  consent = ref<Record<string, boolean>>({}),
  fallback = ref<Record<string, boolean>>({});
let revision = 0;
onUnmounted(() => {
  revision++;
});
function mode(method: RecoveryMethod): RecoveryContext['mode'] | undefined {
  return selected.value[method.credentialKey] ?? method.availableModes[0];
}
function selectMode(method: RecoveryMethod, event: Event): void {
  if (!(event.target instanceof HTMLSelectElement)) return;
  selected.value[method.credentialKey] = RecoveryModeSchema.parse(event.target.value);
  consent.value[method.credentialKey] = false;
}
function label(value: RecoveryContext['mode']): string {
  return {
    'wallet-protected': 'Private wallet unlock',
    'passkey-protected': 'Private passkey unlock',
    'daclify-assisted': 'Daclify-assisted unlock',
  }[value];
}
function description(value: RecoveryContext['mode']): string {
  if (value === 'wallet-protected')
    return 'Your wallet unlocks the encrypted copy on this device. Keep its keys safe. Wallet key changes can require setting up full access again.';
  if (value === 'passkey-protected')
    return 'A compatible passkey unlocks the encrypted copy on this device. Device and password-manager support can differ.';
  return 'Daclify keeps a spare unlocking key. Access depends on the paired account and Daclify’s recovery service. Daclify can recover your signing and private-document keys.';
}
async function load() {
  const current = ++revision,
    id = props.account.id;
  try {
    const response = await api.recoveryMethods();
    if (current === revision && id === props.account.id) {
      methods.value = response;
      emit('changed', response);
    }
  } catch (cause) {
    if (current === revision) error.value = friendlyError(cause);
  }
}
onMounted(load);
watch(
  () => props.account.id,
  () => {
    methods.value = undefined;
    selected.value = {};
    consent.value = {};
    fallback.value = {};
    void load();
  },
);
async function change(method: RecoveryMethod, disable: boolean) {
  if (busy.value) return;
  const current = revision,
    id = props.account.id;
  busy.value = method.credentialKey;
  error.value = '';
  try {
    const chosen = mode(method);
    if (!disable && !chosen) throw new Error('RECOVERY_METHOD_UNAVAILABLE');
    const response = disable
      ? await api.disableRecovery({
          credentialKey: method.credentialKey,
          keepKitFallback: fallback.value[method.credentialKey] ?? false,
        })
      : await enableFastSignIn(
          props.account,
          method,
          chosen ?? 'daclify-assisted',
          consent.value[method.credentialKey] ?? false,
        );
    if (current === revision && id === props.account.id) {
      methods.value = response;
      emit('changed', response);
    }
  } catch (cause) {
    if (current === revision && id === props.account.id) error.value = friendlyError(cause);
  } finally {
    if (current === revision) busy.value = '';
  }
}
</script>
<template>
  <section class="panel narrow" aria-labelledby="fast-sign-in-heading">
    <h2 id="fast-sign-in-heading">Fast sign-in with full access</h2>
    <p>
      Choose which paired methods unlock your signing keys and private documents on new devices.
      Other paired methods still let you sign in.
    </p>
    <p v-if="methods?.assistedEver" class="notice" role="status">
      This vault authorized Daclify-assisted recovery; Daclify may hold a spare unlocking key.
      Disabling assisted methods stops future recovery through them; it cannot undo access that was
      already possible.
    </p>
    <p v-if="methods && !methods.configured" class="field-help">
      Fast sign-in backups are not available on this service yet.
    </p>
    <p v-if="methods?.methods.length === 0" class="field-help">
      Pair a sign-in method below to set up full access.
    </p>
    <div v-if="methods?.configured && !vaultUnlocked" class="notice">
      <p>
        Unlock your existing keys on this device once to set up full access. Then use your selected
        methods on new devices without a vault password or recovery kit.
      </p>
      <button class="secondary" type="button" @click="emit('unlockNeeded')">
        Open key options
      </button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <article
      v-for="(method, index) in methods?.methods ?? []"
      :key="method.credentialKey"
      class="recovery-method"
    >
      <h3>
        {{
          method.kind === 'native'
            ? 'Telos Zero'
            : method.kind === 'evm'
              ? 'Telos EVM'
              : method.kind === 'passkey'
                ? 'Passkey'
                : method.kind
        }}
        · {{ method.subject }}
      </h3>
      <p>
        <strong>{{ method.mode ? 'Full access enabled' : 'Sign-in only' }}</strong
        ><span v-if="method.mode"> · {{ label(method.mode) }}</span>
      </p>
      <template v-if="method.availableModes.length">
        <label :for="`fast-mode-${index}`">Full-access protection</label>
        <select
          :id="`fast-mode-${index}`"
          :value="mode(method)"
          :disabled="!!busy"
          @change="selectMode(method, $event)"
        >
          <option v-for="option in method.availableModes" :key="option" :value="option">
            {{ label(option) }}
          </option>
        </select>
        <p class="field-help">{{ description(mode(method) ?? 'daclify-assisted') }}</p>
        <label v-if="mode(method) === 'daclify-assisted'" class="check-row"
          ><input v-model="consent[method.credentialKey]" type="checkbox" :disabled="!!busy" />I
          allow Daclify to hold a spare unlocking key and recover my signing and private-document
          keys through this paired method.</label
        >
        <button
          type="button"
          :disabled="
            !!busy ||
            !vaultUnlocked ||
            (mode(method) === 'daclify-assisted' && !consent[method.credentialKey])
          "
          @click="change(method, false)"
        >
          {{
            busy === method.credentialKey
              ? 'Saving…'
              : method.mode
                ? 'Set up full access again'
                : 'Enable full access'
          }}
        </button>
      </template>
      <p v-else class="field-help">Full access through this method is not available yet.</p>
      <template v-if="method.mode">
        <label class="check-row"
          ><input v-model="fallback[method.credentialKey]" type="checkbox" :disabled="!!busy" />I
          have saved an encrypted recovery kit and its password or recovery code.</label
        >
        <button type="button" class="secondary" :disabled="!!busy" @click="change(method, true)">
          Use for sign-in only
        </button>
      </template>
    </article>
  </section>
</template>
<style scoped>
.recovery-method {
  border-top: 1px solid var(--line);
  padding-block: 1rem;
  overflow-wrap: anywhere;
}
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  margin-block: 1rem;
}
.check-row input {
  width: auto;
  flex-shrink: 0;
  margin-top: 0.2rem;
}
</style>
