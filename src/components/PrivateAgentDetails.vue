<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  daoPaymentKey,
  type DaoSummary,
  type UserMembership,
  type PrivateRecordPayload,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { vaultUnlocked } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { readPrivateRecord } from '../content/private-records';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  subject: string;
}>();
const workspace = useWorkspace(),
  route = useRoute();
const body = ref<Extract<PrivateRecordPayload, { kind: 'agent-description' }>['body']>();
const busy = ref(false),
  error = ref(''),
  message = ref('');
let generation = 0;
const context = computed(() =>
  JSON.stringify([
    props.dao.reference,
    props.dao.keyEpoch,
    props.member?.memberId,
    props.member?.active,
    props.member?.signingKey,
    props.subject,
    workspace.account?.id,
    workspace.network?.chainId,
    workspace.network?.runtime,
    vaultUnlocked.value,
  ]),
);
watch(
  context,
  () => {
    generation++;
    body.value = undefined;
    busy.value = false;
    error.value = '';
    message.value = '';
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  generation++;
  body.value = undefined;
});
async function read() {
  const member = props.member,
    started = generation;
  if (!member?.active || !vaultUnlocked.value || busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const record = await api.privateAgent(props.dao.reference, props.subject);
    if (started !== generation) return;
    if (daoPaymentKey(record.dao) !== daoPaymentKey(props.dao.reference))
      throw Error('DAO_REFERENCE');
    if (!record.reference) {
      message.value = 'No private operating details recorded.';
      return;
    }
    const content = await api.content(props.dao.reference.daoId);
    if (started !== generation) return;
    const payload = await readPrivateRecord(
      props.dao.reference,
      member.memberId,
      record.reference,
      content,
      { kind: 'agent-description', source: props.dao.reference.contract, recordId: props.subject },
    );
    if (started !== generation) return;
    if (payload.kind !== 'agent-description') throw Error('PRIVATE_RECORD_CONTEXT');
    body.value = payload.body;
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <div class="private-agent-details">
    <RouterLink
      v-if="member?.active && !vaultUnlocked"
      :to="{ path: '/account', query: { unlock: '1', returnTo: route.fullPath } }"
      >Unlock account to read operating details</RouterLink
    >
    <button
      v-else-if="member?.active"
      type="button"
      class="secondary"
      :disabled="busy"
      @click="read"
    >
      {{ busy ? 'Reading…' : 'Read private operating details' }}
    </button>
    <template v-if="body"
      ><p>
        <strong>{{ body.operatorLabel }}</strong>
      </p>
      <p v-if="body.description">{{ body.description }}</p></template
    >
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.private-agent-details {
  margin-top: 8px;
  overflow-wrap: anywhere;
}
</style>
