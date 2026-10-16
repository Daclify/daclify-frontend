<script setup lang="ts">
import { privateContentError as friendlyError } from '../content/private-errors';
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import {
  type DaoSummary,
  type UserMembership,
  type PrivateRecordPayload,
  type PrivateRecordReference,
} from '@daclify/core-protocol';
import { api } from '../api/client';
import { vaultUnlocked } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { updatePrivateIdentity } from '../content/dao-identity';
import { repreparePrivateRecord } from '../content/reprepare-private-record';
import { pendingPrivateRecord } from '../content/publish-private-record';
import {
  readPrivateImage,
  readPrivateRecord,
  newPrivateRecordId,
} from '../content/private-records';
import type { PublishedDocumentReference } from '../content/files';
import WorkspaceDialog from './WorkspaceDialog.vue';
import FilePanel from './FilePanel.vue';
type Identity = Extract<PrivateRecordPayload, { kind: 'dao-identity' }>['body'];
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  body: Identity | undefined;
  reference: PrivateRecordReference | undefined;
}>();
const emit = defineEmits<{ updated: [] }>(),
  route = useRoute();
const popup = ref(false),
  busy = ref(false),
  error = ref(''),
  title = ref(''),
  description = ref(''),
  summary = ref('');
const resumeMessage = ref('');
const uploading = ref(false),
  pending = ref(false),
  reviewing = ref(false);
const assetId = ref(newPrivateRecordId());
const branding = ref<Identity['branding']>({}),
  slot = ref<'logo' | 'cover'>('logo'),
  content = ref<Awaited<ReturnType<typeof api.content>>>();
