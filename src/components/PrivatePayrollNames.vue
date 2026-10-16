<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  daoPaymentKey,
  PrivateRecordPayloadSchema,
  type DaoSummary,
  type UserMembership,
  type PrivateRecordReference,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { vaultUnlocked } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { newPrivateRecordId, readPrivateRecord } from '../content/private-records';
import { publishPrivateRecord } from '../content/publish-private-record';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  scheduleId: string;
  source: string;
  editable: boolean;
  save: (reference: PrivateRecordReference) => Promise<boolean>;
}>();
const emit = defineEmits<{ opened: [value: { agreed: string; display: string } | undefined] }>();
const route = useRoute(),
  workspace = useWorkspace();
const opened = ref<{ agreed: string; display: string }>(),
  label = ref(''),
  busy = ref(false),
  error = ref(''),
  readDone = ref(false);
let generation = 0;
let draft: { documentId: string; version: number } | undefined;
const context = computed(() =>
  JSON.stringify([
    props.dao.reference,
    props.dao.keyEpoch,
    props.dao.privacy,
    props.member?.memberId,
    props.member?.signingKey,
    props.member?.active,
    props.member?.admin,
    props.scheduleId,
    props.source,
    workspace.account?.id,
    workspace.account?.signingKey,
    workspace.account?.encryptionKey,
    vaultUnlocked.value,
  ]),
);
function reset() {
  generation++;
  opened.value = undefined;
  label.value = '';
  busy.value = false;
  error.value = '';
  draft = undefined;
  readDone.value = false;
  emit('opened', undefined);
}
watch(context, reset, { flush: 'sync' });
onBeforeUnmount(reset);
async function references() {
  const record = await api.privatePayroll(props.dao.reference, props.scheduleId);
  if (
    daoPaymentKey(record.dao) !== daoPaymentKey(props.dao.reference) ||
    record.source !== props.source ||
    record.scheduleId !== props.scheduleId
  )
    throw Error('DAO_REFERENCE');
  return record;
}
async function read() {
  const member = props.member,
    started = generation;
  if (!member?.active || !vaultUnlocked.value || busy.value) return;
  const memberId = member.memberId;
  busy.value = true;
  error.value = '';
  try {
    const record = await references(),
      content = await api.content(props.dao.reference.daoId);
    if (started !== generation) return;
    async function name(reference: PrivateRecordReference | null, purpose: 'agreed' | 'display') {
      if (!reference) return '';
      const payload = await readPrivateRecord(props.dao.reference, memberId, reference, content, {
        kind: 'payroll-label',
        source: props.source,
        recordId: props.scheduleId,
      });
      if (
        payload.kind !== 'payroll-label' ||
        (payload.body.purpose !== purpose &&
          !(
            purpose === 'display' &&
            JSON.stringify(reference) === JSON.stringify(record.agreed) &&
            payload.body.purpose === 'agreed'
          ))
      )
        throw Error('PRIVATE_RECORD_CONTEXT');
      return payload.body.label;
    }
    const agreed = await name(record.agreed, 'agreed'),
      display = await name(record.display, 'display');
    if (started !== generation || !vaultUnlocked.value) return;
    opened.value = { agreed, display };
    label.value = display;
    readDone.value = true;
    emit('opened', opened.value);
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
async function rename() {
  const member = props.member,
    started = generation;
  if (
    !member?.active ||
    !member.admin ||
    !vaultUnlocked.value ||
    !props.editable ||
    !readDone.value ||
    busy.value
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    const record = await references(),
      content = await api.content(props.dao.reference.daoId);
    if (started !== generation) return;
    const payload = PrivateRecordPayloadSchema.parse({
      schemaVersion: 1,
      kind: 'payroll-label',
      source: props.source,
      recordId: props.scheduleId,
      body: { purpose: 'display', label: label.value.trim() },
    });
    const documentId = draft?.documentId ?? record.display?.documentId ?? newPrivateRecordId();
    draft ??= {
      documentId,
      version:
        Math.max(
          0,
          ...content.documents
            .filter((row) => row.document_id === documentId)
            .map((row) => row.version),
        ) + 1,
    };
    const reference = await publishPrivateRecord(
      props.dao.reference,
      member.memberId,
      draft.documentId,
      draft.version,
      payload,
    );
    if (started !== generation || !vaultUnlocked.value) return;
    if (!(await props.save(reference))) return;
    if (started !== generation || !vaultUnlocked.value) return;
    draft = undefined;
    busy.value = false;
    await read();
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <div class="private-payroll-names">
    <RouterLink
      v-if="member?.active && !vaultUnlocked"
      :to="{ path: '/account', query: { unlock: '1', returnTo: route.fullPath } }"
      >Unlock account to read payroll names</RouterLink
    >
    <button
      v-else-if="member?.active"
      type="button"
      class="secondary"
      :disabled="busy"
      @click="read"
    >
      {{ busy ? 'Reading…' : 'Read private payroll names' }}
    </button>
    <p v-if="opened?.agreed">Agreed name: {{ opened.agreed }}</p>
    <p v-else-if="readDone">
      No encrypted agreed name. Any earlier public name remains in history.
    </p>
    <form
      v-if="readDone && member?.active && member.admin && editable"
      class="form-panel"
      @submit.prevent="rename"
    >
      <label :for="`private-payroll-${scheduleId}`">Private display name</label>
      <input
        :id="`private-payroll-${scheduleId}`"
        v-model="label"
        maxlength="80"
        required
        :disabled="busy"
      />
      <p class="field-help">
        Only the display name changes. Agreed terms and approved payments stay the same.
      </p>
      <button :disabled="busy || !label.trim()">Save private display name</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
