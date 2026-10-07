<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  formatUnits,
  parseUnits,
  type DaoSummary,
  type UserMembership,
  type GovernanceState,
} from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
import { encodeGrants, encodeDecide, type GrantsActions } from '@daclify/modules/sdk';
import { friendlyError } from '../api/client';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  data: ModuleState;
  policy: GovernanceState | undefined;
  canSign: boolean;
  run: (target: string, action: string, payload: Uint8Array, message: string) => Promise<void>;
}>();
const module = computed(() => props.data.modules.find((m) => m.deployment.id === 'grants-rounds'));
const works = computed(() => props.data.modules.find((m) => m.deployment.id === 'works'));
const decide = computed(() => props.data.modules.find((m) => m.deployment.id === 'decide'));
const roundId = ref(''),
  documentId = ref(''),
  documentVersion = ref(1),
  maximum = ref('5.0000'),
  allowAgents = ref(false);
function dateInput(offset: number) {
  const d = new Date(Date.now() + offset * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const applicationsClose = ref(dateInput(86400)),
  reviewClose = ref(dateInput(172800)),
  awardsClose = ref(dateInput(604800));
const payments = ref('1.0000'),
  due = ref(dateInput(1209600)),
  start = ref(dateInput(0)),
  end = ref(dateInput(2592000)),
  editing = ref('');
const decisionDoc = ref(''),
  decisionVersion = ref(1),
  reviewed = ref<Record<string, boolean>>({}),
  error = ref('');
watch(
  () => JSON.stringify(props.data.applications),
  () => {
    reviewed.value = {};
  },
);
const status = ['Draft', 'Submitted', 'Eligible', 'Rejected', 'Awarded', 'Closed'];
function newId() {
  const bytes = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(bytes[0] ?? 0) << 32n) | BigInt(bytes[1] ?? 0) || 1n).toString();
}
function seconds(value: string) {
  const n = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('TIME_RANGE');
  return n;
}
function nativeAmount(value: string) {
  return `${formatUnits(parseUnits(value.trim(), props.dao.token.precision), props.dao.token.precision)} ${props.dao.token.symbol}`;
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
async function sign<K extends keyof GrantsActions>(
  action: K,
  data: GrantsActions[K],
  message: string,
) {
  try {
    if (!module.value || !allowed(action)) return;
    error.value = '';
    await props.run(module.value.deployment.account, action, encodeGrants(action, data), message);
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function createRound() {
  try {
    if (!works.value?.enabled || !works.value.codeVerified) return;
    await sign(
      'newround',
      {
        ...actor(),
        round_id: newId(),
        document_id: documentId.value,
        document_version: documentVersion.value,
        applications_close: seconds(applicationsClose.value),
        review_close: seconds(reviewClose.value),
        awards_close: seconds(awardsClose.value),
        maximum: nativeAmount(maximum.value),
        allow_agents: allowAgents.value,
        works: works.value.deployment.account,
      },
      'Grant round created. Its cap reserves no funds.',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function saveApplication() {
  try {
    const terms = {
      ...actor(),
      document_id: documentId.value,
      document_version: documentVersion.value,
      payments: payments.value.split(',').map(nativeAmount),
      dues: payments.value.split(',').map(() => seconds(due.value)),
      term_start: seconds(start.value),
      term_end: seconds(end.value),
    };
    if (editing.value)
      await sign(
        'amend',
        { ...terms, application_id: editing.value },
        'Application amended. Submit fresh consent and request review.',
      );
    else
      await sign(
        'applygrant',
        { ...terms, round_id: roundId.value, application_id: newId() },
        'Draft application created. Review and sign consent before submitting.',
      );
    editing.value = '';
    reviewed.value = {};
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
function amend(app: ModuleState['applications'][number]) {
  editing.value = app.id;
  roundId.value = app.round_id;
  documentId.value = app.document_id;
  documentVersion.value = app.document_version;
  payments.value = app.payments.map((p) => p.split(' ')[0]).join(', ');
  start.value = dateInput(app.term_start - Math.floor(Date.now() / 1000));
  end.value = dateInput(app.term_end - Math.floor(Date.now() / 1000));
  due.value = dateInput((app.dues[0] ?? 0) - Math.floor(Date.now() / 1000));
  reviewed.value = {};
}
async function review(app: string, eligible: boolean) {
  await sign(
    'reviewapp',
    {
      ...actor(),
      application_id: app,
      eligible,
      document_id: decisionDoc.value,
      document_version: decisionVersion.value,
    },
    'Eligibility reviewed. Funding still requires a passed award vote.',
  );
}
async function award(app: ModuleState['applications'][number]) {
  try {
    const p = props.policy?.policy?.config,
      d = decide.value;
    if (
      !props.canSign ||
      !p ||
      !d?.enabled ||
      !d.codeVerified ||
      !d.compatible ||
      !d.actions.includes('openaward') ||
      !module.value
    )
      return;
    await props.run(
      d.deployment.account,
      'openaward',
      encodeDecide('openaward', {
        ...actor(),
        ballot_id: newId(),
        grants: module.value.deployment.account,
        round_id: app.round_id,
        application_id: app.id,
        project_id: newId(),
        duration: p.duration,
        quorum: p.quorum,
        approval: p.approval,
        metadata: '{}',
      }),
      'Award vote opened. Vote, finalize and execute it in Decide.',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
</script>
<template>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <div class="section-toolbar">
    <h3>Applications and rounds</h3>
    <RouterLink to="/docs/grants-rounds">Grant lifecycle ↗</RouterLink>
  </div>
  <p>
    Apply, consent to exact milestone terms, receive an eligibility review, then ask the DAO to vote
    on funding. Successful awards become fully backed Works agreements.
  </p>
  <p v-if="!module?.enabled" class="notice">
    An administrator can enable Grants rounds in Modules. Works and Decide must also be available.
  </p>
  <details v-if="member?.admin">
    <summary>Create a round</summary>
    <form class="panel form-grid" @submit.prevent="createRound">
      <label>Rules document ID<input v-model="documentId" inputmode="numeric" required /></label
      ><label
        >Rules version<input
          v-model.number="documentVersion"
          type="number"
          min="1"
          required /></label
      ><label
        >Lifetime award cap ({{ dao.token.symbol }})<input
          v-model="maximum"
          inputmode="decimal"
          required /></label
      ><label
        >Applications close<input
          v-model="applicationsClose"
          type="datetime-local"
          required /></label
      ><label>Reviews close<input v-model="reviewClose" type="datetime-local" required /></label
      ><label>Awards close<input v-model="awardsClose" type="datetime-local" required /></label
      ><label class="checkbox"
        ><input v-model="allowAgents" type="checkbox" />Allow active AI agents as applicants</label
      >
      <p>This freezes the rules. The cap does not reserve funds or create a donor pool.</p>
      <button :disabled="!allowed('newround') || !works?.enabled || !works.codeVerified">
        Sign and create round
      </button>
    </form>
  </details>
  <div class="dao-grid">
    <article v-for="round in data.rounds" :key="round.id" class="panel">
      <h3>Round {{ round.id }}</h3>
      <p>
        Rules {{ round.document_id }} / v{{ round.document_version }} ·
        {{ round.closed ? 'Closed' : 'Open' }}
      </p>
      <p>
        Lifetime cap {{ round.maximum }} · cumulative awards
        {{ formatUnits(BigInt(round.awarded), dao.token.precision) }} {{ dao.token.symbol }}
      </p>
      <p>
        Applications close {{ new Date(round.applications_close * 1000).toLocaleString() }} ·
        reviews {{ new Date(round.review_close * 1000).toLocaleString() }} · awards
        {{ new Date(round.awards_close * 1000).toLocaleString() }}
      </p>
      <p>
        {{ round.allow_agents ? 'Humans and active agents' : 'Human participants' }} · Works
        {{ round.works }}
      </p>
      <button
        v-if="member?.active && !round.closed"
        class="secondary"
        :disabled="!allowed('applygrant')"
        @click="
          roundId = round.id;
          editing = '';
        "
      >
        Apply to this round</button
      ><button
        v-if="member?.admin && !round.closed"
        class="secondary"
        :disabled="!allowed('closeround')"
        @click="
          sign(
            'closeround',
            { ...actor(), round_id: round.id },
            'Round closed. Existing approved liabilities remain payable.',
          )
        "
      >
        Close round
      </button>
    </article>
  </div>
  <form v-if="roundId && member?.active" class="panel form-grid" @submit.prevent="saveApplication">
    <h3>
      {{ editing ? 'Amend application ' + editing : 'Draft an application' }} · round {{ roundId }}
    </h3>
    <label>Application document ID<input v-model="documentId" inputmode="numeric" required /></label
    ><label
      >Document version<input
        v-model.number="documentVersion"
        type="number"
        min="1"
        required /></label
    ><label
      >Milestone payments ({{ dao.token.symbol }}, comma separated)<input
        v-model="payments"
        required /></label
    ><label>Milestone due date<input v-model="due" type="datetime-local" required /></label
    ><label>Term starts<input v-model="start" type="datetime-local" required /></label
    ><label>Term ends<input v-model="end" type="datetime-local" required /></label>
    <p>
      This form uses one common due date. The documented native action supports separate due dates.
      Maximum 16 milestones and a one-year term. Changes require fresh consent and review.
    </p>
    <button :disabled="!allowed(editing ? 'amend' : 'applygrant')">Sign and save draft</button>
  </form>
  <div v-if="member?.admin" class="panel form-grid">
    <h3>Eligibility review reference</h3>
    <label>Decision document ID<input v-model="decisionDoc" inputmode="numeric" /></label
    ><label>Version<input v-model.number="decisionVersion" type="number" min="1" /></label>
    <p>Eligibility approves no spending. Publish a decision document before reviewing.</p>
  </div>
  <article v-for="app in data.applications" :key="app.id" class="panel">
    <h3>Application {{ app.id }} · {{ status[app.status] ?? 'Unknown state' }}</h3>
    <p>
      Round {{ app.round_id }} · contributor {{ app.contributor }} · revision {{ app.revision }} ·
      document {{ app.document_id }} / v{{ app.document_version }}
    </p>
    <p>
      {{ app.payments.join(', ') }} · term {{ new Date(app.term_start * 1000).toLocaleString() }} —
      {{ new Date(app.term_end * 1000).toLocaleString() }}
    </p>
    <ul>
      <li v-for="(payment, index) in app.payments" :key="index">
        {{ payment }} due {{ new Date((app.dues[index] ?? 0) * 1000).toLocaleString() }}
      </li>
    </ul>
    <p>
      Independent DAO review is required before payout; cancellation preserves approved liabilities.
      These terms confer no administrator powers.
    </p>
    <label v-if="app.status === 0 && app.contributor === member?.memberId" class="checkbox"
      ><input v-model="reviewed[app.id]" type="checkbox" />I reviewed this exact application
      document, compensation, term, review and cancellation rules</label
    >
    <div class="section-toolbar">
      <button
        v-if="app.status === 0 && app.contributor === member?.memberId"
        :disabled="!allowed('submitapp') || !reviewed[app.id]"
        @click="
          sign(
            'submitapp',
            { ...actor(), application_id: app.id },
            'Application submitted with explicit consent to the frozen terms.',
          )
        "
      >
        Sign consent and submit</button
      ><button
        v-if="app.status < 4 && app.contributor === member?.memberId"
        class="secondary"
        :disabled="!allowed('amend')"
        @click="amend(app)"
      >
        Amend draft</button
      ><template v-if="member?.admin && [1, 2, 3].includes(app.status)"
        ><button :disabled="!allowed('reviewapp') || !decisionDoc" @click="review(app.id, true)">
          Mark eligible</button
        ><button
          class="secondary"
          :disabled="!allowed('reviewapp') || !decisionDoc"
          @click="review(app.id, false)"
        >
          Reject eligibility
        </button></template
      ><button
        v-if="app.status === 2"
        :disabled="!canSign || !decide?.enabled || !decide.codeVerified || !policy?.policy"
        @click="award(app)"
      >
        Propose award vote</button
      ><button
        v-if="app.status < 4 && (member?.admin || app.contributor === member?.memberId)"
        class="secondary"
        :disabled="!allowed('closeapp')"
        @click="sign('closeapp', { ...actor(), application_id: app.id }, 'Application closed.')"
      >
        Close application</button
      ><RouterLink v-if="app.status === 4" :to="`/dao/${dao.reference.daoId}/works`"
        >Continue Works project {{ app.project_id }} ↗</RouterLink
      >
    </div>
  </article>
</template>