let generation = 0;
const ready = computed(
  () =>
    !!props.body &&
    !!props.reference &&
    vaultUnlocked.value &&
    props.member?.active &&
    props.member.admin &&
    canSignMember(props.member),
);
watch(
  () =>
    JSON.stringify([
      props.body,
      props.reference,
      props.member?.active,
      vaultUnlocked.value,
      props.dao.reference,
    ]),
  () => {
    generation++;
    popup.value = false;
    busy.value = false;
    uploading.value = false;
    pending.value = false;
    reviewing.value = false;
    error.value = '';
    resumeMessage.value = '';
    content.value = undefined;
    title.value = props.body?.title ?? '';
    description.value = props.body?.description ?? '';
    summary.value = props.body?.summary ?? '';
    branding.value = { ...props.body?.branding };
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  generation++;
  title.value = '';
  description.value = '';
  summary.value = '';
  branding.value = {};
});
async function open() {
  if (!ready.value) return;
  const started = ++generation;
  popup.value = true;
  error.value = '';
  try {
    const rows = await api.content(props.dao.reference.daoId);
    if (started === generation) content.value = rows;
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  }
}
async function resume(reprepare = false) {
  const member = props.member,
    reference = props.reference,
    started = generation;
  if (!member || !reference || !ready.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const rows = await api.content(props.dao.reference.daoId),
      saved = await pendingPrivateRecord(props.dao.reference, member.memberId, rows);
    if (started !== generation) return;
    const expected = {
      kind: 'dao-identity' as const,
      source: props.dao.reference.contract,
      recordId: props.dao.reference.daoId,
    };
    let payload: PrivateRecordPayload;
    if (saved) {
      if (saved.upload.documentId !== reference.documentId) throw Error('PENDING_UPLOAD_FINISH');
      payload = saved.payload;
    } else {
      const latest = rows.documents
        .filter(
          (row) => row.document_id === reference.documentId && row.version > reference.version,
        )
        .sort((a, b) => b.version - a.version)[0];
      if (!latest) {
        resumeMessage.value = 'No unfinished encrypted edit on this browser.';
        return;
      }
      payload = await readPrivateRecord(
        props.dao.reference,
        member.memberId,
        {
          documentId: latest.document_id,
          version: latest.version,
          commitment: latest.commitment,
          keyEpoch: latest.key_epoch,
        },
        rows,
        expected,
      );
    }
    if (started !== generation) return;
    if (
      payload.kind !== expected.kind ||
      payload.source !== expected.source ||
      payload.recordId !== expected.recordId
    )
      throw Error('PRIVATE_RECORD_CONTEXT');
    if (reprepare) {
      const result = await repreparePrivateRecord(
        props.dao.reference,
        member.memberId,
        expected,
        reference.documentId,
      );
      if (started !== generation) return;
      if (JSON.stringify(result.payload) !== JSON.stringify(payload))
        throw Error('PRIVATE_RECORD_CONTEXT');
    }
    title.value = payload.body.title;
    description.value = payload.body.description;
    summary.value = payload.body.summary ?? '';
    branding.value = { ...payload.body.branding };
    resumeMessage.value = 'Unfinished edit restored for review. Save to finish its publication.';
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
async function asset(document: PublishedDocumentReference) {
  const started = generation,
    member = props.member;
  if (!member || !ready.value) return;
  const placement = slot.value;
  reviewing.value = true;
  try {
    const rows = await api.content(props.dao.reference.daoId),
      found = rows.documents.find(
        (row) =>
          row.document_id === document.documentId &&
          row.version === document.version &&
          row.commitment === document.commitment &&
          row.envelope_version === 1,
      );
    if (!found) throw Error('PRIVATE_IDENTITY_REFERENCE');
    await readPrivateImage(
      props.dao.reference,
      member.memberId,
      {
        documentId: found.document_id,
        version: found.version,
        commitment: found.commitment,
        keyEpoch: found.key_epoch,
      },
      rows,
    );
    if (started !== generation) return;
    branding.value = {
      ...branding.value,
      [placement]: {
        documentId: found.document_id,
        version: found.version,
        commitment: found.commitment,
        keyEpoch: found.key_epoch,
      },
    };
    content.value = rows;
    assetId.value = newPrivateRecordId();
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) reviewing.value = false;
  }
}
async function save() {
  const member = props.member,
    reference = props.reference,
    started = generation;
  if (
    !member ||
    !reference ||
    !ready.value ||
    busy.value ||
    uploading.value ||
    pending.value ||
    reviewing.value
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    await updatePrivateIdentity(props.dao.reference, member.memberId, reference, {
      title: title.value,
      description: description.value,
      summary: summary.value,
      branding: branding.value,
    });
    if (started === generation) {
      popup.value = false;
      emit('updated');
    }
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>Private DAO identity</h2>
        <p>Your internal name, description and images follow this DAO’s content grants.</p>
      </div>
      <button
        v-if="member?.admin"
        type="button"
        class="secondary"
        :disabled="!ready || busy"
        @click="open"
      >
        Edit private details
      </button>
    </div>
    <p v-if="body?.summary">{{ body.summary }}</p>
    <p v-if="!vaultUnlocked">
      <RouterLink :to="{ path: '/account', query: { unlock: '1', returnTo: route.fullPath } }"
        >Unlock your account</RouterLink
      >
      to read or edit these details.
    </p>
    <p v-else-if="!body">
      The encrypted identity is unavailable or its setup is unfinished. Resume the original creation
      order if needed.
    </p>
    <p class="field-help">
      Memberships, native votes and financial records remain public. Public directory publication is
      separate below.
    </p>
  </section>
  <WorkspaceDialog
    v-model:open="popup"
    title="Edit private DAO details"
    :busy="busy || uploading || reviewing"
  >
    <p>
      These details are encrypted before publication. Members with a permitted key grant can read
      them.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <button type="button" class="secondary" :disabled="busy || !ready" @click="resume()">
      Review unfinished encrypted edit
    </button>
    <details>
      <summary>Recover an unfinished edit after key changes</summary>
      <p>
        Re-encrypt the unlinked revision using your original grants, then review it before saving.
        Earlier ciphertext remains tracked and may still use storage.
      </p>
      <button type="button" class="secondary" :disabled="busy || !ready" @click="resume(true)">
        Reprepare encrypted edit
      </button>
    </details>
    <p v-if="resumeMessage" role="status">{{ resumeMessage }}</p>
    <form @submit.prevent="save">
      <fieldset :disabled="busy || !ready">
        <label for="private-dao-name">Private DAO name</label
        ><input id="private-dao-name" v-model="title" maxlength="160" required />
        <label for="private-dao-description">Private description</label
        ><textarea id="private-dao-description" v-model="description" maxlength="4000" rows="5" />
        <label for="private-dao-summary">Private summary</label
        ><textarea id="private-dao-summary" v-model="summary" maxlength="280" rows="2" />
      </fieldset>
      <button :disabled="busy || uploading || pending || reviewing || !ready">
        {{ busy ? 'Saving encrypted details…' : 'Save private details' }}
      </button>
    </form>
    <details v-if="content && ready">
      <summary>Private logo and cover</summary>
      <p>
        Upload a PNG, JPEG or WebP of up to 2 MiB. The file is encrypted; save the private details
        afterward to attach it.
      </p>
      <label for="private-image-slot">Private image placement</label
      ><select
        id="private-image-slot"
        v-model="slot"
        :disabled="busy || uploading || pending || reviewing"
      >
        <option value="logo">Logo</option>
        <option value="cover">Cover</option>
      </select>
      <p v-if="branding?.logo">
        Private logo attached
        <button type="button" class="secondary" @click="delete branding.logo">Remove</button>
      </p>
      <p v-if="branding?.cover">
        Private cover attached
        <button type="button" class="secondary" @click="delete branding.cover">Remove</button>
      </p>
      <FilePanel
        :dao="dao"
        :member="member"
        :content="content"
        :selected-document-id="assetId"
        new-document
        @busy="uploading = $event"
        @pending="pending = $event"
        @published="asset"
      />
    </details>
  </WorkspaceDialog>
</template>
