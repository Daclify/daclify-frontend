<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import {
  HostedUploadSchema,
  HostedIntentSchema,
  FileMetadataSchema,
  IdSchema,
  MAX_HOSTED_CONTENT_BYTES,
  type HostedUpload,
  type HostedDocument,
  type DaoSummary,
  type DaoContent,
  type UserMembership,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { encryptDaoFile, relayInstruction, vaultUnlocked } from '../auth/session';
import { preparePublicFile } from '../content/files';
import { useWorkspace } from '../state/workspace';

const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  content: DaoContent | undefined;
}>();
const emit = defineEmits<{ published: [] }>();
const workspace = useWorkspace();
const configured = ref(false);
const localFixture = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
  file.value = undefined;
  upload.value = undefined;
});
const documentId = ref('');
const file = shallowRef<File>();
const fileInput = ref<HTMLInputElement>();
const upload = shallowRef<HostedUpload>();
const receipt = ref<HostedDocument>();
const requestId = ref('');
const storedRequestId = ref('');
const privateDao = computed(() => props.dao.privacy !== 'public');
const currentKey = computed(() =>
  props.content?.keyGrants.some(
    (grant) => grant.epoch === props.dao.keyEpoch && grant.recipient === props.member?.memberId,
  ),
);
const mayUpload = computed(
  () =>
    !!props.member?.active &&
    vaultUnlocked.value &&
    configured.value &&
    !!props.content &&
    (!privateDao.value || currentKey.value) &&
    !busy.value,
);
const pendingKey = computed(() =>
  JSON.stringify([
    'daclify.pending-upload.v1',
    workspace.account?.id,
    props.dao.reference.chainId,
    props.dao.reference.contract,
    props.dao.reference.daoId,
  ]),
);
function remember(id: string) {
  storedRequestId.value = id;
  requestId.value = id;
  sessionStorage.setItem(pendingKey.value, id);
}
function clearPending() {
  sessionStorage.removeItem(pendingKey.value);
  storedRequestId.value = '';
  requestId.value = '';
  receipt.value = undefined;
  upload.value = undefined;
  documentId.value = '';
  file.value = undefined;
  if (fileInput.value) fileInput.value.value = '';
}
function selectFile(event: Event) {
  const target = event.target;
  if (target instanceof HTMLInputElement) file.value = target.files?.item(0) ?? undefined;
}
watch(vaultUnlocked, (unlocked) => {
  if (!unlocked && privateDao.value) {
    file.value = undefined;
    if (fileInput.value) fileInput.value.value = '';
  }
});
watch(
  pendingKey,
  (key) => {
    storedRequestId.value = sessionStorage.getItem(key) ?? '';
    requestId.value = storedRequestId.value;
    receipt.value = undefined;
    upload.value = undefined;
  },
  { immediate: true },
);
onMounted(async () => {
  try {
    const storage = await api.storage();
    configured.value = storage.configured;
    localFixture.value = storage.provider === 'local-fixture';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    loading.value = false;
  }
});
function acceptReceipt(document: HostedDocument) {
  const dao = props.dao.reference;
  if (
    document.dao.chainId !== dao.chainId ||
    document.dao.contract !== dao.contract ||
    document.dao.daoId !== dao.daoId ||
    document.dao.interfaceVersion !== dao.interfaceVersion
  )
    throw new Error('UPLOAD_RECEIPT');
  if (
    upload.value &&
    JSON.stringify(HostedIntentSchema.strip().parse(document)) !==
      JSON.stringify(HostedIntentSchema.strip().parse(upload.value))
  )
    throw new Error('UPLOAD_RECEIPT');
  receipt.value = document;
  notice.value = 'File verified. Review its record, then sign to publish it.';
}
async function send() {
  if (!props.member || !props.content || !mayUpload.value || disposed) return;
  const domain = pendingKey.value;
  const current = () => !disposed && domain === pendingKey.value;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (!upload.value) {
      const selected = file.value;
      if (!selected) throw new Error('FILE_REQUIRED');
      if (selected.size > MAX_HOSTED_CONTENT_BYTES) throw new Error('FILE_TOO_LARGE');
      const id = IdSchema.parse(documentId.value);
      const previous = props.content.documents
        .filter((document) => document.document_id === id)
        .reduce((version, document) => Math.max(version, document.version), 0);
      const version = previous + 1;
      const metadata = FileMetadataSchema.parse({
        version: 1,
        filename: selected.name,
        mediaType: selected.type || 'application/octet-stream',
      });
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (!current()) return;
      const prepared = privateDao.value
        ? await encryptDaoFile(
            props.dao.reference,
            props.member.memberId,
            id,
            version,
            props.dao.keyEpoch,
            props.content,
            bytes,
            metadata,
          )
        : await preparePublicFile(bytes, metadata);
      if (!current()) return;
      if (!vaultUnlocked.value) throw new Error('VAULT_LOCKED');
      upload.value = HostedUploadSchema.parse({
        ...prepared,
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        dao: props.dao.reference,
        documentId: id,
        version,
        keyEpoch: privateDao.value ? props.dao.keyEpoch : '0',
      });
      remember(upload.value.requestId);
      file.value = undefined;
      if (fileInput.value) fileInput.value.value = '';
    }
    const result = await api.upload(upload.value);
    if (current()) acceptReceipt(result);
  } catch (cause) {
    if (current()) error.value = friendlyError(cause);
  } finally {
    if (current()) busy.value = false;
  }
}
async function check() {
  if (busy.value || disposed) return;
  const domain = pendingKey.value;
  const current = () => !disposed && domain === pendingKey.value;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const status = await api.reconcileUpload(requestId.value);
    if (!current()) return;
    remember(status.requestId);
    if (status.document) acceptReceipt(status.document);
    else
      notice.value =
        status.state === 'failed'
          ? 'This upload requires operator review. Its request record remains available.'
          : 'Upload completion is still uncertain. Check this request again; starting another upload may consume additional quota.';
  } catch (cause) {
    if (current()) error.value = friendlyError(cause);
  } finally {
    if (current()) busy.value = false;
  }
}
async function publish() {
  const document = receipt.value;
  if (!document || busy.value || disposed || !props.member?.active || !vaultUnlocked.value) return;
  const domain = pendingKey.value;
  const current = () => !disposed && domain === pendingKey.value;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const content = await api.content(props.dao.reference.daoId);
    if (!current()) return;
    if (JSON.stringify(content.dao) !== JSON.stringify(document.dao))
      throw new Error('DAO_REFERENCE');
    const existing = content.documents.find(
      (row) => row.document_id === document.documentId && row.version === document.version,
    );
    if (existing) {
      if (
        existing.cid !== document.cid ||
        existing.commitment !== document.commitment ||
        existing.bytes !== document.bytes ||
        existing.metadata !== document.metadata ||
        existing.key_epoch !== document.keyEpoch ||
        existing.envelope_version !== document.envelopeVersion
      )
        throw new Error('DOCUMENT_VERSION');
    } else {
      await workspace.refresh();
      if (!current() || !vaultUnlocked.value) return;
      const member = workspace.memberships.find(
        (row) =>
          row.dao.chainId === document.dao.chainId &&
          row.dao.contract === document.dao.contract &&
          row.dao.daoId === document.dao.daoId,
      );
      if (!member?.active) throw new Error('MEMBER_REQUIRED');
      const payload = encodeAction('putdoc', {
        runtime: document.dao.contract,
        dao_id: document.dao.daoId,
        member_id: member.memberId,
        document_id: document.documentId,
        version: document.version,
        cid: document.cid,
        metadata: document.metadata,
        commitment: document.commitment,
        bytes: document.bytes,
        envelope_version: document.envelopeVersion,
        key_epoch: document.keyEpoch,
      });
      await relayInstruction(
        makeInstruction(
          document.dao,
          member.memberId,
          member.nonce,
          Math.floor(Date.now() / 1000) + 300,
          document.dao.contract,
          'putdoc',
          payload,
        ),
      );
    }
    await workspace.refresh();
    if (!current()) return;
    clearPending();
    notice.value = 'File document published.';
    emit('published');
  } catch (cause) {
    if (current()) error.value = friendlyError(cause);
  } finally {
    if (current()) busy.value = false;
  }
}
</script>
<template>
  <section class="panel narrow">
    <h3>{{ privateDao ? 'Publish an encrypted file' : 'Publish a file to IPFS' }}</h3>
    <p v-if="loading" role="status">Checking hosted storage…</p>
    <p v-else-if="!configured" class="notice">
      Hosted storage is not configured on this service. Small JSON documents remain available.
      <RouterLink to="/docs/providers">Storage setup guide ↗</RouterLink>
    </p>
    <template v-else
      ><p v-if="localFixture" class="notice">
        Local storage fixture: these files have not been published to Pinata or the IPFS network.
      </p>
      <p>
        Upload and verify the file first, then sign its on-chain record. Stored files are limited to
        5 MiB; encryption and encoding reduce the maximum original file size.
      </p>
      <p v-if="privateDao" class="field-help">
        The filename and contents are encrypted in your browser. Document IDs, sizes, hashes and
        timing remain public.
      </p>
      <form
        v-if="member?.active && vaultUnlocked && !storedRequestId && !receipt"
        @submit.prevent="send"
      >
        <label for="file-document-id">File document ID</label
        ><input
          id="file-document-id"
          v-model="documentId"
          inputmode="numeric"
          pattern="[1-9][0-9]*"
          required
          :disabled="busy"
        /><label for="document-file">Document file</label
        ><input
          id="document-file"
          ref="fileInput"
          type="file"
          required
          :disabled="busy"
          @change="selectFile"
        /><button :disabled="!mayUpload || !file">
          {{ busy ? 'Uploading…' : privateDao ? 'Encrypt and upload file' : 'Upload file' }}
        </button>
      </form>
      <p v-if="!member?.active" class="field-help">
        An active DAO membership is required for a new upload.
      </p>
      <p v-else-if="!vaultUnlocked" class="field-help">
        Unlock your vault before uploading or publishing.
      </p>
      <p v-else-if="privateDao && !currentKey" class="field-help">
        A key grant for the current epoch is required for a new encrypted file.
      </p>
      <div v-if="storedRequestId && !receipt">
        <p class="mono wrap">Pending request: {{ storedRequestId }}</p>
        <button v-if="upload" :disabled="busy || !mayUpload" @click="send">
          Retry this upload
        </button>
        <p class="field-help">
          Use the same request to avoid another reservation. After a reload, check completion below.
        </p>
      </div>
      <form v-if="!receipt" @submit.prevent="check">
        <label for="upload-request-id">Upload request ID</label
        ><input id="upload-request-id" v-model="requestId" required :disabled="busy" /><button
          class="secondary"
          :disabled="busy || !workspace.account || !requestId"
        >
          Check upload completion
        </button>
      </form>
      <div v-if="receipt">
        <h4>Verified file record</h4>
        <dl>
          <dt>Document</dt>
          <dd>{{ receipt.documentId }} · version {{ receipt.version }}</dd>
          <dt>Stored bytes</dt>
          <dd>{{ receipt.bytes }}</dd>
          <dt>Encryption epoch</dt>
          <dd>{{ receipt.keyEpoch }}</dd>
          <dt>IPFS</dt>
          <dd class="mono wrap">{{ receipt.cid }}</dd>
        </dl>
        <button :disabled="busy || !member?.active || !vaultUnlocked" @click="publish">
          Sign and publish file record
        </button>
        <p class="field-help">
          The record is not published until its blockchain transaction succeeds. Keep the request ID
          to resume after an interruption.
        </p>
        <p class="mono wrap">Request: {{ receipt.requestId }}</p>
      </div>
    </template>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
  </section>
</template>
