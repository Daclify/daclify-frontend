<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DaoSummary, UserMembership, GovernanceState } from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
import { encodeDecide, type DecideActions } from '@daclify/modules/sdk';
import { friendlyError } from '../api/client';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  data: ModuleState;
  governance: GovernanceState | undefined;
  canSign: boolean;
  canFinalize: boolean;
  now: number;
  run: (target: string, action: string, payload: Uint8Array, message: string) => Promise<void>;
  finalize: (id: string) => Promise<void>;
}>();
const module = computed(() => props.data.modules.find((m) => m.deployment.id === 'decide'));
const title = ref('Community council'),
  purpose = ref('representative'),
  documentId = ref(''),
  documentVersion = ref(1),
  seats = ref(1),
  error = ref(''),
  choice = ref<Record<string, number>>({}),
  reviewed = ref<Record<string, boolean>>({}),
  recallDoc = ref(''),
  recallVersion = ref(1);
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
  try {
    await sign(
      'newelect',
      {
        ...actor(),
        election_id: newId(),
        title: purpose.value === 'executive' ? 'Executives' : title.value,
        document_id: documentId.value,
        document_version: documentVersion.value,
        nomination_close: seconds(nominationClose.value),
        term_start: seconds(termStart.value),
        term_end: seconds(termEnd.value),
        seats: seats.value,
      },
      'Election scheduled. Members nominate themselves before the cutoff.',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
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
      <RouterLink to="/docs/representative-elections">Election and term rules ↗</RouterLink>
    </div>
    <p>
      Elect representatives for a fixed term, or explicitly elect executives to change the appointed
      roster. Representative titles grant no administrator, reviewer or Treasury powers.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <details v-if="member?.admin">
      <summary>Schedule an election</summary>
      <form class="panel form-grid" @submit.prevent="create">
        <label
          >Election purpose<select v-model="purpose">
            <option value="representative">Representative office</option>
            <option
              value="executive"
              :disabled="!governance?.executivePolicy || !module?.grants.includes('electexec')"
            >
              Executive governance
            </option>
          </select></label
        >
        <p v-if="purpose === 'executive'" class="notice">
          This election replaces the executive roster at term start. Native control requires paired
          Telos Zero accounts; until an eligible successor pairs, the outgoing roster retains
          control. For the governing DAO, administrator rights follow the eligible paired executive
          roster.
        </p>
        <label v-else
          >Representative title<input
            v-model="title"
            maxlength="80"
            required
            pattern="(?!Executives$).*"
            title="Executives is reserved for executive governance elections" /></label
        ><label>Rules document ID<input v-model="documentId" inputmode="numeric" required /></label
        ><label
          >Rules version<input
            v-model.number="documentVersion"
            type="number"
            min="1"
            required /></label
        ><label>Seats<input v-model.number="seats" type="number" min="1" max="8" required /></label
        ><label
          >Nominations close<input
            v-model="nominationClose"
            type="datetime-local"
            required /></label
        ><label>Term starts<input v-model="termStart" type="datetime-local" required /></label
        ><label>Term ends<input v-model="termEnd" type="datetime-local" required /></label>
        <p>
          Maximum 15 candidates and a one-year term. Allow the DAO voting duration between
          nomination cutoff and term start. A policy change requires a new election.
        </p>
        <button :disabled="!allowed('newelect')">Sign and schedule election</button>
      </form>
    </details>
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
    <div v-if="member?.admin" class="form-grid">
      <label>Recall reason document ID<input v-model="recallDoc" inputmode="numeric" /></label
      ><label>Reason version<input v-model.number="recallVersion" type="number" min="1" /></label>
    </div>
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
      <button
        v-if="member?.admin && !term.recalled"
        class="secondary"
        :disabled="!allowed('recall') || !recallDoc"
        @click="
          sign(
            'recall',
            {
              ...actor(),
              term_id: term.id,
              document_id: recallDoc,
              document_version: recallVersion,
            },
            'Representative term recalled. Existing liabilities and permanent roles remain separate.',
          )
        "
      >
        Sign term recall
      </button>
    </article>
  </section>
</template>
