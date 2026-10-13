<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  FileMetadataSchema,
  IdSchema,
  type DaoContent,
  type DaoSummary,
  type UserMembership,
  type PrivateAccessPolicy,
  EncryptionPublicKeySchema,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction, type RuntimeActions } from '@daclify/core-protocol/sdk';
import { api, ApiFailure, friendlyError } from '../api/client';
import {
  preparePrivateEpoch,
  encryptDaoJson,
  decryptDaoJson,
  decryptDaoFile,
  grantPrivateEpoch,
  relayInstruction,
  vaultUnlocked,
  verifyPrivateEpochs,
} from '../auth/session';
import { decodeStoredBytes, verifyStoredFile, downloadFile } from '../content/files';
import FilePanel from './FilePanel.vue';
import WorkspaceDialog from './WorkspaceDialog.vue';
import WorkspaceActions from './WorkspaceActions.vue';
import WorkspaceTabs from './WorkspaceTabs.vue';
import { documentLabel } from '../content/document-labels';
import { newDocumentId } from '../content/document-identity';
import AdmissionPanel from './AdmissionPanel.vue';
import MemberDirectory from './MemberDirectory.vue';
import GoverningDocumentsPanel from './GoverningDocumentsPanel.vue';
import { sha256Hex } from '../auth/vault';
import { useWorkspace } from '../state/workspace';
import { canSignMember } from '../auth/action-signer';
import { validatePrivateHandover } from '../auth/private-handover';
import { planPrivateAccess, privateSuccessors } from '../auth/private-access';
import Account from '../views/Account.vue';
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
const activeTab = ref(props.section === 'documents' ? 'library' : 'directory');
const search = ref(''),
  documentType = ref('');
const documentPopup = ref(false),
  rolePopup = ref(false),
  format = ref('file');
const documentTarget = ref(''),
  uploadBusy = ref(false),
  uploadPending = ref(false);
const admissionAllowed = ref(false),
  admissionLabel = ref('Add member');
const admissionRequest = ref(0),
  registrationRequest = ref(0);
const memberNames = ref(new Map<string, string>());
const documentDrafts = new Map<string, { id: string; value: string; format: string }>();
const documentTargetLabel = computed(() => {
  const row = latest.value.find((item) => item.document_id === documentTarget.value);
  return row ? documentLabel(row) : 'the selected document';
});
const documentPopupTitle = computed(() =>
  documentTarget.value ? 'Add document version' : 'Add document',
);
const filteredDocuments = computed(() =>
  latest.value.filter(
    (row) =>
      documentLabel(row).toLowerCase().includes(search.value.trim().toLowerCase()) &&
      (!documentType.value || (documentType.value === 'file' ? !!row.cid : !row.cid)),
  ),
);
function memberName(id: string) {
  return (
    memberNames.value.get(id) ||
    content.value?.members.find((row) => row.id === id)?.native_account ||
    `Member ${id}`
  );
}
function manageMember(id: string) {
  target.value = id;
  rolePopup.value = true;
}
function openDocument(row?: DaoContent['documents'][number]) {
  if (!content.value || uploadBusy.value) return;
  if (uploadPending.value) {
    if (row && row.document_id !== documentId.value)
      error.value = 'Finish the pending file upload before starting another document.';
    documentPopup.value = true;
    return;
  }
  if (documentId.value)
    documentDrafts.set(documentTarget.value, {
      id: documentId.value,
      value: value.value,
      format: format.value,
    });
  const targetId = row?.document_id ?? '';
  const saved = documentDrafts.get(targetId);
  documentTarget.value = targetId;
  documentId.value = saved?.id ?? row?.document_id ?? newDocumentId(content.value.documents);
  format.value = saved?.format ?? (row && !row.cid ? 'json' : 'file');
  value.value = saved?.value ?? (row && !row.cid && row.envelope_version === 0 ? row.metadata : '');
  documentPopup.value = true;
}
async function filePublished() {
  if (await refresh()) {
    documentDrafts.delete(documentTarget.value);
    documentPopup.value = false;
    documentId.value = '';
    documentTarget.value = '';
  }
}

