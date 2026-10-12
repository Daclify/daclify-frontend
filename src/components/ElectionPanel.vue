<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { z } from 'zod';
import { readableDuration } from '../content/governance-inputs';
import type {
  DaoContent,
  DaoSummary,
  UserMembership,
  GovernanceState,
} from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
import { encodeDecide, type DecideActions } from '@daclify/modules/sdk';
import { api, friendlyError } from '../api/client';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  data: ModuleState;
  governance: GovernanceState | undefined;
  canSign: boolean;
  canFinalize: boolean;
  busy: boolean;
  actionError: string;
  actionSuccess: string;
  now: number;
  run: (target: string, action: string, payload: Uint8Array, message: string) => Promise<void>;
  finalize: (id: string) => Promise<void>;
}>();
const module = computed(() => props.data.modules.find((m) => m.deployment.id === 'decide'));
const title = ref('Community council'),
  purpose = ref('representative'),
  rulesDocument = ref(''),
  seats = ref(1),
  error = ref(''),
  choice = ref<Record<string, number>>({}),
  reviewed = ref<Record<string, boolean>>({}),
  recallDocuments = ref<Record<string, string>>({});
const dialog = ref<HTMLDialogElement>();
const documents = ref<DaoContent>();
const documentsLoading = ref(false),
  documentsError = ref('');
let disposed = false,
  documentRequest = 0;
