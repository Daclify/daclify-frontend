<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  FileMetadataSchema,
  IdSchema,
  type DaoContent,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction, type RuntimeActions } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import {
  preparePrivateEpoch,
  encryptDaoJson,
  decryptDaoJson,
  decryptDaoFile,
  grantPrivateEpoch,
  relayInstruction,
  vaultUnlocked,
} from '../auth/session';
import { decodeStoredBytes, verifyStoredFile, downloadFile } from '../content/files';
import FilePanel from './FilePanel.vue';
import AdmissionPanel from './AdmissionPanel.vue';
import { useWorkspace } from '../state/workspace';
import { canSignMember } from '../auth/action-signer';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  section: string;
}>();
const signerReady = computed(() => canSignMember(props.member));
const decrypted = ref(new Map<string, string>());
const epochChoice = ref(props.dao.keyEpoch);
const state = useWorkspace();
const content = ref<DaoContent>();
const busy = ref(false);
const error = ref('');
const documentId = ref('');
const value = ref('');
const target = ref('');
const quantity = ref('0');
const admin = ref(false);
const reviewer = ref(false);
let generation = 0;
let disposed = false;
const context = computed(() =>
  JSON.stringify([
    props.dao.reference,
    state.account?.id,
    props.member?.memberId,
    props.dao.privacy,
  ]),
);
const isAdmin = computed(() => !!props.member?.active && props.member.admin);
const privateDao = computed(() => props.dao.privacy !== 'public');
const epochReady = computed(() =>
  content.value?.epochs.some((e) => e.epoch === props.dao.keyEpoch),
);
const hasCurrentKey = computed(() =>
  content.value?.keyGrants.some(
    (g) => g.epoch === props.dao.keyEpoch && g.recipient === props.member?.memberId,
  ),
);
const selected = computed(() => content.value?.members.find((m) => m.id === target.value));
const latest = computed(() => {
  const records = new Map<string, DaoContent['documents'][number]>();
  for (const d of content.value?.documents ?? []) {
    const previous = records.get(d.document_id);
    if (!previous || previous.version < d.version) records.set(d.document_id, d);
  }
  return Array.from(records.values());
});
async function refresh() {
  const request = ++generation;
  const domain = context.value;
  try {
    const records = await api.content(props.dao.reference.daoId);
    if (
      !disposed &&
      request === generation &&
      domain === context.value &&
      JSON.stringify(records.dao) === JSON.stringify(props.dao.reference)
    )
      content.value = records;
  } catch (cause) {
    if (!disposed && request === generation && domain === context.value)
      error.value = friendlyError(cause);
  }
}
watch(vaultUnlocked, (unlocked) => {
  if (!unlocked) {
    decrypted.value.clear();
    if (privateDao.value) value.value = '';
  }
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  decrypted.value.clear();
  value.value = '';
});
watch(
  () => props.member?.active,
  (active) => {
    if (!active) {
      decrypted.value.clear();
      if (privateDao.value) value.value = '';
    }
  },
  { flush: 'sync' },
);
watch(
  context,
  () => {
    generation++;
    content.value = undefined;
    decrypted.value.clear();
    value.value = '';
    documentId.value = '';
    target.value = '';
    quantity.value = '0';
    admin.value = false;
    reviewer.value = false;
    error.value = '';
    busy.value = false;
    epochChoice.value = props.dao.keyEpoch;
    void refresh();
  },
  { immediate: true, flush: 'sync' },
);
watch(selected, (m) => {
  quantity.value = m?.credits ?? '0';
  admin.value = m?.admin ?? false;
  reviewer.value = m?.reviewer ?? false;
});
async function transact<K extends keyof RuntimeActions>(action: K, args: RuntimeActions[K]) {
  const member = props.member;
  if (disposed || !member?.active || !signerReady.value) return;
  await relayInstruction(
    makeInstruction(
      props.dao.reference,
      member.memberId,
      member.nonce,
      Math.floor(Date.now() / 1000) + 300,
      props.dao.reference.contract,
      action,
      encodeAction(action, args),
    ),
  );
  await state.refresh();
  await refresh();
}
async function publish() {
  const m = props.member;
  if (
    !m?.active ||
    !content.value ||
    !signerReady.value ||
    (privateDao.value && !vaultUnlocked.value)
  )
    return;
  const domain = context.value;
  busy.value = true;
  error.value = '';
  try {
    const id = IdSchema.parse(documentId.value);
    const parsed: unknown = JSON.parse(value.value);
    const json = JSON.stringify(parsed);
    if (new TextEncoder().encode(json).length > 4096) {
      error.value =
        'Inline JSON is limited to 4096 bytes. Use an IPFS document for larger content.';
      return;
    }
    const previous = latest.value.find((d) => d.document_id === id);
    const version = (previous?.version ?? 0) + 1;
    const stored = privateDao.value
      ? await encryptDaoJson(
          props.dao.reference,
          m.memberId,
          id,
          version,
          props.dao.keyEpoch,
          content.value,
          json,
        )
      : json;
    if (new TextEncoder().encode(stored).length > 4096) {
      error.value =
        'The stored JSON or encrypted envelope exceeds 4096 bytes. Use an IPFS document for larger content.';
      return;
    }
    if (
      disposed ||
      domain !== context.value ||
      !signerReady.value ||
      (privateDao.value && !vaultUnlocked.value)
    )
      return;
    await transact('putjson', {
      runtime: props.dao.reference.contract,
      dao_id: props.dao.reference.daoId,
      member_id: m.memberId,
      document_id: id,
      version,
      value: stored,
      envelope_version: privateDao.value ? 1 : 0,
      key_epoch: privateDao.value ? props.dao.keyEpoch : '0',
    });
    documentId.value = '';
    value.value = '';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function initialize() {
  const m = props.member;
  if (!m) return;
  busy.value = true;
  error.value = '';
  try {
    const prepared = await preparePrivateEpoch(props.dao.reference, m.memberId, props.dao.keyEpoch);
    await transact('commitepoch', {
      runtime: props.dao.reference.contract,
      dao_id: props.dao.reference.daoId,
      member_id: m.memberId,
      epoch: props.dao.keyEpoch,
      commitment: prepared.commitment,
      self_grant: prepared.selfGrant,
    });
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function decrypt(document: DaoContent['documents'][number]) {
  const m = props.member;
  const records = content.value;
  if (!m || !records) return;
  busy.value = true;
  error.value = '';
  const domain = context.value;
  const request = generation;
  try {
    const text = await decryptDaoJson(props.dao.reference, m.memberId, document, records);
    if (
      !disposed &&
      domain === context.value &&
      request === generation &&
      vaultUnlocked.value &&
      props.member?.active
    )
      decrypted.value.set(document.id, text);
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function share() {
  const m = props.member;
  const recipient = selected.value;
  const records = content.value;
  if (!m || !recipient || !records) return;
  busy.value = true;
  error.value = '';
  try {
    const envelope = await grantPrivateEpoch(
      props.dao.reference,
      m.memberId,
      recipient,
      epochChoice.value,
      records,
    );
    await transact('grantkey', {
      runtime: props.dao.reference.contract,
      dao_id: props.dao.reference.daoId,
      member_id: m.memberId,
      recipient: recipient.id,
      epoch: epochChoice.value,
      envelope,
    });
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function rotate() {
  const m = props.member;
  if (!m) return;
  busy.value = true;
  error.value = '';
  try {
    await transact('rotateepoch', {
      runtime: props.dao.reference.contract,
      dao_id: props.dao.reference.daoId,
      member_id: m.memberId,
    });
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function activate() {
  const m = props.member;
  const recipient = selected.value;
  if (!m || !recipient) return;
  busy.value = true;
  error.value = '';
  try {
    await transact('setactive', {
      runtime: props.dao.reference.contract,
      dao_id: props.dao.reference.daoId,
      member_id: m.memberId,
      target: recipient.id,
      active: !recipient.active,
    });
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function roles() {
  const m = props.member;
  if (!m || !selected.value) return;
  busy.value = true;
  error.value = '';
  try {
    await transact('setroles', {
      runtime: props.dao.reference.contract,
      dao_id: props.dao.reference.daoId,
      member_id: m.memberId,
      target: selected.value.id,
      admin: admin.value,
      reviewer: reviewer.value,
    });
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function credits() {
  const m = props.member;
  if (!m || !selected.value) return;
  busy.value = true;
  error.value = '';
  try {
    await transact('setcredits', {
      runtime: props.dao.reference.contract,
      dao_id: props.dao.reference.daoId,
      member_id: m.memberId,
      target: selected.value.id,
      quantity: quantity.value,
    });
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function retrieve(document: DaoContent['documents'][number]) {
  const domain = context.value,
    request = generation;
  const current = () => !disposed && domain === context.value && request === generation;
  busy.value = true;
  error.value = '';
  try {
    const stored = decodeStoredBytes(
      (await api.documentBytes(props.dao.reference.daoId, document.document_id, document.version))
        .content,
    );
    await verifyStoredFile(document, stored);
    if (document.envelope_version === 1) {
      if (!props.member || !content.value) throw new Error('EPOCH_UNAVAILABLE');
      const opened = await decryptDaoFile(
        props.dao.reference,
        props.member.memberId,
        document,
        content.value,
        stored,
      );
      if (current() && vaultUnlocked.value && props.member?.active)
        downloadFile(opened.bytes, opened.metadata);
    } else {
      const metadata =
        document.metadata === '{}'
          ? {
              version: 1,
              filename: `document-${document.document_id}-v${document.version}.bin`,
              mediaType: 'application/octet-stream',
            }
          : JSON.parse(document.metadata);
      if (current()) downloadFile(stored, FileMetadataSchema.parse(metadata));
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="section-toolbar">
    <h2>{{ section === 'documents' ? 'Documents' : 'Members and permissions' }}</h2>
    <RouterLink class="help-link" :to="`/docs/${section}`">Help ↗</RouterLink>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <template v-if="section === 'documents'"
    ><section v-if="privateDao" class="panel narrow">
      <h3>Encryption epoch {{ dao.keyEpoch }}</h3>
      <p v-if="hasCurrentKey">Encryption epoch ready</p>
      <p v-else-if="!member?.active">
        First obtain an active membership through Members, then ask an administrator for document
        access.
      </p>
      <p v-else-if="!vaultUnlocked">Unlock your account to decrypt documents.</p>
      <p v-else-if="epochReady">Ask an administrator for a key grant for this epoch.</p>
      <button v-else-if="isAdmin" :disabled="busy || !vaultUnlocked" @click="initialize">
        Initialize encryption epoch
      </button>
      <p>
        Ciphertext, memberships, votes and financial metadata remain public. Rotating a key protects
        future content; old access remains possible.
      </p>
      <button
        v-if="isAdmin && epochReady"
        class="secondary"
        :disabled="busy || !vaultUnlocked"
        @click="rotate"
      >
        Rotate future document key
      </button>
    </section>
    <section
      v-if="member?.active && signerReady && (!privateDao || (vaultUnlocked && hasCurrentKey))"
      class="panel narrow"
    >
      <h3>{{ privateDao ? 'Publish encrypted JSON' : 'Publish small JSON' }}</h3>
      <p>
        Up to 4096 bytes live directly in the contract. Publishing a new version preserves the
        previous version.
      </p>
      <form @submit.prevent="publish">
        <label for="document-id">Document ID</label
        ><input
          id="document-id"
          v-model="documentId"
          inputmode="numeric"
          pattern="[1-9][0-9]*"
          required
        /><label for="json-value">JSON content</label
        ><textarea id="json-value" v-model="value" rows="5" required spellcheck="false"></textarea
        ><button :disabled="busy || !signerReady || (privateDao && !vaultUnlocked)">
          {{ busy ? 'Publishing…' : privateDao ? 'Encrypt and publish JSON' : 'Publish JSON' }}
        </button>
      </form>
    </section>
    <p v-else-if="dao.privacy !== 'public'" class="notice">
      Encrypted documents require a key grant for the selected DAO epoch. The ciphertext and its
      record remain publicly visible.
    </p>
    <FilePanel
      v-if="member"
      :key="context"
      :dao="dao"
      :member="member"
      :content="content"
      @published="refresh"
    />
    <div class="dao-grid">
      <article v-for="document in latest" :key="document.id" class="panel">
        <div class="panel-heading">
          <h3>Document {{ document.document_id }}</h3>
          <span class="pill">Version {{ document.version }}</span>
        </div>
        <p class="muted">{{ document.bytes }} bytes · member {{ document.author }}</p>
        <pre v-if="!document.cid && document.envelope_version === 0" class="wrap">{{
          document.metadata
        }}</pre>
        <template v-else-if="document.envelope_version === 1 && !document.cid"
          ><p>Encrypted · epoch {{ document.key_epoch }}</p>
          <button :disabled="busy || !vaultUnlocked || !member?.active" @click="decrypt(document)">
            Decrypt document {{ document.document_id }}
          </button>
          <pre v-if="decrypted.has(document.id)" class="wrap">{{
            decrypted.get(document.id)
          }}</pre></template
        ><template v-else
          ><p class="mono wrap">IPFS: {{ document.cid }}</p>
          <button
            :disabled="busy || (document.envelope_version === 1 && (!vaultUnlocked || !member))"
            @click="retrieve(document)"
          >
            {{ document.envelope_version === 1 ? 'Decrypt and download' : 'Download' }} document
            {{ document.document_id }}
          </button></template
        >
        <details>
          <summary>Version history &amp; integrity</summary>
          <div
            v-for="version in content?.documents.filter(
              (d) => d.document_id === document.document_id,
            )"
            :key="version.id"
            class="mono wrap"
          >
            <p>Version {{ version.version }} · {{ version.commitment }}</p>
            <pre v-if="!version.cid && version.envelope_version === 0" class="wrap">{{
              version.metadata
            }}</pre>
            <template v-else-if="!version.cid && version.envelope_version === 1"
              ><button
                class="secondary"
                :disabled="busy || !vaultUnlocked || !member?.active"
                @click="decrypt(version)"
              >
                Decrypt document {{ version.document_id }} version {{ version.version }}
              </button>
              <pre v-if="decrypted.has(version.id)" class="wrap">{{
                decrypted.get(version.id)
              }}</pre>
            </template>
            <button
              v-if="version.cid"
              class="secondary"
              :disabled="busy || (version.envelope_version === 1 && (!vaultUnlocked || !member))"
              @click="retrieve(version)"
            >
              Download document {{ version.document_id }} version {{ version.version }}
            </button>
          </div>
        </details>
      </article>
    </div>
    <p v-if="content && !latest.length" class="muted">No documents published yet.</p></template
  >
  <template v-else
    ><AdmissionPanel :key="context" :dao="dao" :member="member" @admitted="refresh" />
    <div class="dao-grid">
      <article v-for="memberRow in content?.members" :key="memberRow.id" class="panel">
        <h3>Member {{ memberRow.id }}</h3>
        <p>{{ memberRow.native_account || 'Internal account' }}</p>
        <div class="button-row">
          <span class="pill">{{
            memberRow.custody === 0 ? 'User-controlled' : 'Managed recovery'
          }}</span
          ><span class="pill">{{ memberRow.active ? 'Active' : 'Inactive' }}</span
          ><span v-if="memberRow.admin" class="pill">Administrator</span
          ><span v-if="memberRow.reviewer" class="pill">Reviewer</span>
        </div>
        <p>{{ memberRow.credits }} governance credits</p>
      </article>
    </div>
    <section v-if="isAdmin" class="panel narrow">
      <h3>Manage roles and governance credits</h3>
      <label for="member-target">Member</label
      ><select id="member-target" v-model="target">
        <option value="" disabled>Choose a member</option>
        <option v-for="row in content?.members" :key="row.id" :value="row.id">
          Member {{ row.id }}
        </option></select
      ><button v-if="selected" class="secondary" :disabled="busy || !signerReady" @click="activate">
        {{ selected.active ? 'Deactivate member' : 'Reactivate member' }}
      </button>
      <form v-if="privateDao" @submit.prevent="share">
        <label for="grant-epoch">Encryption epoch to grant</label
        ><select id="grant-epoch" v-model="epochChoice">
          <option v-for="epoch in content?.epochs" :key="epoch.epoch" :value="epoch.epoch">
            Epoch {{ epoch.epoch }}
          </option></select
        ><button :disabled="busy || !signerReady || !vaultUnlocked || !selected?.active">
          Grant epoch access
        </button>
      </form>
      <form @submit.prevent="roles">
        <label class="checkbox"><input v-model="admin" type="checkbox" />Administrator</label
        ><label class="checkbox"><input v-model="reviewer" type="checkbox" />Reviewer</label
        ><button :disabled="busy || !signerReady || !selected">Save roles</button>
      </form>
      <form @submit.prevent="credits">
        <label for="credits">Governance credits</label
        ><input
          id="credits"
          v-model="quantity"
          inputmode="numeric"
          pattern="(0|[1-9][0-9]*)"
          required
        />
        <p class="field-help">Credits cannot change while a ballot has locked voting weights.</p>
        <button class="secondary" :disabled="busy || !signerReady || !selected">
          Set governance credits
        </button>
      </form>
    </section></template
  >
</template>