const target = ref('');
const quantity = ref('0');
const admin = ref(false);
const reviewer = ref(false);
const privatePolicy = ref<PrivateAccessPolicy>();
const currentEpoch = computed(() => privatePolicy.value?.keyEpoch ?? props.dao.keyEpoch);
watch(currentEpoch, (epoch, previous) => {
  if (epochChoice.value === previous) epochChoice.value = epoch;
});
const verifiedEpochs = ref(new Set<string>());
const successor = ref('');
const handoverConfirmed = ref(false);
const accessNote = ref('');
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
  content.value?.epochs.some((e) => e.epoch === currentEpoch.value),
);
const hasCurrentKey = computed(() =>
  content.value?.keyGrants.some(
    (g) => g.epoch === currentEpoch.value && g.recipient === props.member?.memberId,
  ),
);
const selected = computed(() => content.value?.members.find((m) => m.id === target.value));
const privateIdentityReady = computed(() => {
  const account = state.account,
    person = content.value?.members.find((m) => m.id === props.member?.memberId);
  if (!account?.encryptionKey || !person || !vaultUnlocked.value) return false;
  try {
    const key = EncryptionPublicKeySchema.parse(JSON.parse(person.encryption_key));
    return key.x === account.encryptionKey.x && key.y === account.encryptionKey.y;
  } catch {
    return false;
  }
});
const accessPlan = computed(() =>
  content.value && privatePolicy.value && props.member
    ? planPrivateAccess(
        content.value,
        props.member.memberId,
        privatePolicy.value.historyPolicy,
        props.dao.privacy,
      )
    : undefined,
);
const ownEpochs = computed(() => {
  const person = content.value?.members.find((m) => m.id === props.member?.memberId),
    policy = privatePolicy.value;
  return person && policy
    ? (content.value?.epochs ?? [])
        .filter(
          (e) =>
            policy.historyPolicy === 'full-history' || BigInt(e.epoch) >= BigInt(person.join_epoch),
        )
        .map((e) => e.epoch)
    : [];
});
const ownChecks = computed(() =>
  ownEpochs.value.filter(
    (epoch) =>
      !verifiedEpochs.value.has(epoch) &&
      content.value?.keyGrants.some(
        (g) => g.recipient === props.member?.memberId && g.epoch === epoch,
      ),
  ),
);
const successors = computed(() =>
  content.value && selected.value ? privateSuccessors(content.value, selected.value.id) : [],
);
const accessFingerprint = computed(() =>
  JSON.stringify([
    context.value,
    currentEpoch.value,
    privatePolicy.value,
    content.value?.epochs,
    content.value?.keyGrants,
    content.value?.members.map((m) => [m.id, m.active, m.admin, m.encryption_key, m.join_epoch]),
  ]),
);
watch(accessFingerprint, () => {
  verifiedEpochs.value.clear();
  handoverConfirmed.value = false;
  successor.value = '';
});
watch(target, () => {
  handoverConfirmed.value = false;
  successor.value = '';
});
const latest = computed(() => {
  const records = new Map<string, DaoContent['documents'][number]>();
  for (const d of content.value?.documents ?? []) {
    const previous = records.get(d.document_id);
    if (!previous || previous.version < d.version) records.set(d.document_id, d);
  }
  return Array.from(records.values());
});
async function refresh(): Promise<boolean> {
  const request = ++generation;
  const domain = context.value;
  try {
    const [records, policy] = await Promise.all([
      api.content(props.dao.reference.daoId),
      privateDao.value
        ? api.privateAccessPolicy(props.dao.reference.daoId).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    if (
      !disposed &&
      request === generation &&
      domain === context.value &&
      JSON.stringify(records.dao) === JSON.stringify(props.dao.reference)
    ) {
      if (policy && JSON.stringify(policy.dao) !== JSON.stringify(props.dao.reference))
        throw new Error('DAO_REFERENCE');
      content.value = records;
      privatePolicy.value = policy;
      return true;
    }
  } catch (cause) {
    if (!disposed && request === generation && domain === context.value)
      error.value = friendlyError(cause);
  }
  return false;
}
watch(
  () => props.section,
  (section) => {
    activeTab.value = section === 'documents' ? 'library' : 'directory';
    documentPopup.value = false;
    rolePopup.value = false;
    error.value = '';
    void refresh();
  },
);
watch(vaultUnlocked, (unlocked) => {
  if (!unlocked) {
    decrypted.value.clear();
    verifiedEpochs.value.clear();
    if (privateDao.value) documentDrafts.clear();
    if (privateDao.value) value.value = '';
  }
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  decrypted.value.clear();
  value.value = '';
  documentDrafts.clear();
});
watch(
  () => props.member?.active,
  (active) => {
    if (!active) {
      decrypted.value.clear();
      documentDrafts.clear();
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
    privatePolicy.value = undefined;
    accessNote.value = '';
    decrypted.value.clear();
    value.value = '';
    documentId.value = '';
    documentPopup.value = false;
    rolePopup.value = false;
    documentTarget.value = '';
    documentDrafts.clear();
    memberNames.value.clear();
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
  if (!(await refresh())) throw new ApiFailure('ACTION_REFRESH_REQUIRED');
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
    if (!documentTarget.value && previous) throw new Error('DOCUMENT_ID_CONFLICT');
    const version = (previous?.version ?? 0) + 1;
    const stored = privateDao.value
      ? await encryptDaoJson(
          props.dao.reference,
          m.memberId,
          id,
          version,
          currentEpoch.value,
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
      key_epoch: privateDao.value ? currentEpoch.value : '0',
    });
    if (disposed || domain !== context.value) return;
    documentDrafts.delete(documentTarget.value);
    documentId.value = '';
    documentTarget.value = '';
    value.value = '';
    documentPopup.value = false;
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
    await commitCurrentEpoch();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function commitCurrentEpoch() {
  const m = props.member,
    domain = context.value;
  if (!m || !isAdmin.value || !privateIdentityReady.value) throw new Error('ACCOUNT_KEY_MISMATCH');
  const epoch = currentEpoch.value;
  const prepared = await preparePrivateEpoch(props.dao.reference, m.memberId, epoch);
  if (
    domain !== context.value ||
    epoch !== currentEpoch.value ||
    !privateIdentityReady.value ||
    !signerReady.value
  )
    throw new Error('WALLET_CONTEXT_CHANGED');
  await transact('commitepoch', {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: m.memberId,
    epoch,
    commitment: prepared.commitment,
    self_grant: prepared.selfGrant,
  });
}
async function grantAccess(recipients?: string[]) {
  if (!isAdmin.value || !privateIdentityReady.value || !signerReady.value || !privatePolicy.value)
    return;
  const domain = context.value;
  busy.value = true;
  error.value = '';
  accessNote.value = '';
  try {
    if (!(await refresh())) throw new ApiFailure('PRIVATE_ACCESS_UNAVAILABLE');
    if (!epochReady.value) await commitCurrentEpoch();
    const records = content.value,
      m = props.member;
    if (!records || !m || domain !== context.value) throw new Error('WALLET_CONTEXT_CHANGED');
    const jobs = (accessPlan.value?.grants ?? [])
      .filter((g) => !recipients || recipients.includes(g.recipient.id))
      .slice(0, 20);
    const prepared = [];
    for (const job of jobs)
      prepared.push({
        ...job,
        envelope: await grantPrivateEpoch(
          props.dao.reference,
          m.memberId,
          job.recipient,
          job.epoch,
          records,
        ),
      });
    let completed = 0;
    for (const job of prepared) {
      const recipient = content.value?.members.find((person) => person.id === job.recipient.id);
      if (
        disposed ||
        domain !== context.value ||
        !privateIdentityReady.value ||
        !signerReady.value ||
        !recipient?.active ||
        recipient.encryption_key !== job.recipient.encryption_key
      )
        throw new Error('WALLET_CONTEXT_CHANGED');
      if (
        content.value?.keyGrants.some((g) => g.recipient === recipient.id && g.epoch === job.epoch)
      )
        continue;
      await transact('grantkey', {
        runtime: props.dao.reference.contract,
        dao_id: props.dao.reference.daoId,
        member_id: m.memberId,
        recipient: recipient.id,
        epoch: job.epoch,
        envelope: job.envelope,
      });
      completed++;
    }
    accessNote.value = `Prepared ${completed} private-access grants. Remaining grants and unavailable epochs are shown below.`;
  } catch (cause) {
    if (domain === context.value) error.value = friendlyError(cause);
  } finally {
    if (domain === context.value) busy.value = false;
  }
}
async function onAdmitted(signingKey?: string) {
  const domain = context.value;
  const loaded = await refresh();
  if (!signingKey || domain !== context.value) return;
  if (!loaded || !privatePolicy.value || !privateIdentityReady.value) {
    accessNote.value =
      'Member admitted. Private access is pending until the account and history policy are ready.';
    return;
  }
  const recipient = content.value?.members.find((m) => m.signing_key === signingKey);
  if (recipient) await grantAccess([recipient.id]);
}
async function verifyAccess() {
  const m = props.member,
    records = content.value,
    domain = context.value,
    fingerprint = accessFingerprint.value;
  if (!m?.active || !records || !privateIdentityReady.value) return;
  busy.value = true;
  error.value = '';
  try {
    const epochs = ownChecks.value.slice(0, 20);
    await verifyPrivateEpochs(props.dao.reference, m.memberId, epochs, records);
    if (
      disposed ||
      domain !== context.value ||
      fingerprint !== accessFingerprint.value ||
      !privateIdentityReady.value
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    for (const epoch of epochs) verifiedEpochs.value.add(epoch);
  } catch (cause) {
    if (domain === context.value) error.value = friendlyError(cause);
  } finally {
    if (domain === context.value) busy.value = false;
  }
}
async function checkHandover(departing: DaoContent['members'][number]) {
  if (!privateDao.value || !departing.admin) return;
  const fingerprint = accessFingerprint.value,
    confirmed = handoverConfirmed.value,
    chosen = successor.value,
    domain = context.value;
  if (!(await refresh())) throw new ApiFailure('PRIVATE_HANDOVER_REQUIRED');
  if (disposed || domain !== context.value || fingerprint !== accessFingerprint.value)
    throw new Error('WALLET_CONTEXT_CHANGED');
  if (!privatePolicy.value || !content.value) throw new ApiFailure('PRIVATE_HANDOVER_REQUIRED');
  validatePrivateHandover(content.value, privatePolicy.value, departing.id, chosen, confirmed);
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
    if (recipient.active) await checkHandover(recipient);
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
  const recipient = selected.value,
    nextAdmin = admin.value,
    nextReviewer = reviewer.value;
  if (!m || !recipient) return;
  busy.value = true;
  error.value = '';
  try {
    if (recipient.admin && !nextAdmin) await checkHandover(recipient);
    await transact('setroles', {
      runtime: props.dao.reference.contract,
      dao_id: props.dao.reference.daoId,
      member_id: m.memberId,
      target: recipient.id,
      admin: nextAdmin,
      reviewer: nextReviewer,
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
      if (current() && vaultUnlocked.value && props.member?.active) {
        downloadFile(opened.bytes, opened.metadata);
        return true;
      }
    } else {
      const metadata =
        document.metadata === '{}'
          ? {
              version: 1,
              filename: `document-${document.document_id}-v${document.version}.bin`,
              mediaType: 'application/octet-stream',
            }
          : JSON.parse(document.metadata);
      if (current()) {
        downloadFile(stored, FileMetadataSchema.parse(metadata));
        return true;
      }
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
  return false;
}
async function openManagedVersion(
  document: DaoContent['documents'][number],
): Promise<string | undefined> {
  if (document.cid)
    return (await retrieve(document))
      ? 'The verified file has been downloaded. Review it before accepting.'
      : undefined;
  if (document.envelope_version === 1) {
    await decrypt(document);
    return decrypted.value.get(document.id);
  }
  if ((await sha256Hex(new TextEncoder().encode(document.metadata))) !== document.commitment)
    throw new Error('DOCUMENT_INTEGRITY');
  return document.metadata;
}
</script>
<template>
  <div v-if="section === 'documents'" class="workspace-tools-toolbar">
    <WorkspaceTabs
      v-model="activeTab"
      prefix="documents"
      label="Document sections"
      :items="[
        { value: 'library', label: 'Library' },
        { value: 'legal', label: 'Constitution & legal' },
      ]"
    />
    <label v-if="activeTab === 'library'" class="workspace-tools-search"
      ><span class="sr-only">Search documents</span
      ><input v-model="search" type="search" placeholder="Document title or file name…"
    /></label>
    <label v-if="activeTab === 'library'" class="workspace-tools-filter"
      ><span class="sr-only">Document type</span
      ><select v-model="documentType">
        <option value="">All documents</option>
        <option value="file">Files</option>
        <option value="json">Structured documents</option>
      </select></label
    >
    <WorkspaceActions
      :add-label="activeTab === 'legal' ? 'Register managed document' : 'Add document'"
      :help-to="activeTab === 'legal' ? '/docs/governing-documents' : '/docs/documents'"
      :disabled="
        busy || uploadBusy || !content || (activeTab === 'legal' ? !isAdmin : !member?.active)
      "
      @add="activeTab === 'legal' ? registrationRequest++ : openDocument()"
    />
  </div>
  <div v-else class="workspace-tools-toolbar">
    <WorkspaceTabs
      v-model="activeTab"
      prefix="members"
      label="Member sections"
      :items="[
        { value: 'directory', label: 'Directory' },
        { value: 'applications', label: 'Applications' },
      ]"
    /><WorkspaceActions
      v-if="activeTab === 'applications'"
      :add-label="admissionLabel"
      help-to="/docs/members"
      :disabled="busy || !admissionAllowed"
      @add="admissionRequest++"
    />
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <details
    :open="!privateIdentityReady || !hasCurrentKey"
    v-if="privateDao && member?.active && content"
    class="panel narrow"
    aria-labelledby="private-access-title"
  >
    <summary id="private-access-title">Private data access</summary>
    <button class="text-button" :disabled="busy" @click="refresh">Refresh private access</button>
    <p v-if="privatePolicy">
      New members receive
      {{
        privatePolicy.historyPolicy === 'full-history'
          ? 'the full private history'
          : 'access from their joining epoch'
      }}
      when an administrator grants it.
    </p>
    <p v-else class="notice">
      The private-history policy could not be checked.
      <button class="text-button" :disabled="busy" @click="refresh">Retry</button>
    </p>
    <p v-if="!privateIdentityReady">
      Open this membership's original Daclify account to prepare or verify private access.
    </p>
    <Account v-if="!vaultUnlocked && isAdmin" access-setup />
    <p v-if="ownEpochs.length" role="status">
      {{ verifiedEpochs.size }} of {{ ownEpochs.length }} permitted epochs verified on this device.
    </p>
    <button
      class="secondary"
      :disabled="busy || !privateIdentityReady || !ownChecks.length"
      @click="verifyAccess"
    >
      Verify my private access
    </button>
    <p v-if="verifiedEpochs.size && verifiedEpochs.size === ownEpochs.length">
      Your granted keys decrypt correctly on this device. Test account recovery on another device
      before handing over administration.
    </p>
    <template v-if="isAdmin">
      <p>
        {{ accessPlan?.grants.length ?? 0 }} grants can be prepared.
        {{ accessPlan?.pending.length ?? 0 }} grants need an administrator who holds the original
        epoch keys.
      </p>
      <button
        :disabled="
          busy ||
          !privateIdentityReady ||
          !signerReady ||
          !privatePolicy ||
          (epochReady && !accessPlan?.grants.length)
        "
        @click="grantAccess()"
      >
        Prepare private access for members
      </button>
      <p class="field-help">
        Each approval prepares up to 20 grants. Completed grants remain valid if a later grant needs
        retrying.
      </p>
    </template>
  </details>
  <p v-if="accessNote" role="status">{{ accessNote }}</p>

  <template v-if="section === 'documents'">
    <div
      v-show="activeTab === 'legal'"
      id="documents-legal"
      role="tabpanel"
      aria-labelledby="documents-tab-legal"
    >
      <GoverningDocumentsPanel
        :key="context"
        :dao="dao"
        :member="member"
        :content="content"
        :open-version="openManagedVersion"
        :registration-request="registrationRequest"
        @updated="refresh"
      />
    </div>
    <div
      v-show="activeTab === 'library'"
      id="documents-library"
      role="tabpanel"
      aria-labelledby="documents-tab-library"
    >
      <details v-if="privateDao" class="panel narrow">
        <summary>Document access settings</summary>
        <p>Encryption epoch {{ currentEpoch }}</p>
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
          Ciphertext, memberships, votes and financial metadata remain public. Rotating a key
          protects future content; old access remains possible.
        </p>
        <button
          v-if="isAdmin && epochReady"
          class="secondary"
          :disabled="busy || !vaultUnlocked"
          @click="rotate"
        >
          Rotate future document key
        </button>
      </details>
      <div class="dao-grid">
        <article v-for="document in filteredDocuments" :key="document.id" class="panel">
          <div class="panel-heading">
            <h2>{{ documentLabel(document) }}</h2>
            <span class="pill">{{ document.envelope_version ? 'Encrypted' : 'Public' }}</span>
          </div>
          <p class="muted">{{ document.bytes }} bytes · {{ memberName(document.author) }}</p>
          <details>
            <summary>Content and download</summary>
            <pre v-if="!document.cid && document.envelope_version === 0" class="wrap">{{
              document.metadata
            }}</pre>
            <template v-else-if="document.envelope_version === 1 && !document.cid"
              ><p>Encrypted · epoch {{ document.key_epoch }}</p>
              <button
                :disabled="busy || !vaultUnlocked || !member?.active"
                @click="decrypt(document)"
              >
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
          </details>
          <button
            v-if="member?.active"
            type="button"
            class="secondary"
            :disabled="busy || uploadBusy"
            @click="openDocument(document)"
          >
            Add version
          </button>
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
      <p v-if="content && !latest.length" class="muted">No documents published yet.</p>
      <p v-else-if="content && !filteredDocuments.length" class="empty-state">
        No documents match these filters.
      </p>
    </div>
    <WorkspaceDialog
      v-model:open="documentPopup"
      class="document-dialog"
      :title="documentPopupTitle"
      :busy="busy || uploadBusy"
    >
      <p v-if="documentTarget">
        New version of {{ documentTargetLabel }}. Previous versions are retained.
      </p>
      <template v-if="format === 'json'"
        ><p class="field-help">
          Up to 4096 stored bytes.
          {{ privateDao ? 'Content is encrypted before publication.' : 'Content will be public.' }}
        </p>
        <form @submit.prevent="publish">
          <label for="json-value">JSON content</label
          ><textarea
            :disabled="busy"
            id="json-value"
            v-model="value"
            rows="5"
            required
            spellcheck="false"
          ></textarea
          ><button :disabled="busy || !signerReady || (privateDao && !vaultUnlocked)">
            {{ busy ? 'Publishing…' : privateDao ? 'Encrypt and publish JSON' : 'Publish JSON' }}
          </button>
        </form>
      </template>
      <FilePanel
        v-if="member"
        v-show="format === 'file'"
        :key="context"
        :dao="dao"
        :member="member"
        :content="content"
        :selected-document-id="documentId"
        :new-document="!documentTarget"
        @busy="uploadBusy = $event"
        @pending="uploadPending = $event"
        @published="filePublished"
      />

      <details class="settings-advanced" :open="format === 'json'">
        <summary>Other formats</summary>
        <label for="document-format">Document format</label>
        <select
          id="document-format"
          v-model="format"
          :disabled="busy || uploadBusy || uploadPending"
        >
          <option value="file">File upload</option>
          <option value="json">Small structured document (JSON)</option>
        </select>
      </details>

      <p v-if="format === 'json' && !signerReady" class="notice">
        Choose an authorized signer before publishing.
      </p>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
    </WorkspaceDialog>
  </template>
  <template v-else>
    <div
      v-show="activeTab === 'directory'"
      id="members-directory"
      role="tabpanel"
      aria-labelledby="members-tab-directory"
    >
      <MemberDirectory
        v-if="content"
        :dao="dao.reference"
        :members="content.members"
        :can-manage="isAdmin"
        @names="memberNames = $event"
        @manage="manageMember"
      >
        <template #toolbar-actions
          ><WorkspaceActions
            :add-label="admissionLabel"
            help-to="/docs/members"
            :disabled="busy || !admissionAllowed"
            @add="admissionRequest++"
        /></template>
      </MemberDirectory>
    </div>
    <AdmissionPanel
      :key="context"
      :dao="dao"
      :member="member"
      :content="content"
      :create-request="admissionRequest"
      @can-create="admissionAllowed = $event"
      @creation-label="admissionLabel = $event"
      :show-applications="activeTab === 'applications'"
      @admitted="onAdmitted"
    />
    <WorkspaceDialog v-model:open="rolePopup" :title="`Manage ${memberName(target)}`" :busy="busy">
      <section v-if="isAdmin" class="panel narrow">
        <p>Review {{ memberName(target) }}’s roles, voting credits and document access.</p>
        <section v-if="privateDao && selected?.active && selected.admin" class="handover-check">
          <h4>Prepare an administrator handover</h4>
          <p>
            Another active administrator needs every recorded private epoch before this
            administrator leaves or is demoted.
          </p>
          <p v-if="!successors.length" class="notice">
            No remaining administrator has every recorded grant. Prepare their private access first.
          </p>
          <p
            v-if="!successors.length && privatePolicy?.historyPolicy === 'from-join'"
            class="field-help"
          >
            Members who joined later cannot receive earlier epochs under this DAO's history policy.
            Keep an administrator who already has that history.
          </p>
          <label for="private-successor">Administrator keeping private access</label>
          <select id="private-successor" v-model="successor" :disabled="busy">
            <option value="" disabled>Choose an administrator with all grants</option>
            <option v-for="person in successors" :key="person.id" :value="person.id">
              {{ memberName(person.id) }}
            </option>
          </select>
          <label class="checkbox"
            ><input
              v-model="handoverConfirmed"
              type="checkbox"
              :disabled="busy || !successor"
            />This administrator verified private access and tested account recovery on another
            device.</label
          >
          <p class="field-help">
            After departure, the remaining administrator prepares the new epoch and grants it to
            active members.
          </p>
        </section>
        <button
          v-if="selected"
          class="secondary"
          :disabled="busy || !signerReady"
          @click="activate"
        >
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
      </section>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
    </WorkspaceDialog>
  </template>
</template>
