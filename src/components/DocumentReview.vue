<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import {
  daoPaymentKey,
  type DaoRef,
  type DaoContent,
  type UserMembership,
} from '@daclify/core-protocol';
import { useWorkspace } from '../state/workspace';
import { vaultUnlocked } from '../auth/session';
import { friendlyError } from '../api/client';
import { readDocumentForReview, type ReviewedDocument } from '../content/document-review';
import { formatHelpAnswer } from '../help/format';
import { downloadFile } from '../content/files';
const props = defineProps<{
  dao: DaoRef;
  member: UserMembership | undefined;
  content: DaoContent | undefined;
  documentId: string;
  version: number;
  commitment: string;
}>();
const emit = defineEmits<{ reviewed: [ready: boolean] }>();
const workspace = useWorkspace();
const opened = ref<ReviewedDocument>();
const text = ref(''),
  error = ref(''),
  busy = ref(false),
  reviewed = ref(false);
const context = computed(() =>
  JSON.stringify([
    daoPaymentKey(props.dao),
    workspace.account?.id,
    workspace.account?.signingKey,
    workspace.account?.encryptionKey,
    props.member?.signingKey,
    props.member?.memberId,
    props.member?.active,
    props.documentId,
    props.version,
    props.commitment,
    props.content?.epochs,
    props.content?.keyGrants,
    props.content?.documents.find(
      (row) => row.document_id === props.documentId && row.version === props.version,
    ),
  ]),
);
let generation = 0,
  disposed = false;
function reset() {
  generation++;
  text.value = '';
  opened.value = undefined;
  error.value = '';
  reviewed.value = false;
  busy.value = false;
  emit('reviewed', false);
}
watch(context, reset);
watch(vaultUnlocked, reset);
watch(reviewed, (value) => emit('reviewed', value));
onBeforeUnmount(() => {
  disposed = true;
  reset();
});
const document = computed(() =>
  props.content?.documents.find(
    (row) =>
      row.document_id === props.documentId &&
      row.version === props.version &&
      row.commitment === props.commitment,
  ),
);
async function read() {
  const doc = document.value,
    records = props.content;
  if (!doc || !records || busy.value) return;
  const current = ++generation,
    domain = context.value;
  busy.value = true;
  error.value = '';
  try {
    const result = await readDocumentForReview(
      props.dao,
      props.member?.active ? props.member.memberId : undefined,
      doc,
      records,
    );
    if (
      disposed ||
      current !== generation ||
      domain !== context.value ||
      (doc.envelope_version === 1 && !vaultUnlocked.value)
    )
      return;
    if (result.file && result.markdown === undefined && doc.envelope_version === 0)
      downloadFile(result.file.bytes, result.file.metadata);
    opened.value = result;
    text.value = result.text;
  } catch (cause) {
    if (!disposed && current === generation) error.value = friendlyError(cause);
  } finally {
    if (!disposed && current === generation) busy.value = false;
  }
}
</script>
<template>
  <div class="document-review">
    <button
      type="button"
      class="secondary"
      :disabled="
        busy ||
        !document ||
        (document.envelope_version === 1 && (!vaultUnlocked || !member?.active))
      "
      @click="read"
    >
      {{ busy ? 'Verifying…' : 'Open verified supporting document' }}
    </button>
    <p v-if="!document" class="notice">The exact supporting document version is unavailable.</p>
    <p v-if="document?.envelope_version === 1 && !vaultUnlocked" class="notice">
      Unlock your account keys to review this encrypted version.
    </p>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <div
      v-if="opened?.markdown !== undefined"
      class="document-markdown"
      v-html="formatHelpAnswer(opened.markdown)"
    />
    <pre v-else-if="text" class="wrap">{{ text }}</pre>
    <button
      v-if="opened?.file"
      class="secondary"
      @click="downloadFile(opened.file.bytes, opened.file.metadata)"
    >
      {{
        document?.envelope_version === 1 ? 'Download unprotected copy' : 'Download reviewed file'
      }}
    </button>
    <p v-if="opened?.file && document?.envelope_version === 1" class="notice">
      A downloaded copy is unprotected. Keep it private.
    </p>
    <label v-if="text" class="choice"
      ><input v-model="reviewed" type="checkbox" /> I reviewed this document version</label
    >
  </div>
</template>

<style scoped>
.document-markdown {
  max-height: 55dvh;
  overflow: auto;
  overflow-wrap: anywhere;
  padding: 12px;
}
.document-markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
</style>
