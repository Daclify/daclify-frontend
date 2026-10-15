<script setup lang="ts">
import WorkspaceDialog from './WorkspaceDialog.vue';
import { documentLabel } from '../content/document-labels';
import type { ReviewedDocument } from '../content/document-review';
import { formatHelpAnswer } from '../help/format';
import { downloadFile } from '../content/files';
import { prepareBallotVote } from '@daclify/modules/sdk';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { DaoContent, DaoSummary, UserMembership } from '@daclify/core-protocol';
import {
  GoverningDocumentCategories,
  GoverningDocumentStatuses,
  type GoverningDocumentPage,
} from '@daclify/modules';
import { encodeDecide, type DecideActions } from '@daclify/modules/sdk';
import { makeInstruction } from '@daclify/core-protocol/sdk';
import { api, ApiFailure, friendlyError } from '../api/client';
import { relayInstruction, vaultUnlocked } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { useWorkspace } from '../state/workspace';

const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  content: DaoContent | undefined;
  registrationRequest?: number;
  openVersion: (document: DaoContent['documents'][number]) => Promise<ReviewedDocument | undefined>;
}>();
const emit = defineEmits<{ updated: [] }>();
const workspace = useWorkspace();
type Registration = GoverningDocumentPage['registrations'][number];
type Change = GoverningDocumentPage['changes'][number];
const categories = GoverningDocumentCategories;
const now = ref(Math.floor(Date.now() / 1000));
const clock = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
}, 1000);
const data = ref<GoverningDocumentPage>(),
  history = ref(new Map<string, GoverningDocumentPage>());
const acceptances = ref(new Map<string, GoverningDocumentPage>());
const opened = ref(new Map<string, ReviewedDocument>()),
  confirmed = ref(new Set<string>());
const documentId = ref(''),
  category = ref(0),
  approval = ref(0),
  track = ref(true);
const registrationPopup = ref(false);
watch(
  () => props.registrationRequest,
  (value) => {
    if (value && admin.value) registrationPopup.value = true;
  },
);
function documentName(id: string) {
  const row = props.content?.documents
    .filter((doc) => doc.document_id === id)
    .sort((a, b) => b.version - a.version)[0];
  return row ? documentLabel(row) : `Document ${id}`;
}
function registeredName(row: Registration) {
  const adoption = change(row.adopted_id);
  const document = adoption ? documentFor(adoption) : undefined;
  return document ? documentLabel(document) : documentName(row.document_id);
}
const versions = ref(new Map<string, number>());
const busy = ref(false),
  loading = ref(true),
  error = ref(''),
  notice = ref('');
const admin = computed(() => !!props.member?.active && props.member.admin);
const signer = computed(() => canSignMember(props.member));
const context = computed(() =>
  JSON.stringify([
    props.dao.reference,
    workspace.account?.id,
    workspace.account?.signingKey,
    workspace.account?.encryptionKey,
    props.member?.signingKey,
    props.dao.keyEpoch,
    props.member?.memberId,
    props.member?.active,
    props.dao.privacy,
  ]),
);
const uploaded = computed(() => {
  const ids = new Set(props.content?.documents.map((doc) => doc.document_id) ?? []);
  for (const registration of data.value?.registrations ?? []) ids.delete(registration.document_id);
  return [...ids];
});
let disposed = false,
  generation = 0;
onBeforeUnmount(() => {
  clearInterval(clock);
  disposed = true;
  generation++;
  opened.value.clear();
  confirmed.value.clear();
});
const current = (domain: string, request: number) =>
  !disposed && domain === context.value && request === generation;