onBeforeUnmount(() => {
  disposed = true;
  documentRequest++;
  dialog.value?.close();
});
const documentLabelSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  filename: z.string().optional(),
  text: z.string().optional(),
});
function documentLabel(document: DaoContent['documents'][number]) {
  const fallback = `${document.envelope_version === 0 ? 'DAO' : 'Private'} document #${document.document_id}`;
  let name = fallback;
  if (document.envelope_version === 0) {
    try {
      const value = documentLabelSchema.parse(JSON.parse(document.metadata));
      name =
        (value.title || value.name || value.filename || value.text || fallback)
          .trim()
          .slice(0, 100) || fallback;
    } catch {
      /* Untitled documents keep a stable reference. */
    }
  }
  return `${name} · version ${document.version}`;
}
const documentOptions = computed(() =>
  [...(documents.value?.documents ?? [])].sort((a, b) =>
    a.document_id === b.document_id
      ? b.version - a.version
      : BigInt(a.document_id) < BigInt(b.document_id)
        ? -1
        : 1,
  ),
);
const selectedRules = computed(() =>
  documents.value?.documents.find((d) => d.id === rulesDocument.value),
);
function recallReason(termId: string) {
  return documents.value?.documents.find((d) => d.id === recallDocuments.value[termId]);
}
async function loadDocuments() {
  const request = ++documentRequest;
  documentsLoading.value = true;
  documentsError.value = '';
  try {
    const page = await api.content(props.dao.reference.daoId);
    if (disposed || request !== documentRequest) return;
    if (JSON.stringify(page.dao) !== JSON.stringify(props.dao.reference))
      throw new Error('DAO_REFERENCE');
    documents.value = page;
  } catch (cause) {
    if (!disposed && request === documentRequest) {
      documents.value = undefined;
      documentsError.value = friendlyError(cause);
    }
  } finally {
    if (!disposed && request === documentRequest) documentsLoading.value = false;
  }
}
function showDialog() {
  if (props.busy || !props.member?.active || !props.member.admin || !module.value?.enabled) return;
  error.value = '';
  dialog.value?.showModal();
  void loadDocuments();
}
defineExpose({ showDialog });
function recallToggle(event: Event) {
  if (
    event.target instanceof HTMLDetailsElement &&
    event.target.open &&
    !documents.value &&
    !documentsLoading.value
  )
    void loadDocuments();
}
function dateInput(offset: number) {
  const d = new Date(Date.now() + offset * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const nominationClose = ref(dateInput(86400)),
  termStart = ref(dateInput(604800)),
  termEnd = ref(dateInput(3196800));
function seconds(value: string) {
  const n = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('TIME_RANGE');
  return n;
}
const timingError = computed(() => {
  try {
    const closes = seconds(nominationClose.value),
      starts = seconds(termStart.value),
      ends = seconds(termEnd.value);
    if (closes <= props.now || closes > props.now + 30 * 86400)
      return 'Close nominations within the next 30 days.';
    if (starts <= closes + (props.governance?.policy?.config.duration ?? 0))
      return 'Start the term after nominations close and the DAO voting period finishes.';
    if (ends <= starts || ends - starts > 365 * 86400)
      return 'End the term after it starts, within one year.';
    return '';
  } catch {
    return 'Choose a valid date and time for each stage.';
  }
});
function newId() {
  const v = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(v[0] ?? 0) << 32n) | BigInt(v[1] ?? 0) || 1n).toString();
}
function actor() {
  if (!props.member) throw new Error('AUTH_REQUIRED');
  return {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: props.member.memberId,
  };
}
function allowed(action: string) {
  return (
    props.canSign &&
    module.value?.enabled &&
    module.value.compatible &&
    module.value.codeVerified &&
    module.value.actions.includes(action)
  );
}
async function sign<K extends keyof DecideActions>(
  action: K,
  data: DecideActions[K],
  message: string,
) {
  try {
    if (!module.value || !allowed(action)) return;
    error.value = '';
    await props.run(module.value.deployment.account, action, encodeDecide(action, data), message);
    reviewed.value = {};
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function create() {
  if (
    !props.member?.admin ||
    !props.member.active ||
    !selectedRules.value ||
    documentsLoading.value ||
    timingError.value ||
    !props.governance?.policy
  )
    return;
  const message = 'Election scheduled. Members nominate themselves before the cutoff.';
  try {
    await sign(
      'newelect',
      {
        ...actor(),
        election_id: newId(),
        title: purpose.value === 'executive' ? 'Executives' : title.value,
        document_id: selectedRules.value.document_id,
        document_version: selectedRules.value.version,
        nomination_close: seconds(nominationClose.value),
        term_start: seconds(termStart.value),
        term_end: seconds(termEnd.value),
        seats: seats.value,
      },
      message,
    );
    if (!disposed && props.actionSuccess === message && !props.actionError) dialog.value?.close();
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function recall(termId: string) {
  const reason = recallReason(termId);
  if (!props.member?.admin || !props.member.active || !reason || documentsLoading.value) return;
  await sign(
    'recall',
    {
      ...actor(),
      term_id: termId,
      document_id: reason.document_id,
      document_version: reason.version,
    },
    'Representative term recalled. Existing liabilities and permanent roles remain separate.',
  );
}

watch(
  () => props.data.elections,
  (records) => {
    for (const election of records) choice.value[election.id] ??= 0;
  },
  { immediate: true },
);
function ballot(id: string) {
  return props.data.ballots.find((b) => b.id === id);
}
function voted(id: string) {
  return props.data.votes.some((v) => v.ballot === id && v.member === props.member?.memberId);
}
function nominated(id: string) {
  return props.data.nominations.some(
    (n) => n.election_id === id && n.member_id === props.member?.memberId,
  );
}
function date(seconds: number) {
  return new Date(seconds * 1000).toLocaleString();
}
function termStatus(term: ModuleState['terms'][number]) {
  return term.recalled
    ? 'Recalled'
    : props.now >= term.ends
      ? 'Ended'
      : props.now < term.starts
        ? 'Scheduled'
        : 'Term window active';
}
</script>
<template>
  <section aria-label="DAO elections">
    <div class="section-toolbar">
      <h2>DAO elections</h2>
    </div>
    <p>
      Elect representatives for a fixed term, or explicitly elect executives to change the appointed
      roster. Representative titles grant no administrator, reviewer or Treasury powers.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <dialog
      v-if="member?.active && member.admin && module?.enabled"
      ref="dialog"
      class="panel election-dialog"
      aria-labelledby="election-dialog-title"
      @cancel="busy && $event.preventDefault()"
    >
      <header class="election-dialog-heading">
        <h2 id="election-dialog-title">Election and term rules</h2>
        <button
          type="button"
          class="election-close"
          aria-label="Close election form"
          :disabled="busy"
          @click="dialog?.close()"
        >
          <X :size="24" aria-hidden="true" />
        </button>
      </header>
      <p>
        Choose who to elect, publish the rules members will follow, and set the nomination and term
        dates.
      </p>
      <p v-if="error || actionError" class="alert" role="alert">{{ error || actionError }}</p>
      <p v-if="busy" role="status">Scheduling election…</p>
      <p v-else-if="!canSign" class="notice">
        Choose an authorized signer in Signing &amp; wallets before scheduling this election.
      </p>
      <p v-if="!governance?.policy" class="notice">
        Set a DAO voting policy in
        <RouterLink :to="`/dao/${dao.reference.daoId}/settings?settings=governance`"
          >Governance settings</RouterLink
        >
        before scheduling an election.
      </p>
      <form @submit.prevent="create">
        <fieldset :disabled="busy">
          <legend>Who are you electing?</legend>
          <div class="two-column">
            <label
              >Election purpose<select v-model="purpose" autofocus>
                <option value="representative">Representatives</option>
                <option
                  value="executive"
                  :disabled="!governance?.executivePolicy || !module?.grants.includes('electexec')"
                >
                  Executives
                </option>
              </select></label
            >
            <label
              >Number of seats<input v-model.number="seats" type="number" min="1" max="8" required
            /></label>
          </div>
          <p v-if="purpose === 'executive'" class="notice">
            This election replaces the executive roster at term start. Native control requires
            paired Telos Zero accounts; until an eligible successor pairs, the outgoing roster
            retains control. For the governing DAO, administrator rights follow the eligible paired
            executive roster.
          </p>
          <label v-else
            >Representative title<input
              v-model="title"
              maxlength="80"
              required
              pattern="(?!Executives$).*"
              title="Executives is reserved for executive governance elections"
          /></label>
          <p class="field-help" v-if="purpose === 'representative'">
            A representative title gives members a defined office; it grants no administrator or
            spending powers.
          </p>
        </fieldset>
        <fieldset :disabled="busy">
          <legend>Rules members will follow</legend>
          <label for="election-rules">Election rules</label>
          <select id="election-rules" v-model="rulesDocument" :disabled="documentsLoading" required>
            <option value="" disabled>Choose a published document</option>
            <option v-for="document in documentOptions" :key="document.id" :value="document.id">
              {{ documentLabel(document) }}
            </option>
          </select>
          <p class="field-help">
            Choose a DAO document explaining eligibility, responsibilities and how the election
            works. This exact version stays attached to the election.
          </p>
          <p v-if="documentsLoading" role="status">Loading DAO documents…</p>
          <p v-if="documentsError" class="alert" role="alert">
            Could not load DAO documents. {{ documentsError }}
          </p>
          <button
            type="button"
            class="secondary"
            :disabled="documentsLoading"
            @click="loadDocuments"
          >
            {{ documentsError ? 'Retry documents' : 'Refresh documents' }}
          </button>
          <p v-if="documents && !documents.documents.length && !documentsLoading">
            No published documents yet.
          </p>
          <RouterLink :to="`/dao/${dao.reference.daoId}/documents`" target="_blank" rel="noopener"
            >Open DAO documents</RouterLink
          >
        </fieldset>
        <fieldset :disabled="busy">
          <legend>Nominations and term dates</legend>
          <div class="election-dates">
            <label
              >Nominations close<input v-model="nominationClose" type="datetime-local" required
            /></label>
            <label>Term starts<input v-model="termStart" type="datetime-local" required /></label>
            <label>Term ends<input v-model="termEnd" type="datetime-local" required /></label>
          </div>
          <p class="field-help">
            Dates use your device’s timezone ({{
              Intl.DateTimeFormat().resolvedOptions().timeZone
            }}). Up to 15 members can stand for election; a term can last up to one year.
          </p>
          <p class="field-help" v-if="governance?.policy">
            Allow more than {{ readableDuration(governance.policy.config.duration) }} for voting
            between nominations closing and the term starting. Quorum and voting weight follow the
            DAO’s saved policy.
          </p>
          <p v-if="timingError" class="alert" role="alert">{{ timingError }}</p>
        </fieldset>
        <div class="button-row">
          <button
            :disabled="
              !allowed('newelect') ||
              !selectedRules ||
              documentsLoading ||
              !!timingError ||
              !governance?.policy
            "
          >
            Schedule election
          </button>
          <button type="button" class="secondary" :disabled="busy" @click="dialog?.close()">
            Cancel
          </button>
        </div>
      </form>
    </dialog>
    <article v-for="election in data.elections" :key="election.id" class="panel">
      <h3>{{ election.title }} · election {{ election.id }}</h3>
      <p>
        {{ election.seats }} seats · rules {{ election.document_id }} / v{{
          election.document_version
        }}
        · policy revision {{ election.policy_revision }}
      </p>
      <p>
        Nominations close {{ date(election.nomination_close) }} · term
        {{ date(election.term_start) }} — {{ date(election.term_end) }}
      </p>
      <p>
        Quorum follows the frozen DAO policy. Abstention counts for quorum. A tied group must fit
        entirely within the remaining seats; otherwise those seats stay vacant. Ineligible winners
        leave vacancies. Approved liabilities and permanent roles are separate.
      </p>
      <template v-if="election.status === 0"
        ><p>
          Nominees:
          {{
            data.nominations
              .filter((n) => n.election_id === election.id)
              .map((n) => n.member_id)
              .join(', ') || 'none'
          }}
        </p>
        <button
          v-if="member?.active && now < election.nomination_close"
          :disabled="!allowed('nominate')"
          @click="
            sign(
              'nominate',
              { ...actor(), election_id: election.id, active: !nominated(election.id) },
              nominated(election.id) ? 'Self-nomination withdrawn.' : 'Self-nomination recorded.',
            )
          "
        >
          {{ nominated(election.id) ? 'Withdraw self-nomination' : 'Sign self-nomination' }}</button
        ><button
          v-if="now >= election.nomination_close"
          :disabled="!allowed('startelect')"
          @click="
            sign(
              'startelect',
              { ...actor(), election_id: election.id },
              'Candidates and voting rules frozen. Voting is open.',
            )
          "
        >
          Freeze candidates and start voting
        </button></template
      >
      <template v-else-if="ballot(election.id)"
        ><p>
          Votes cast {{ ballot(election.id)?.cast }} / eligible
          {{ ballot(election.id)?.denominator }} · closes
          {{ date(ballot(election.id)?.closes ?? 0) }}
        </p>
        <ul>
          <li>Abstain · {{ ballot(election.id)?.tallies[0] ?? '0' }}</li>
          <li v-for="(candidate, index) in election.candidates" :key="candidate">
            Member {{ candidate }} · {{ ballot(election.id)?.tallies[index + 1] ?? '0' }}
          </li>
        </ul>
        <form
          v-if="
            ballot(election.id)?.status === 0 &&
            now < (ballot(election.id)?.closes ?? 0) &&
            member?.active &&
            !voted(election.id)
          "
          @submit.prevent="
            sign(
              'vote',
              { ...actor(), ballot_id: election.id, choice: choice[election.id] ?? 0 },
              'Election vote recorded once.',
            )
          "
        >
          <label :for="`election-choice-${election.id}`">Your choice</label
          ><select :id="`election-choice-${election.id}`" v-model.number="choice[election.id]">
            <option :value="0">Abstain</option>
            <option
              v-for="(candidate, index) in election.candidates"
              :key="candidate"
              :value="index + 1"
            >
              Member {{ candidate }}
            </option></select
          ><label class="checkbox"
            ><input v-model="reviewed[election.id]" type="checkbox" />I reviewed the frozen
            candidates, term and election rules</label
          ><button :disabled="!allowed('vote') || !reviewed[election.id]">
            Sign election vote
          </button>
        </form>
        <p v-if="voted(election.id)" role="status">Your vote is recorded.</p>
        <button
          v-if="ballot(election.id)?.status === 0 && now >= (ballot(election.id)?.closes ?? 0)"
          :disabled="!canFinalize"
          @click="finalize(election.id)"
        >
          Finalize election
        </button>
        <p v-if="election.status === 2">
          Finalized · {{ data.terms.filter((t) => t.election_id === election.id).length }} recorded
          terms. Empty seats remain vacant.
        </p></template
      >
      <p v-else>Load more Decide records to read this election’s ballot and result.</p>
    </article>
    <h3>Representative terms</h3>
    <article v-for="term in data.terms" :key="term.id" class="panel">
      <h4>{{ term.title }} · member {{ term.member_id }}</h4>
      <p>
        {{ termStatus(term) }} · {{ date(term.starts) }} — {{ date(term.ends) }} · election
        {{ term.election_id }}
      </p>
      <p>A term window does not replace active membership or confer spending authority.</p>
      <p v-if="term.recalled">
        Recalled {{ date(term.recalled_at) }} · reason {{ term.recall_doc }} / v{{
          term.recall_version
        }}
      </p>
      <details v-if="member?.active && member.admin && !term.recalled" @toggle="recallToggle">
        <summary>End this term early</summary>
        <form @submit.prevent="recall(term.id)">
          <label :for="`recall-reason-${term.id}`">Reason for ending the term</label>
          <select
            :id="`recall-reason-${term.id}`"
            v-model="recallDocuments[term.id]"
            :disabled="busy || documentsLoading"
            required
          >
            <option value="" disabled>Choose a published document</option>
            <option v-for="document in documentOptions" :key="document.id" :value="document.id">
              {{ documentLabel(document) }}
            </option>
          </select>
          <p class="field-help">
            Choose a DAO document explaining why this term should end early. Its exact version is
            recorded with the term. Existing liabilities and permanent roles remain separate.
          </p>
          <p v-if="documentsLoading" role="status">Loading DAO documents…</p>
          <p v-if="documentsError" class="alert" role="alert">
            Could not load DAO documents. {{ documentsError }}
          </p>
          <button
            v-if="documentsError"
            type="button"
            class="secondary"
            :disabled="documentsLoading"
            @click="loadDocuments"
          >
            Retry documents
          </button>
          <p v-if="documents && !documents.documents.length && !documentsLoading">
            No published documents yet.
          </p>
          <RouterLink :to="`/dao/${dao.reference.daoId}/documents`" target="_blank" rel="noopener"
            >Open DAO documents</RouterLink
          >
          <div class="button-row">
            <button
              class="secondary"
              :disabled="!allowed('recall') || !recallReason(term.id) || documentsLoading"
            >
              End term
            </button>
          </div>
        </form>
      </details>
    </article>
  </section>
</template>

<style scoped>
.election-dialog {
  width: min(840px, calc(100% - 32px));
  max-height: calc(100dvh - 48px);
  overflow: auto;
  margin: auto;
  color: var(--text-primary);
}
.election-dialog::backdrop {
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
}
.election-dialog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.election-dialog-heading h2 {
  margin: 0;
}
.election-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 6px;
  color: var(--accent-amber);
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
.election-close :deep(svg) {
  width: 24px;
  height: 24px;
}
fieldset {
  min-width: 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  margin: 24px 0;
  padding: 0 0 24px;
}
legend {
  font-weight: 700;
  margin-bottom: 16px;
}
.election-dates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
input,
select {
  min-width: 0;
}
@media (max-width: 760px) {
  .election-dates {
    grid-template-columns: 1fr;
  }
}
</style>
