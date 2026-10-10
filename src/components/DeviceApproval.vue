<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { z } from 'zod';
import QRCode from 'qrcode';
import type { Account, DeviceRecoveryRequest, EncryptionPrivateKey } from '@daclify/core-protocol';
import {
  createRecoveryRecipient,
  recoveryDeviceFingerprint,
  sealDeviceRecovery,
  openDeviceRecovery,
} from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import {
  vaultUnlocked,
  withUnlockedVault,
  recoveryContextGuard,
  installRecoveredVault,
} from '../auth/session';
const props = defineProps<{ account: Account; approveId?: string | undefined }>();
const request = ref<DeviceRecoveryRequest>(),
  approval = ref<DeviceRecoveryRequest>(),
  input = ref(props.approveId ?? ''),
  qr = ref(''),
  confirmed = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
let privateKey: EncryptionPrivateKey | undefined,
  pollToken: string | undefined,
  receivingCheck: (() => void) | undefined,
  revision = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
const link = computed(() =>
  request.value ? window.location.origin + '/account?deviceApproval=' + request.value.id : '',
);
const display = (value: string) => value.match(/.{1,8}/g)?.join(' ') ?? value;
function reset() {
  revision++;
  privateKey = undefined;
  pollToken = undefined;
  receivingCheck = undefined;
  request.value = undefined;
  approval.value = undefined;
  confirmed.value = false;
  qr.value = '';
  if (timer) clearTimeout(timer);
  timer = undefined;
}
onUnmounted(reset);
watch(() => props.account.id, reset);
async function begin() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  reset();
  const current = revision,
    check = recoveryContextGuard(props.account);
  try {
    const receiver = await createRecoveryRecipient();
    check();
    const response = await api.beginDeviceRecovery({ recipient: receiver.publicKey });
    check();
    if (
      current !== revision ||
      response.request.accountId !== props.account.id ||
      response.request.origin !== window.location.origin ||
      response.request.fingerprint !== (await recoveryDeviceFingerprint(receiver.publicKey)) ||
      JSON.stringify(response.request.recipient) !== JSON.stringify(receiver.publicKey)
    )
      throw new Error('RECOVERY_DEVICE_MISMATCH');
    privateKey = receiver.privateKey;
    pollToken = response.pollToken;
    receivingCheck = check;
    request.value = response.request;
    qr.value = await QRCode.toDataURL(link.value, {
      errorCorrectionLevel: 'M',
      width: 240,
      margin: 4,
    });
    check();
    timer = setTimeout(() => void poll(), 5000);
  } catch (cause) {
    if (current === revision) {
      reset();
      error.value = friendlyError(cause);
    }
  } finally {
    busy.value = false;
  }
}
async function poll() {
  const incoming = request.value,
    secret = pollToken,
    key = privateKey,
    current = revision;
  const check = receivingCheck;
  if (!incoming || !secret || !key || !check) return;
  try {
    check();
    if (Date.parse(incoming.expires) <= Date.now()) throw new Error('RECOVERY_DEVICE_EXPIRED');
    const response = await api.pollDeviceRecovery({ id: incoming.id, pollToken: secret });
    check();
    if (current !== revision) return;
    if (JSON.stringify(response.request) !== JSON.stringify(incoming))
      throw new Error('RECOVERY_DEVICE_MISMATCH');
    if (!response.payload) {
      timer = setTimeout(() => void poll(), 5000);
      return;
    }
    const secrets = await openDeviceRecovery(response.payload, key, incoming);
    check();
    if (current !== revision) return;
    await installRecoveredVault(props.account, secrets, incoming, check);
    reset();
    notice.value = 'This device now has your original signing and private-document keys.';
  } catch (cause) {
    if (current === revision) {
      reset();
      error.value = friendlyError(cause);
    }
  }
}
async function cancel() {
  const incoming = request.value,
    secret = pollToken,
    check = receivingCheck;
  reset();
  if (incoming && secret && check)
    try {
      check();
      await api.cancelDeviceRecovery({ id: incoming.id, pollToken: secret });
    } catch {}
}
function requestId(value: string): string {
  const text = value.trim();
  if (z.uuid().safeParse(text).success) return text;
  const url = new URL(text);
  if (url.origin !== window.location.origin || url.pathname !== '/account')
    throw new Error('RECOVERY_DEVICE_MISMATCH');
  return z.uuid().parse(url.searchParams.get('deviceApproval'));
}
async function loadApproval() {
  const current = revision,
    check = recoveryContextGuard(props.account);
  error.value = '';
  confirmed.value = false;
  try {
    const response = await api.deviceRecoveryRequest(requestId(input.value));
    check();
    if (
      current === revision &&
      response.accountId === props.account.id &&
      response.origin === window.location.origin
    )
      approval.value = response;
    else throw new Error('RECOVERY_DEVICE_MISMATCH');
  } catch (cause) {
    if (current === revision) error.value = friendlyError(cause);
  }
}
onMounted(() => {
  if (props.approveId) void loadApproval();
});
watch(
  () => props.approveId,
  (value) => {
    input.value = value ?? '';
    if (value) void loadApproval();
  },
);
async function approve() {
  const selected = approval.value;
  if (!selected || !confirmed.value || busy.value) return;
  busy.value = true;
  error.value = '';
  const current = revision;
  try {
    await withUnlockedVault(props.account, async (keys) => {
      if (Date.parse(selected.expires) <= Date.now()) throw new Error('RECOVERY_DEVICE_EXPIRED');
      const payload = await sealDeviceRecovery(keys, selected);
      return api.approveDeviceRecovery({
        id: selected.id,
        fingerprint: selected.fingerprint,
        payload,
      });
    });
    if (current === revision) {
      approval.value = undefined;
      confirmed.value = false;
      notice.value = 'Device approved. Its keys can be received once before the request expires.';
    }
  } catch (cause) {
    if (current === revision) error.value = friendlyError(cause);
  } finally {
    if (current === revision) busy.value = false;
  }
}
</script>
<template>
  <section class="device-approval" aria-labelledby="device-approval-heading">
    <h3 id="device-approval-heading">Use another device</h3>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="!vaultUnlocked">
      <p>
        An unlocked device can send your original keys directly to this device. No vault password or
        JSON file is needed here.
      </p>
      <button
        v-if="!request"
        type="button"
        class="secondary"
        :disabled="busy || account.signingKey === null"
        @click="begin"
      >
        Request approval from another device
      </button>
      <div v-if="request">
        <img
          v-if="qr"
          :src="qr"
          width="240"
          height="240"
          alt="QR code for the device approval link"
        />
        <label for="device-approval-link">Approval link</label
        ><input id="device-approval-link" :value="link" readonly />
        <p>
          Open this link on your unlocked device, or paste it into that device’s approval form.
          Check that both devices show the same verification code.
        </p>
        <output class="mono wrap" aria-label="Device verification code">{{
          display(request.fingerprint)
        }}</output>
        <p>This request expires in five minutes. Keep this page open.</p>
        <button type="button" class="secondary" @click="cancel">Cancel device request</button>
      </div>
    </template>
    <form v-if="vaultUnlocked" @submit.prevent="loadApproval">
      <label for="approve-device-request">Approval link or request ID</label
      ><input id="approve-device-request" v-model="input" required autocomplete="off" />
      <button type="submit" class="secondary" :disabled="busy">Review device request</button>
    </form>
    <div v-if="approval">
      <p>Check this code against the requesting device before sharing your keys.</p>
      <output class="mono wrap" aria-label="Approval verification code">{{
        display(approval.fingerprint)
      }}</output>
      <label class="check-row"
        ><input v-model="confirmed" type="checkbox" />The verification codes match and I recognize
        this device.</label
      >
      <button type="button" :disabled="busy || !confirmed || !vaultUnlocked" @click="approve">
        Approve this device
      </button>
      <p v-if="!vaultUnlocked">Unlock your existing keys on this device first.</p>
    </div>
  </section>
</template>
<style scoped>
.device-approval {
  border-top: 1px solid var(--line);
  margin-top: 1.5rem;
  padding-top: 1rem;
}
.device-approval img {
  max-width: 100%;
  height: auto;
}
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  margin-block: 1rem;
}
.check-row input {
  width: auto;
  flex-shrink: 0;
}
</style>