function assertDao(page: GoverningDocumentPage) {
  if (JSON.stringify(page.dao) !== JSON.stringify(props.dao.reference))
    throw new Error('DAO_REFERENCE');
}
async function load(more = false) {
  const domain = context.value,
    request = ++generation;
  loading.value = true;
  error.value = '';
  try {
    const page = await api.governingDocuments(props.dao.reference.daoId, {
      ...(more && data.value?.next ? { after: data.value.next } : {}),
      ...(props.member ? { memberId: props.member.memberId } : {}),
    });
    if (!current(domain, request)) return;
    assertDao(page);
    if (more && data.value) {
      if (page.next && BigInt(page.next) <= BigInt(data.value.next ?? '0'))
        throw new Error('CHAIN_RESPONSE_INVALID');
      data.value = {
        ...page,
        registrations: [...data.value.registrations, ...page.registrations],
        changes: [...data.value.changes, ...page.changes],
        ballots: [...data.value.ballots, ...page.ballots],
        ballotDefinitions: [...data.value.ballotDefinitions, ...page.ballotDefinitions],
        votes: [...data.value.votes, ...page.votes],
        acceptedAdoptionIds: [...data.value.acceptedAdoptionIds, ...page.acceptedAdoptionIds],
      };
    } else {
      data.value = page;
      history.value.clear();
      acceptances.value.clear();
    }
  } catch (cause) {
    if (current(domain, request)) {
      error.value = friendlyError(cause);
      if (!more) data.value = undefined;
    }
  } finally {
    if (current(domain, request)) loading.value = false;
  }
}
watch(
  context,
  () => {
    busy.value = false;
    notice.value = '';
    data.value = undefined;
    opened.value.clear();
    confirmed.value.clear();
    versions.value.clear();
    documentId.value = '';
    void load();
  },
  { immediate: true },
);
watch(
  () => props.content,
  () => {
    opened.value.clear();
    confirmed.value.clear();
  },
);
watch(vaultUnlocked, () => {
  opened.value.clear();
  confirmed.value.clear();
});
function change(id: string) {
  return data.value?.changes.find((row) => row.id === id);
}
function documentFor(row: Change) {
  return props.content?.documents.find(
    (doc) =>
      doc.document_id === row.document_id &&
      doc.version === row.document_version &&
      doc.commitment === row.commitment,
  );
}
function candidates(row: Registration) {
  return (props.content?.documents ?? [])
    .filter(
      (doc) =>
        doc.document_id === row.document_id &&
        doc.version > (change(row.adopted_id)?.document_version ?? 0),
    )
    .sort((a, b) => b.version - a.version);
}
function ballot(row: Change) {
  return data.value?.ballots.find((item) => item.id === row.ballot_id);
}
function allowed(action: string) {
  return (
    !!data.value?.available &&
    !!data.value.module?.enabled &&
    !!props.member?.active &&
    signer.value &&
    !!data.value.module?.actions.includes(action)
  );
}
function time(seconds: number) {
  return new Date(seconds * 1000).toLocaleString();
}
function status(row: Change) {
  return GoverningDocumentStatuses[row.status] ?? 'Unknown';
}
async function run<K extends keyof DecideActions>(
  action: K,
  args: DecideActions[K],
  message: string,
) {
  const module = data.value?.module,
    member = props.member;
  if (busy.value || !module || !member || !allowed(action)) return;
  const domain = context.value;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        props.dao.reference,
        member.memberId,
        member.nonce,
        now.value + 300,
        module.deployment.account,
        action,
        encodeDecide(action, args),
      ),
    );
    if (disposed || domain !== context.value) return;
    await workspace.refresh();
    if (disposed || domain !== context.value) return;
    opened.value.clear();
    confirmed.value.clear();
    await load();
    emit('updated');
    if (!disposed && domain === context.value) notice.value = message;
  } catch (cause) {
    if (!disposed && domain === context.value) error.value = friendlyError(cause);
  } finally {
    if (!disposed && domain === context.value) busy.value = false;
  }
}
function actor() {
  if (!props.member) throw new Error('MEMBER_UNKNOWN');
  return {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: props.member.memberId,
  };
}
function selectVersion(id: string, event: Event) {
  if (event.target instanceof HTMLSelectElement) versions.value.set(id, Number(event.target.value));
}
async function register() {
  if (!admin.value || !uploaded.value.includes(documentId.value)) return;
  await run(
    'regdoc',
    {
      ...actor(),
      document_id: documentId.value,
      category: category.value,
      approval: approval.value,
      track_acceptance: track.value,
    },
    'Document registered. Propose a version to adopt it.',
  );
  if (notice.value) {
    documentId.value = '';
    registrationPopup.value = false;
  }
}
async function propose(row: Registration) {
  if (!admin.value) return;
  const version = versions.value.get(row.id) ?? candidates(row)[0]?.version;
  if (!version) return;
  await run(
    'proposedoc',
    {
      ...actor(),
      register_id: row.id,
      document_version: version,
      expected_revision: row.revision,
      ballot_id: row.approval ? String(Date.now()) : '0',
    },
    row.approval
      ? 'Member vote opened for this version.'
      : 'Version proposed for administrator approval.',
  );
}
async function open(row: Change) {
  const document = documentFor(row),
    domain = context.value,
    request = generation;
  if (!document || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const text = await props.openVersion(document);
    if (!current(domain, request)) return;
    if (text === undefined) throw new Error('DOCUMENT_CONTENT_UNAVAILABLE');
    opened.value.set(row.id, text);
  } catch (cause) {
    if (current(domain, request)) error.value = friendlyError(cause);
  } finally {
    if (current(domain, request)) busy.value = false;
  }
}
function downloadOpened(id: string) {
  const file = opened.value.get(id)?.file;
  if (file) downloadFile(file.bytes, file.metadata);
}
async function adopt(row: Change) {
  if (!opened.value.has(row.id)) return;
  await run(
    'adoptdoc',
    { ...actor(), proposal_id: row.id },
    'Version adopted. New uploads remain drafts until approved.',
  );
}
async function acknowledge(row: Change) {
  if (!opened.value.has(row.id) || !confirmed.value.has(row.id)) return;
  const domain = context.value;
  try {
    const latest = await api.governingDocuments(props.dao.reference.daoId, {
      registerId: row.register_id,
    });
    if (disposed || domain !== context.value) return;
    assertDao(latest);
    if (
      !latest.available ||
      latest.registrations.find((item) => item.id === row.register_id)?.adopted_id !== row.id
    ) {
      opened.value.clear();
      confirmed.value.clear();
      await load();
      emit('updated');
      throw new ApiFailure('DOCUMENT_ADOPTION_CHANGED');
    }
    if (!opened.value.has(row.id) || !confirmed.value.has(row.id)) return;
  } catch (cause) {
    if (!disposed && domain === context.value) error.value = friendlyError(cause);
    return;
  }
  await run(
    'ackdoc',
    { ...actor(), adoption_id: row.id },
    'Your acceptance of this version is recorded.',
  );
}
function stale(row: Change) {
  return (
    row.source_hash !== data.value?.module?.deployment.codeHash ||
    (row.ballot_id !== '0' && data.value?.policyRevision !== row.policy_revision)
  );
}
async function clear(row: Change) {
  if (busy.value) return;
  const domain = context.value;
  busy.value = true;
  error.value = '';
  try {
    await api.clearGoverningDocuments({ dao: props.dao.reference, proposalIds: [row.id] });
    if (!disposed && domain === context.value) {
      await load();
      notice.value = 'Proposal cleared. You can propose another version.';
    }
  } catch (cause) {
    if (!disposed && domain === context.value) error.value = friendlyError(cause);
  } finally {
    if (!disposed && domain === context.value) busy.value = false;
  }
}
function voteReviewError(row: Change): string {
  const poll = ballot(row),
    module = data.value?.module;
  if (!poll || !module || !data.value) return 'The document ballot is unavailable.';
  try {
    prepareBallotVote({
      dao: props.dao.reference,
      decide: module.deployment.account,
      memberId: props.member?.memberId ?? poll.creator,
      ballot: poll,
      definitions: data.value.ballotDefinitions,
      choice: 0,
      documentChange: row,
    });
    return '';
  } catch (cause) {
    return friendlyError(cause);
  }
}
function voteAction(row: Change) {
  return data.value?.ballotDefinitions.some((item) => item.ballot_id === row.ballot_id)
    ? 'votecommit'
    : 'vote';
}
async function vote(row: Change, choice: number) {
  if (!opened.value.has(row.id)) return;
  const poll = data.value?.ballots.find((value) => value.id === row.ballot_id),
    module = data.value?.module;
  if (!poll || !module || !data.value || !props.member) return;
  try {
    const prepared = prepareBallotVote({
      dao: props.dao.reference,
      decide: module.deployment.account,
      memberId: props.member.memberId,
      ballot: poll,
      definitions: data.value.ballotDefinitions,
      choice,
      documentChange: row,
    });
    await run(prepared.action, prepared.fields, 'Your vote on this document version is recorded.');
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function finalize(row: Change) {
  const domain = context.value;
  busy.value = true;
  error.value = '';
  try {
    await api.finalize({ dao: props.dao.reference, ballotId: row.ballot_id });
    if (!disposed && domain === context.value) {
      await load();
      await workspace.refresh();
    }
  } catch (cause) {
    if (!disposed && domain === context.value) error.value = friendlyError(cause);
  } finally {
    if (!disposed && domain === context.value) busy.value = false;
  }
}
async function details(kind: 'history' | 'acceptances', id: string, more = false) {
  const domain = context.value,
    request = generation,
    store = kind === 'history' ? history.value : acceptances.value;
  busy.value = true;
  error.value = '';
  try {
    const previous = store.get(id),
      page = await api.governingDocuments(props.dao.reference.daoId, {
        ...(kind === 'history' ? { registerId: id } : { adoptionId: id }),
        ...(more && previous?.next ? { after: previous.next } : {}),
      });
    if (!current(domain, request)) return;
    assertDao(page);
    if (more && previous?.next && page.next && BigInt(page.next) <= BigInt(previous.next))
      throw new Error('CHAIN_RESPONSE_INVALID');
    store.set(
      id,
      more && previous
        ? {
            ...page,
            changes: [...previous.changes, ...page.changes],
            acceptances: [...previous.acceptances, ...page.acceptances],
          }
        : page,
    );
  } catch (cause) {
    if (current(domain, request)) error.value = friendlyError(cause);
  } finally {
    if (current(domain, request)) busy.value = false;
  }
}
</script>
<template>
  <section class="panel governing-documents" aria-labelledby="governing-heading">
    <div class="panel-heading">
      <h2 id="governing-heading">Constitution and legal documents</h2>
      <RouterLink class="help-link" to="/docs/governing-documents">Help ↗</RouterLink>
    </div>
    <p>Keep an official version, approve amendments and record member acceptance.</p>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loading && !data" role="status">Loading document register…</p>
    <template v-if="data?.available">
      <p v-if="!data.module?.enabled" class="muted">
        Enable Decide to make changes to this register. Adopted documents and acceptance history
        remain available.
      </p>
      <WorkspaceDialog
        v-model:open="registrationPopup"
        title="Register managed document"
        :busy="busy"
      >
        <form @submit.prevent="register" class="document-register-form">
          <label for="managed-document">Managed document</label
          ><select id="managed-document" v-model="documentId" required :disabled="busy">
            <option value="" disabled>Choose an uploaded document</option>
            <option v-for="id in uploaded" :key="id" :value="id">{{ documentName(id) }}</option>
          </select>
          <label for="managed-category">Document type</label
          ><select id="managed-category" v-model="category" :disabled="busy">
            <option
              v-for="(label, index) in categories"
              :key="label"
              :value="index"
              :disabled="index === 0 && data.registrations.some((row) => row.category === 0)"
            >
              {{ label }}
            </option>
          </select>
          <label for="managed-approval">Approval</label
          ><select id="managed-approval" v-model="approval" :disabled="busy">
            <option :value="0">Administrator approval</option>
            <option :value="1" :disabled="data.policyRevision === null">Member vote</option>
          </select>
          <label class="checkbox"
            ><input v-model="track" type="checkbox" :disabled="busy" />Track member
            acceptance</label
          >
          <p class="field-help">
            Approval and acceptance settings stay fixed for this document. A DAO can have one
            registered constitution.
          </p>
          <button :disabled="busy || !documentId || !allowed('regdoc')">Register document</button>
          <p v-if="!uploaded.length" class="field-help">
            Add a document in the Library before registering it.
          </p>
        </form>
        <p v-if="error" role="alert" class="alert">{{ error }}</p>
      </WorkspaceDialog>
      <p v-if="!data.registrations.length" class="muted">No managed documents registered yet.</p>
      <article
        v-for="registered in data.registrations"
        :key="registered.id"
        class="managed-document"
      >
        <div class="panel-heading">
          <h3>{{ categories[registered.category] }} · {{ registeredName(registered) }}</h3>
          <span class="pill">{{
            registered.approval ? 'Member vote' : 'Administrator approval'
          }}</span>
        </div>
        <template v-for="adopted in [change(registered.adopted_id)]" :key="registered.adopted_id">
          <section v-if="adopted" class="adopted-version">
            <p class="adopted-label">Adopted version {{ adopted.document_version }}</p>
            <p class="muted">{{ time(adopted.adopted_at) }} · member {{ adopted.adopted_by }}</p>
            <button
              class="secondary"
              :disabled="busy || !documentFor(adopted)"
              @click="open(adopted)"
            >
              Open adopted version {{ adopted.document_version }}
            </button>
            <template v-if="opened.has(adopted.id)"><div v-if="opened.get(adopted.id)?.markdown !== undefined" class="legal-preview" v-html="formatHelpAnswer(opened.get(adopted.id)?.markdown ?? '')" /><pre v-else class="wrap">{{ opened.get(adopted.id)?.text }}</pre><button v-if="opened.get(adopted.id)?.file" class="secondary" @click="downloadOpened(adopted.id)">Download reviewed file</button></template>
            <p v-else-if="!documentFor(adopted)" class="field-help">
              This version is unavailable. Restore it or ask an administrator for permitted document
              access.
            </p>
            <template v-if="registered.track_acceptance">
              <p v-if="data.acceptedAdoptionIds.includes(adopted.id)">
                You accepted version {{ adopted.document_version }}.
              </p>
              <div v-else-if="member?.active">
                <label class="checkbox"
                  ><input
                    type="checkbox"
                    :checked="confirmed.has(adopted.id)"
                    :disabled="busy || !opened.has(adopted.id)"
                    @change="
                      confirmed.has(adopted.id)
                        ? confirmed.delete(adopted.id)
                        : confirmed.add(adopted.id)
                    "
                  />I reviewed and accept version {{ adopted.document_version }}.</label
                >
                <button
                  :disabled="
                    busy ||
                    !opened.has(adopted.id) ||
                    !confirmed.has(adopted.id) ||
                    !allowed('ackdoc')
                  "
                  @click="acknowledge(adopted)"
                >
                  Sign acceptance
                </button>
              </div>
              <p class="field-help">
                Acceptance records this version for your DAO membership. It does not change your
                permissions.
              </p>
              <details>
                <summary>Member acceptance records</summary>
                <button
                  class="secondary"
                  :disabled="busy"
                  @click="details('acceptances', adopted.id)"
                >
                  Load acceptance records
                </button>
                <p v-for="record in acceptances.get(adopted.id)?.acceptances" :key="record.id">
                  Member {{ record.member_id }} · {{ time(record.accepted_at) }}
                </p>
                <button
                  v-if="acceptances.get(adopted.id)?.next"
                  class="secondary"
                  :disabled="busy"
                  @click="details('acceptances', adopted.id, true)"
                >
                  Load more acceptance records
                </button>
              </details>
            </template>
          </section>
          <p v-else class="muted">No adopted version yet.</p>
        </template>
        <template v-for="pending in [change(registered.pending_id)]" :key="registered.pending_id">
          <section v-if="pending" class="pending-version">
            <h5>Proposed version {{ pending.document_version }}</h5>
            <p>
              {{ registered.approval ? 'Awaiting member vote' : 'Awaiting administrator approval' }}
            </p>
            <p class="field-help">
              Expires {{ time(pending.deadline) }}. The adopted version stays in effect until
              approval.
            </p>
            <button
              class="secondary"
              :disabled="busy || !documentFor(pending)"
              @click="open(pending)"
            >
              Open proposed version {{ pending.document_version }}
            </button>
            <template v-if="opened.has(pending.id)"><div v-if="opened.get(pending.id)?.markdown !== undefined" class="legal-preview" v-html="formatHelpAnswer(opened.get(pending.id)?.markdown ?? '')" /><pre v-else class="wrap">{{ opened.get(pending.id)?.text }}</pre><button v-if="opened.get(pending.id)?.file" class="secondary" @click="downloadOpened(pending.id)">Download reviewed file</button></template>
            <template v-if="registered.approval && ballot(pending)">
              <p>
                Vote closes {{ time(ballot(pending)?.closes ?? 0) }} · quorum
                {{ (ballot(pending)?.quorum ?? 0) / 100 }}% · approval
                {{ (ballot(pending)?.approval ?? 0) / 100 }}%
              </p>
              <p v-if="voteReviewError(pending)" role="alert" class="alert">
                {{ voteReviewError(pending) }}
              </p>
              <div class="document-actions" v-if="ballot(pending)?.status === 0">
                <template v-if="(ballot(pending)?.closes ?? 0) > now">
                  <button
                    :disabled="
                      busy ||
                      !opened.has(pending.id) ||
                      !allowed(voteAction(pending)) ||
                      !!voteReviewError(pending) ||
                      data.votes.some(
                        (row) =>
                          row.ballot === pending.ballot_id && row.member === member?.memberId,
                      )
                    "
                    @click="vote(pending, 1)"
                  >
                    Approve version {{ pending.document_version }}
                  </button>
                  <button
                    class="secondary"
                    :disabled="
                      busy ||
                      !opened.has(pending.id) ||
                      !allowed(voteAction(pending)) ||
                      !!voteReviewError(pending) ||
                      data.votes.some(
                        (row) =>
                          row.ballot === pending.ballot_id && row.member === member?.memberId,
                      )
                    "
                    @click="vote(pending, 0)"
                  >
                    Reject version {{ pending.document_version }}
                  </button>
                </template>
                <button v-else :disabled="busy || !member?.active" @click="finalize(pending)">
                  Finalize document vote
                </button>
              </div>
              <p v-else>{{ ballot(pending)?.status === 1 ? 'Vote passed' : 'Vote rejected' }}</p>
            </template>
            <p v-if="stale(pending)" class="notice">
              Approval rules changed. Cancel this proposal and request fresh approval.
            </p>
            <button
              v-if="pending.deadline < now || ballot(pending)?.status === 2"
              class="secondary"
              :disabled="busy || !member || !data.module?.enabled"
              @click="clear(pending)"
            >
              Clear rejected or expired proposal
            </button>
            <div class="document-actions">
              <button
                v-if="
                  (!registered.approval && admin) ||
                  (registered.approval && ballot(pending)?.status === 1)
                "
                :disabled="
                  busy ||
                  !opened.has(pending.id) ||
                  !allowed('adoptdoc') ||
                  pending.deadline < now ||
                  stale(pending)
                "
                @click="adopt(pending)"
              >
                Adopt version {{ pending.document_version }}
              </button>
              <button
                v-if="admin && (ballot(pending)?.status !== 1 || stale(pending))"
                class="secondary"
                :disabled="busy || !allowed('canceldoc')"
                @click="
                  run(
                    'canceldoc',
                    { ...actor(), proposal_id: pending.id },
                    'Proposal cancelled. The adopted version is unchanged.',
                  )
                "
              >
                Cancel proposal
              </button>
            </div>
          </section>
        </template>
        <form
          v-if="
            admin &&
            data.module?.enabled &&
            registered.pending_id === '0' &&
            candidates(registered).length
          "
          @submit.prevent="propose(registered)"
          class="document-proposal-form"
        >
          <label :for="`proposed-version-${registered.id}`">Draft version to propose</label
          ><select
            :id="`proposed-version-${registered.id}`"
            :value="versions.get(registered.id) ?? candidates(registered)[0]?.version"
            :disabled="busy"
            @change="selectVersion(registered.id, $event)"
          >
            <option v-for="doc in candidates(registered)" :key="doc.id" :value="doc.version">
              Version {{ doc.version }} · draft
            </option>
          </select>
          <button :disabled="busy || !allowed('proposedoc')">Propose version</button>
        </form>
        <details>
          <summary>Amendment history</summary>
          <button class="secondary" :disabled="busy" @click="details('history', registered.id)">
            Load amendment history
          </button>
          <div v-for="revision in history.get(registered.id)?.changes" :key="revision.id">
            <p>
              Version {{ revision.document_version }} · {{ status(revision) }} ·
              {{ time(revision.proposed_at) }}
            </p>
            <button
              v-if="revision.status === 1 && registered.track_acceptance"
              class="secondary"
              :disabled="busy"
              @click="details('acceptances', revision.id)"
            >
              Acceptance records for version {{ revision.document_version }}
            </button>
            <p v-for="record in acceptances.get(revision.id)?.acceptances" :key="record.id">
              Member {{ record.member_id }} · {{ time(record.accepted_at) }}
            </p>
            <button
              v-if="acceptances.get(revision.id)?.next"
              class="secondary"
              :disabled="busy"
              @click="details('acceptances', revision.id, true)"
            >
              Load more acceptance records
            </button>
          </div>
          <button
            v-if="history.get(registered.id)?.next"
            class="secondary"
            :disabled="busy"
            @click="details('history', registered.id, true)"
          >
            Load more amendment history
          </button>
        </details>
      </article>
      <button v-if="data.next" class="secondary" :disabled="busy || loading" @click="load(true)">
        Load more managed documents
      </button>
    </template>
    <p v-else-if="data">Formal document management is unavailable for this deployment.</p>
    <button v-if="error && !data" class="secondary" :disabled="loading" @click="load()">
      Retry document register
    </button>
  </section>
</template>
<style scoped>
.legal-preview { overflow-wrap: anywhere; max-height: 55dvh; overflow: auto; padding: 16px; }
.legal-preview :deep(table) { display: block; max-width: 100%; overflow-x: auto; }
.governing-documents {
  margin-bottom: 1.5rem;
  min-width: 0;
}
.managed-document {
  border-top: 1px solid var(--line);
  margin-top: 1.5rem;
  padding-top: 1.25rem;
}
.document-register-form,
.document-proposal-form {
  max-width: 36rem;
  margin-top: 1rem;
}
.document-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-block: 1rem;
}
.adopted-version,
.pending-version {
  margin-block: 1rem;
}
.adopted-label {
  font-weight: 700;
  color: var(--accent-amber);
}
.pending-version {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 1rem;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
h4,
h5 {
  font-size: 1rem;
}
</style>
