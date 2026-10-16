<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  daoPaymentKey,
  type DaoRef,
  type UserMembership,
  type PrivateRecordPayload,
  type PrivateRecordReference,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { vaultUnlocked } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { readPrivateRecord } from '../content/private-records';
const props = defineProps<{
  dao: DaoRef;
  member: UserMembership | undefined;
  source: string;
  ballotId: string;
  reference: PrivateRecordReference;
  definitionHash: string;
}>();
const emit = defineEmits<{ read: [definitionHash: string | undefined] }>();
const route = useRoute(),
  workspace = useWorkspace();
const body = ref<Extract<PrivateRecordPayload, { kind: 'quick-question' }>['body']>(),
  busy = ref(false),
  error = ref('');
let generation = 0;
const context = computed(() =>
  JSON.stringify([
    resolveApiUrl('/'),
    props.dao,
    props.source,
    props.ballotId,
    props.reference,
    props.definitionHash,
    props.member?.memberId,
    props.member?.signingKey,
    props.member?.active,
    workspace.account?.id,
    workspace.account?.signingKey,
    workspace.account?.encryptionKey,
    workspace.daos.find((dao) => daoPaymentKey(dao.reference) === daoPaymentKey(props.dao))
      ?.keyEpoch,
    vaultUnlocked.value,
  ]),
);
function reset() {
  generation++;
  body.value = undefined;
  busy.value = false;
  error.value = '';
  emit('read', undefined);
}
watch(context, reset, { flush: 'sync' });
onBeforeUnmount(reset);
async function read() {
  const member = props.member,
    started = generation;
  if (!member?.active || !vaultUnlocked.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (props.reference.documentId !== props.ballotId) throw Error('QUICK_QUESTION_PARENT');
    const content = await api.content(props.dao.daoId);
    if (started !== generation) return;
    const payload = await readPrivateRecord(props.dao, member.memberId, props.reference, content, {
      kind: 'quick-question',
      source: props.source,
      recordId: props.ballotId,
    });
    if (started !== generation || !vaultUnlocked.value) return;
    if (payload.kind !== 'quick-question') throw Error('PRIVATE_RECORD_CONTEXT');
    body.value = payload.body;
    emit('read', props.definitionHash);
  } catch (cause) {
    if (started === generation) {
      body.value = undefined;
      emit('read', undefined);
      error.value = friendlyError(cause);
    }
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <div class="private-quick-question">
    <p class="notice">
      This question follows the originating DAO’s content grants. Individual vote keys remain with
      the executives fixed at opening.
    </p>
    <RouterLink
      v-if="member?.active && !vaultUnlocked"
      :to="{ path: '/account', query: { unlock: '1', returnTo: route.fullPath } }"
      >Unlock account to read question</RouterLink
    >
    <button
      v-else-if="member?.active"
      type="button"
      class="secondary"
      :disabled="busy"
      @click="read"
    >
      {{ busy ? 'Reading…' : 'Read private question' }}
    </button>
    <p v-else class="notice">
      Eligible DAO membership and content access are required to read this question.
    </p>
    <template v-if="body"
      ><h3>{{ body.question }}</h3>
      <p v-if="body.explanation" class="explanation">{{ body.explanation }}</p></template
    >
    <p v-if="error" role="alert">
      {{ error }} No new vote can be sent until the question is read and verified.
    </p>
  </div>
</template>
<style scoped>
.explanation {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
