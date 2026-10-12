<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Plus, CircleHelp, X, Trash2 } from '@lucide/vue';
import {
  formatUnits,
  parseUnits,
  type DaoContent,
  type DaoSummary,
  type UserMembership,
  type GovernanceState,
} from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
import { encodeGrants, encodeDecide, type GrantsActions } from '@daclify/modules/sdk';
import { friendlyError } from '../api/client';
import { documentLabel } from '../content/document-labels';
import { parseGrantTerms, parseRoundInputs } from '../content/grants-inputs';
import { parseWholeWorkPayments } from '../content/token-payments';
import { percentageText, readableDuration } from '../content/governance-inputs';

const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  data: ModuleState;
  policy: GovernanceState | undefined;
  content: DaoContent | undefined;
  memberNames: Record<string, string>;
  choicesLoading: boolean;
  choicesError: string;
  profilesError: string;
  refreshChoices: () => Promise<void>;
  canSign: boolean;
  busy: boolean;
  actionError: string;
  actionSuccess: string;
  now: number;
  run: (target: string, action: string, payload: Uint8Array, message: string) => Promise<void>;
}>();
type Round = ModuleState['rounds'][number];
type Application = ModuleState['applications'][number];
type Mode = 'round' | 'application' | 'review' | 'consent' | 'award';
const module = computed(() => props.data.modules.find((m) => m.deployment.id === 'grants-rounds'));
const works = computed(() => props.data.modules.find((m) => m.deployment.id === 'works'));
const decide = computed(() => props.data.modules.find((m) => m.deployment.id === 'decide'));
const tab = ref<'rounds' | 'applications'>('rounds'),
  query = ref(''),
  filter = ref(''),
  roundFilter = ref('');
const filteredRound = computed(() =>
  props.data.rounds.find((round) => round.id === roundFilter.value),
);
const dialog = ref<HTMLDialogElement>(),
  mode = ref<Mode>('round'),
  error = ref('');
const roundStep = ref(0),
  roundReference = ref(newId()),
  rules = ref(''),
  maximum = ref(''),
  allowAgents = ref(false),
  roundConfirmed = ref(false);
const applicationsClose = ref(localDate(Math.floor(Date.now() / 1000) + 7 * 86400)),
  reviewClose = ref(localDate(Math.floor(Date.now() / 1000) + 14 * 86400)),
  awardsClose = ref(localDate(Math.floor(Date.now() / 1000) + 21 * 86400));
type ApplicationDraft = {
  id: string;
  roundId: string;
  proposal: string;
  milestones: { id: number; amount: string; due: string }[];
  start: string;
  end: string;
  confirmed: boolean;
};
let nextMilestone = 1;
function blankDraft(): ApplicationDraft {
  return {
    id: newId(),
    roundId: '',
    proposal: '',
    milestones: [{ id: nextMilestone++, amount: '', due: '' }],
    start: localDate(props.now),
    end: localDate(props.now + 30 * 86400),
    confirmed: false,
  };
}
const newDraft = ref(blankDraft()),
  draft = ref(newDraft.value),
  editing = ref('');
const editDrafts = ref<Record<string, { original: string; draft: ApplicationDraft }>>({});
const selectedAppId = ref(''),
  decision = ref(''),
  eligible = ref(true),
  confirmed = ref(false);
const reviewDrafts = ref<Record<string, { revision: string; decision: string; eligible: boolean }>>(
  {},
);
const fundingDrafts = ref<Record<string, { terms: string; ballotId: string; projectId: string }>>(
  {},
);
watch([decision, eligible], () => {
  if (mode.value === 'review' && selectedAppId.value)
    reviewDrafts.value[selectedAppId.value] = {
      revision: selectedApp.value?.revision ?? '',
      decision: decision.value,
      eligible: eligible.value,
    };
});
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
  dialog.value?.close();
});
const selectedApp = computed(() =>
  props.data.applications.find((app) => app.id === selectedAppId.value),
);
const selectedRound = computed(() =>
  props.data.rounds.find((round) => round.id === draft.value.roundId),
);
const documentOptions = computed(() =>
  [...(props.content?.documents ?? [])].sort((a, b) =>
    a.document_id === b.document_id
      ? b.version - a.version
      : BigInt(a.document_id) < BigInt(b.document_id)
        ? -1
        : 1,
  ),
);
function selectedDocument(id: string) {
  return props.content?.documents.find((row) => row.id === id);
}
function published(id: string, version: number) {
  return props.content?.documents.find((row) => row.document_id === id && row.version === version);
}
function label(id: string, version: number, fallback: string) {
  const row = published(id, version);
  return row ? documentLabel(row).replace(/ · version \d+$/, '') : fallback;
}
function referenceLabel(id: string, version: number) {
  const row = published(id, version);
  return row ? documentLabel(row) : `Document ${id} · version ${version}`;
}
function roundTitle(round: Round) {
  return label(round.document_id, round.document_version, `Round ${round.id}`);
}
function appTitle(app: Application) {
  return label(app.document_id, app.document_version, `Application ${app.id}`);
}
function appRoundTitle(app: Application) {
  const round = props.data.rounds.find((round) => round.id === app.round_id);
  return round ? roundTitle(round) : `Round ${app.round_id}`;
}
function memberName(id: string) {
  return props.memberNames[id] || `Member ${id}`;
}
function tokenText(units: bigint) {
  return formatUnits(units, props.dao.token.precision)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}
function assetUnits(asset: string) {
  return parseUnits(asset.split(' ')[0] ?? '', props.dao.token.precision);
}
function asset(asset: string) {
  return `${tokenText(assetUnits(asset))} ${props.dao.token.symbol}`;
}
function total(app: Application) {
  return `${tokenText(app.payments.reduce((sum, payment) => sum + assetUnits(payment), 0n))} ${props.dao.token.symbol}`;
}
function localDate(epoch: number) {
  const value = new Date(epoch * 1000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
function date(epoch: number) {
  return new Date(epoch * 1000).toLocaleString();
}
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
function roundPhase(round: Round) {
  return round.closed || props.now >= round.awards_close
    ? 'Closed'
    : props.now < round.applications_close
      ? 'Accepting applications'
      : props.now < round.review_close
        ? 'Reviewing applications'
        : 'Funding decisions';
}
function accepts(round: Round | undefined) {
  return !!round && !round.closed && props.now < round.applications_close;
}
const openRounds = computed(() => props.data.rounds.filter(accepts));
function appStatus(app: Application) {
  const vote = props.data.grantPlans.some(
    (plan) =>
      plan.application_id === app.id &&
      plan.application_revision === app.revision &&
      !plan.executed &&
      props.now < plan.deadline,
  );
  return app.status === 2 && vote
    ? 'Funding vote'
    : (['Draft', 'Submitted', 'Eligible', 'Rejected', 'Awarded', 'Closed'][app.status] ??
        'Unknown state');
}
const visibleRounds = computed(() =>
  props.data.rounds.filter(
    (round) =>
      (!filter.value || roundPhase(round) === filter.value) &&
      `${roundTitle(round)} ${round.id}`
        .toLocaleLowerCase()
        .includes(query.value.trim().toLocaleLowerCase()),
  ),
);
const visibleApps = computed(() =>
  props.data.applications.filter(
    (app) =>
      (!roundFilter.value || app.round_id === roundFilter.value) &&
      (!filter.value || appStatus(app) === filter.value) &&
      `${appTitle(app)} ${memberName(app.contributor)} ${app.id} ${app.round_id}`
        .toLocaleLowerCase()
        .includes(query.value.trim().toLocaleLowerCase()),
  ),
);
const statuses = computed(() =>
  tab.value === 'rounds'
    ? ['Accepting applications', 'Reviewing applications', 'Funding decisions', 'Closed']
    : ['Draft', 'Submitted', 'Eligible', 'Funding vote', 'Rejected', 'Awarded', 'Closed'],
);
watch(tab, () => {
  filter.value = '';
});
watch([rules, maximum, allowAgents, applicationsClose, reviewClose, awardsClose], () => {
  roundConfirmed.value = false;
});
watch(
  () => [
    draft.value.roundId,
    draft.value.proposal,
    draft.value.milestones,
    draft.value.start,
    draft.value.end,
  ],
  () => {
    draft.value.confirmed = false;
  },
  { deep: true },
);
watch(
  [selectedApp, decision, eligible],
  () => {
    confirmed.value = false;
  },
  { deep: true },
);
const roundState = computed(() => {
  try {
    return {
      valid: true as const,
      value: parseRoundInputs(
        maximum.value,
        applicationsClose.value,
        reviewClose.value,
        awardsClose.value,
        props.dao.token.precision,
        props.now,
      ),
    };
  } catch (cause) {
    return {
      valid: false as const,
      error: cause instanceof Error ? cause.message : 'Check the funding limit and dates.',
    };
  }
});
const paymentTotal = computed(() => {
  try {
    return (
      tokenText(
        parseWholeWorkPayments(
          draft.value.milestones.map((row) => row.amount),
          props.dao.token.precision,
        ).total,
      ) +
      ' ' +
      props.dao.token.symbol
    );
  } catch {
    return '—';
  }
});
const applicationState = computed(() => {
  try {
    if (!selectedRound.value || !accepts(selectedRound.value))
      throw new Error('Choose a round still accepting applications.');
    return {
      valid: true as const,
      value: parseGrantTerms(
        draft.value.milestones,
        draft.value.start,
        draft.value.end,
        props.dao.token.precision,
        assetUnits(selectedRound.value.maximum),
        props.now,
      ),
    };
  } catch (cause) {
    return {
      valid: false as const,
      error: cause instanceof Error ? cause.message : 'Check the milestone terms.',
    };
  }
});
const title = computed(() =>
  mode.value === 'round'
    ? 'Create grant round'
    : mode.value === 'application'
      ? editing.value
        ? 'Edit grant application'
        : 'Apply for a grant'
      : mode.value === 'review'
        ? 'Review application'
        : mode.value === 'consent'
          ? 'Submit grant application'
          : 'Propose funding vote',
);
const creationLabel = computed(() =>
  tab.value === 'rounds' ? 'Create grant round' : 'Apply for a grant',
);
function allowed(action: string) {
  return !!(
    props.member?.active &&
    props.canSign &&
    !props.busy &&
    module.value?.enabled &&
    module.value.compatible &&
    module.value.codeVerified &&
    module.value.actions.includes(action)
  );
}
function worksReady() {
  return !!(works.value?.enabled && works.value.compatible && works.value.codeVerified);
}
function reviewable(app: Application | undefined) {
  const round = props.data.rounds.find((round) => round.id === app?.round_id);
  return !!(
    app &&
    [1, 2, 3].includes(app.status) &&
    round &&
    !round.closed &&
    props.now < round.review_close
  );
}
function awardReady(app: Application | undefined) {
  const round = props.data.rounds.find((round) => round.id === app?.round_id),
    d = decide.value,
    p = props.policy?.policy?.config;
  return !!(
    app &&
    app.status === 2 &&
    round &&
    !round.closed &&
    props.now + (p?.duration ?? 0) < Math.min(round.awards_close, app.term_end) &&
    props.member?.active &&
    props.canSign &&
    !props.busy &&
    module.value?.enabled &&
    module.value.compatible &&
    module.value.codeVerified &&
    module.value.grants.includes('awardwork') &&
    worksReady() &&
    d?.enabled &&
    d.compatible &&
    d.codeVerified &&
    d.actions.includes('openaward') &&
    p
  );
}
async function show(kind: Mode) {
  if (
    props.busy ||
    !props.member?.active ||
    !module.value?.enabled ||
    ((kind === 'round' || kind === 'review') && !props.member.admin)
  )
    return;
  error.value = '';
  mode.value = kind;
  confirmed.value = false;
  if (kind === 'round') roundStep.value = 0;
  await nextTick();
  if (!disposed) dialog.value?.showModal();
}
function useNewDraft() {
  editing.value = '';
  draft.value = newDraft.value;
}
function createFromToolbar() {
  if (tab.value === 'rounds') void show('round');
  else {
    useNewDraft();
    if (!accepts(selectedRound.value)) draft.value.roundId = openRounds.value[0]?.id ?? '';
    void show('application');
  }
}
function apply(round: Round) {
  if (!accepts(round) || props.busy) return;
  useNewDraft();
  draft.value.roundId = round.id;
  void show('application');
}
function amend(app: Application) {
  if (
    props.busy ||
    app.contributor !== props.member?.memberId ||
    app.status >= 4 ||
    !accepts(props.data.rounds.find((r) => r.id === app.round_id))
  )
    return;
  const original = JSON.stringify(app);
  let cached = editDrafts.value[app.id];
  if (!cached || cached.original !== original) {
    cached = {
      original,
      draft: {
        id: app.id,
        roundId: app.round_id,
        proposal: published(app.document_id, app.document_version)?.id ?? '',
        milestones: app.payments.map((payment, index) => ({
          id: nextMilestone++,
          amount: tokenText(assetUnits(payment)),
          due: localDate(app.dues[index] ?? 0),
        })),
        start: localDate(app.term_start),
        end: localDate(app.term_end),
        confirmed: false,
      },
    };
    editDrafts.value[app.id] = cached;
  }
  editing.value = app.id;
  draft.value = cached.draft;
  void show('application');
}
function selectApp(app: Application, kind: 'review' | 'consent' | 'award') {
  selectedAppId.value = app.id;
  if (kind === 'review') {
    const saved = reviewDrafts.value[app.id];
    const cached = saved?.revision === app.revision ? saved : undefined;
    decision.value =
      cached?.decision ?? published(app.decision_doc, app.decision_version)?.id ?? '';
    eligible.value = cached?.eligible ?? app.status !== 3;
  }
  void show(kind);
}
function resetApplication() {
  if (editing.value) delete editDrafts.value[editing.value];
  else newDraft.value = blankDraft();
  useNewDraft();
}
function addMilestone() {
  if (!props.busy && draft.value.milestones.length < 16)
    draft.value.milestones.push({ id: nextMilestone++, amount: '', due: '' });
}
function removeMilestone(id: number) {
  if (!props.busy && draft.value.milestones.length > 1)
    draft.value.milestones = draft.value.milestones.filter((row) => row.id !== id);
}
async function nextStep() {
  if (
    props.busy ||
    (roundStep.value === 0 && (!selectedDocument(rules.value) || props.choicesLoading)) ||
    (roundStep.value === 1 && !roundState.value.valid)
  )
    return;
  roundStep.value = Math.min(2, roundStep.value + 1);
  await nextTick();
  dialog.value?.querySelector<HTMLElement>('input, select, [data-step-focus]')?.focus();
}
function actor() {
  if (!props.member?.active) throw new Error('AUTH_REQUIRED');
  return {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: props.member.memberId,
  };
}
function newId() {
  const v = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(v[0] ?? 0) << 32n) | BigInt(v[1] ?? 0) || 1n).toString();
}
async function sign<K extends keyof GrantsActions>(
  action: K,
  payload: GrantsActions[K],
  message: string,
) {
  if (!module.value || !allowed(action)) return false;
  try {
    error.value = '';
    await props.run(
      module.value.deployment.account,
      action,
      encodeGrants(action, payload),
      message,
    );
    await nextTick();
    return !disposed && props.actionSuccess === message && !props.actionError;
  } catch (cause) {
    if (!disposed) error.value = friendlyError(cause);
    return false;
  }
}
async function submit() {
  if (props.busy || props.choicesLoading || !props.member?.active) return;
  try {
    if (mode.value === 'round') {
      const doc = selectedDocument(rules.value),
        state = roundState.value;
      if (roundStep.value < 2) {
        await nextStep();
        return;
      }
      if (!props.member.admin || !doc || !state.valid || !roundConfirmed.value || !worksReady())
        return;
      const value = state.value;
      if (
        await sign(
          'newround',
          {
            ...actor(),
            round_id: roundReference.value,
            document_id: doc.document_id,
            document_version: doc.version,
            applications_close: value.applicationsClose,
            review_close: value.reviewClose,
            awards_close: value.awardsClose,
            maximum: `${formatUnits(value.maximum, props.dao.token.precision)} ${props.dao.token.symbol}`,
            allow_agents: allowAgents.value,
            works: works.value?.deployment.account ?? '',
          },
          'Grant round created. Its cap reserves no funds.',
        )
      ) {
        dialog.value?.close();
        rules.value = '';
        maximum.value = '';
        roundReference.value = newId();
        allowAgents.value = false;
        query.value = '';
        filter.value = '';
        roundConfirmed.value = false;
      }
    } else if (mode.value === 'application') {
      const doc = selectedDocument(draft.value.proposal),
        state = applicationState.value,
        original = props.data.applications.find((app) => app.id === editing.value);
      if (
        !doc ||
        !state.valid ||
        !draft.value.confirmed ||
        (editing.value &&
          (!original || original.contributor !== props.member.memberId || original.status >= 4))
      )
        return;
      const value = state.value;
      const terms = {
        ...actor(),
        document_id: doc.document_id,
        document_version: doc.version,
        payments: value.units.map(
          (units) => `${formatUnits(units, props.dao.token.precision)} ${props.dao.token.symbol}`,
        ),
        dues: value.dues,
        term_start: value.termStart,
        term_end: value.termEnd,
      };
      const success = editing.value
        ? await sign(
            'amend',
            { ...terms, application_id: editing.value },
            'Application amended. Submit fresh consent and request review.',
          )
        : await sign(
            'applygrant',
            { ...terms, round_id: draft.value.roundId, application_id: draft.value.id },
            'Draft application created. Review and sign consent before submitting.',
          );
      if (success) {
        dialog.value?.close();
        roundFilter.value = draft.value.roundId;
        query.value = '';
        filter.value = '';
        resetApplication();
        tab.value = 'applications';
      }
    } else {
      const app = selectedApp.value;
      if (!app || !confirmed.value) return;
      let success = false;
      if (mode.value === 'review') {
        const doc = selectedDocument(decision.value);
        if (!props.member.admin || !reviewable(app) || !doc) return;
        success = await sign(
          'reviewapp',
          {
            ...actor(),
            application_id: app.id,
            eligible: eligible.value,
            document_id: doc.document_id,
            document_version: doc.version,
          },
          'Eligibility reviewed. Funding still requires a passed award vote.',
        );
      } else if (mode.value === 'consent') {
        if (
          app.status !== 0 ||
          app.contributor !== props.member.memberId ||
          !accepts(props.data.rounds.find((r) => r.id === app.round_id))
        )
          return;
        success = await sign(
          'submitapp',
          { ...actor(), application_id: app.id },
          'Application submitted with explicit consent to the frozen terms.',
        );
      } else if (mode.value === 'award') {
        const p = props.policy?.policy?.config,
          d = decide.value;
        if (!awardReady(app) || !p || !d || !module.value) return;
        const terms = JSON.stringify([
          app,
          props.policy?.policy,
          module.value.deployment.codeHash,
          works.value?.deployment.codeHash,
          d.deployment.codeHash,
        ]);
        let request = fundingDrafts.value[app.id];
        if (!request || request.terms !== terms) {
          request = { terms, ballotId: newId(), projectId: newId() };
          fundingDrafts.value[app.id] = request;
        }
        const message = 'Award vote opened. Vote, finalize and execute it in Decide.';
        await props.run(
          d.deployment.account,
          'openaward',
          encodeDecide('openaward', {
            ...actor(),
            ballot_id: request.ballotId,
            grants: module.value.deployment.account,
            round_id: app.round_id,
            application_id: app.id,
            project_id: request.projectId,
            duration: p.duration,
            quorum: p.quorum,
            approval: p.approval,
            metadata: '{}',
          }),
          message,
        );
        await nextTick();
        success = !disposed && props.actionSuccess === message && !props.actionError;
      }
      if (success) {
        dialog.value?.close();
        confirmed.value = false;
        if (mode.value === 'review') delete reviewDrafts.value[app.id];
        if (mode.value === 'award') delete fundingDrafts.value[app.id];
      }
    }
  } catch (cause) {
    if (!disposed) error.value = friendlyError(cause);
  }
}
function navigateTabs(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || props.busy) return;
  event.preventDefault();
  tab.value =
    event.key === 'Home'
      ? 'rounds'
      : event.key === 'End'
        ? 'applications'
        : tab.value === 'rounds'
          ? 'applications'
          : 'rounds';
  void nextTick(() => document.getElementById('grants-tab-' + tab.value)?.focus());
}
</script>
<template>
  <div class="grants-toolbar">
    <div class="account-tabs" role="tablist" aria-label="Grants sections" @keydown="navigateTabs">
      <button
        v-for="item in [
          { id: 'rounds', label: 'Rounds' },
          { id: 'applications', label: 'Applications' },
        ] as const"
        :id="'grants-tab-' + item.id"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="tab === item.id"
        :aria-controls="'grants-' + item.id"
        :tabindex="tab === item.id ? 0 : -1"
        :disabled="busy"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="grants-search">
      <label for="grants-search" class="sr-only">Search grants</label
      ><input id="grants-search" v-model="query" placeholder="Search grants" />
    </div>
    <div class="grants-filter">
      <label for="grants-status" class="sr-only">Grant status</label>
      <select id="grants-status" v-model="filter">
        <option value="">All statuses</option>
        <option v-for="status in statuses" :key="status">{{ status }}</option>
      </select>
    </div>
    <div class="grants-tools">
      <button
        type="button"
        class="grants-icon grants-add"
        :aria-label="creationLabel"
        :title="creationLabel"
        aria-haspopup="dialog"
        :disabled="
          busy || !member?.active || !module?.enabled || (tab === 'rounds' && !member.admin)
        "
        @click="createFromToolbar"
      >
        <Plus :size="32" aria-hidden="true" />
      </button>
      <RouterLink
        class="grants-icon"
        :to="{ path: '/docs/grants-rounds', query: { dao: dao.reference.daoId } }"
        aria-label="Grants rules and help"
        title="Grants rules and help"
        ><CircleHelp :size="24" aria-hidden="true"
      /></RouterLink>
    </div>
  </div>
  <p v-if="!module?.enabled" class="notice">
    An administrator can enable Grants in Modules. Funding also needs Works and Decide.
  </p>
  <p v-if="choicesLoading" role="status">Loading documents and names…</p>
  <p v-if="choicesError" class="notice">
    Documents are unavailable. {{ choicesError }} Existing grants remain readable.
  </p>
  <p v-if="profilesError" class="notice">{{ profilesError }}</p>
  <button
    v-if="choicesError || profilesError"
    type="button"
    class="secondary"
    :disabled="choicesLoading || busy"
    @click="refreshChoices"
  >
    Retry documents and names
  </button>
  <div
    v-if="tab === 'rounds'"
    id="grants-rounds"
    role="tabpanel"
    aria-labelledby="grants-tab-rounds"
    tabindex="0"
  >
    <article v-for="round in visibleRounds" :key="round.id" class="panel grant-record">
      <header class="record-heading">
        <h2>{{ roundTitle(round) }}</h2>
        <span class="status-pill">{{ roundPhase(round) }}</span>
      </header>
      <div class="two-column">
        <p>
          Funding limit <strong>{{ asset(round.maximum) }}</strong
          ><br />Awarded
          <strong>{{ tokenText(BigInt(round.awarded)) }} {{ dao.token.symbol }}</strong>
        </p>
        <p>
          Apply by <strong>{{ date(round.applications_close) }}</strong
          ><br />{{
            round.allow_agents ? 'Humans and active AI agents may apply' : 'Human members may apply'
          }}
        </p>
      </div>
      <details>
        <summary>Round details</summary>
        <p>
          Rules version {{ round.document_version }} · Review by {{ date(round.review_close) }} ·
          Complete funding by {{ date(round.awards_close) }}.
        </p>
        <p>
          The lifetime limit reserves no funds. Awarded amounts stay counted if work is later
          cancelled.
        </p>
        <p class="field-help">Reference: round {{ round.id }}</p>
      </details>
      <div class="button-row">
        <button
          v-if="member?.active && accepts(round)"
          type="button"
          class="secondary"
          :disabled="busy || !module?.enabled"
          @click="apply(round)"
        >
          Apply to this round</button
        ><button
          type="button"
          class="secondary"
          :disabled="busy"
          @click="
            tab = 'applications';
            roundFilter = round.id;
            query = '';
          "
        >
          View applications</button
        ><button
          v-if="member?.active && member.admin && !round.closed && now < round.awards_close"
          type="button"
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
      </div>
    </article>
    <div v-if="!visibleRounds.length" class="empty-state">
      <h2>{{ data.rounds.length ? 'No matching rounds' : 'No grant rounds yet' }}</h2>
      <p>
        {{
          data.rounds.length
            ? 'Change your search or status filter.'
            : 'Create a round to invite proposals under shared rules and deadlines.'
        }}
      </p>
    </div>
  </div>
  <div
    v-else
    id="grants-applications"
    role="tabpanel"
    aria-labelledby="grants-tab-applications"
    tabindex="0"
  >
    <div v-if="roundFilter" class="record-heading">
      <p>
        Applications for {{ filteredRound ? roundTitle(filteredRound) : 'Round ' + roundFilter }}
      </p>
      <button type="button" class="secondary" @click="roundFilter = ''">Show all rounds</button>
    </div>
    <article v-for="app in visibleApps" :key="app.id" class="panel grant-record">
      <header class="record-heading">
        <h2>{{ appTitle(app) }}</h2>
        <span class="status-pill">{{ appStatus(app) }}</span>
      </header>
      <p>{{ memberName(app.contributor) }}</p>
      <p>
        Requested <strong>{{ total(app) }}</strong> · {{ app.payments.length }} milestones
      </p>
      <p>{{ appRoundTitle(app) }}</p>
      <details>
        <summary>Application terms</summary>
        <p>
          Proposal version {{ app.document_version }} · Term {{ date(app.term_start) }} —
          {{ date(app.term_end) }}.
        </p>
        <ul>
          <li v-for="(payment, index) in app.payments" :key="index">
            Milestone {{ index + 1 }}: {{ asset(payment) }}, due {{ date(app.dues[index] ?? 0) }}
          </li>
        </ul>
        <p v-if="app.decision_doc !== '0'">
          Review record: {{ referenceLabel(app.decision_doc, app.decision_version) }}
        </p>
        <p class="field-help">Reference: application {{ app.id }} · revision {{ app.revision }}.</p>
      </details>
      <div class="button-row">
        <button
          v-if="app.status === 0 && app.contributor === member?.memberId"
          type="button"
          :disabled="busy || !accepts(data.rounds.find((round) => round.id === app.round_id))"
          @click="selectApp(app, 'consent')"
        >
          Review and submit
        </button>
        <button
          v-if="
            app.status < 4 &&
            app.contributor === member?.memberId &&
            accepts(data.rounds.find((round) => round.id === app.round_id))
          "
          type="button"
          class="secondary"
          :disabled="busy"
          @click="amend(app)"
        >
          Edit application
        </button>
        <button
          v-if="member?.active && member.admin && reviewable(app)"
          type="button"
          class="secondary"
          :disabled="busy || !module?.enabled"
          @click="selectApp(app, 'review')"
        >
          Review application
        </button>
        <button
          v-if="app.status === 2"
          type="button"
          :disabled="!awardReady(app)"
          @click="selectApp(app, 'award')"
        >
          Propose funding vote
        </button>
        <RouterLink
          v-if="appStatus(app) === 'Funding vote'"
          :to="`/dao/${dao.reference.daoId}/decide`"
          >View funding vote</RouterLink
        >
        <button
          v-if="app.status < 4 && (member?.admin || app.contributor === member?.memberId)"
          type="button"
          class="secondary"
          :disabled="!allowed('closeapp')"
          @click="sign('closeapp', { ...actor(), application_id: app.id }, 'Application closed.')"
        >
          Close application
        </button>
        <RouterLink v-if="app.status === 4" :to="`/dao/${dao.reference.daoId}/works`"
          >Continue in Works</RouterLink
        >
      </div>
    </article>
    <div v-if="!visibleApps.length" class="empty-state">
      <h2>{{ data.applications.length ? 'No matching applications' : 'No applications yet' }}</h2>
      <p>
        {{
          data.applications.length
            ? 'Change your search or status filter.'
            : 'Choose an open round and propose work with clear milestone payments.'
        }}
      </p>
    </div>
  </div>
  <dialog
    v-if="member?.active && module?.enabled"
    ref="dialog"
    class="panel grants-dialog"
    aria-labelledby="grants-dialog-title"
    @cancel="busy && $event.preventDefault()"
  >
    <header class="record-heading">
      <h2 id="grants-dialog-title">{{ title }}</h2>
      <button
        type="button"
        class="grants-icon"
        aria-label="Close grant form"
        :disabled="busy"
        @click="dialog?.close()"
      >
        <X :size="24" aria-hidden="true" />
      </button>
    </header>
    <p v-if="error || actionError" class="alert" role="alert">{{ error || actionError }}</p>
    <p v-if="busy" role="status">Signing and saving…</p>
    <p v-else-if="!canSign" class="notice">
      Choose an authorized signer in Signing &amp; wallets before saving.
    </p>
    <form @submit.prevent="submit">
      <fieldset :disabled="busy">
        <template v-if="mode === 'round'">
          <ol class="grant-steps" aria-label="Create round steps">
            <li
              v-for="(step, index) in ['Rules', 'Funding and dates', 'Review']"
              :key="step"
              :aria-current="roundStep === index ? 'step' : undefined"
            >
              {{ step }}
            </li>
          </ol>
          <template v-if="roundStep === 0">
            <label for="grant-rules">Round rules</label
            ><select id="grant-rules" v-model="rules" required autofocus :disabled="choicesLoading">
              <option value="" disabled>Choose a published document</option>
              <option v-for="doc in documentOptions" :key="doc.id" :value="doc.id">
                {{ documentLabel(doc) }}
              </option>
            </select>
            <p class="field-help">
              Choose a document explaining what the round supports and who qualifies. Its exact
              version stays attached to this round.
            </p>
            <label class="choice"
              ><input v-model="allowAgents" type="checkbox" />Allow active AI agents to apply
              alongside human members</label
            >
          </template>
          <template v-else-if="roundStep === 1">
            <label for="grant-limit">Funding limit ({{ dao.token.symbol }})</label
            ><input
              id="grant-limit"
              v-model="maximum"
              inputmode="numeric"
              pattern="[1-9][0-9]*"
              maxlength="19"
              required
            />
            <p class="field-help">
              Enter whole {{ dao.token.symbol }}. This is the lifetime total that can be awarded,
              not a reserved balance.
            </p>
            <label for="grant-applications-close">Accept applications until</label
            ><input
              id="grant-applications-close"
              v-model="applicationsClose"
              type="datetime-local"
              step="1"
              required
            />
            <label for="grant-review-close">Complete eligibility reviews by</label
            ><input
              id="grant-review-close"
              v-model="reviewClose"
              type="datetime-local"
              step="1"
              required
            />
            <label for="grant-awards-close">Complete funding decisions by</label
            ><input
              id="grant-awards-close"
              v-model="awardsClose"
              type="datetime-local"
              step="1"
              required
            />
            <p class="field-help">
              Dates use your device’s timezone ({{ timezone }}). Each stage must finish after the
              previous one; complete the round within one year.
            </p>
            <p v-if="policy?.policy" class="field-help">
              Allow time for your DAO’s {{ readableDuration(policy.policy.config.duration) }} voting
              period before funding closes.
            </p>
            <p v-if="maximum && !roundState.valid" class="alert" role="alert">
              {{ roundState.error }}
            </p>
          </template>
          <template v-else>
            <h3 tabindex="-1" data-step-focus>Check your round</h3>
            <p>
              {{
                referenceLabel(
                  selectedDocument(rules)?.document_id ?? '0',
                  selectedDocument(rules)?.version ?? 0,
                )
              }}
            </p>
            <p>
              <strong>{{ maximum }} {{ dao.token.symbol }}</strong> lifetime funding limit
            </p>
            <p>
              {{
                allowAgents
                  ? 'Human members and active AI agents may apply.'
                  : 'Human members may apply.'
              }}
            </p>
            <ul>
              <li>Applications close {{ new Date(applicationsClose).toLocaleString() }}</li>
              <li>Reviews finish {{ new Date(reviewClose).toLocaleString() }}</li>
              <li>Funding closes {{ new Date(awardsClose).toLocaleString() }}</li>
            </ul>
            <p class="notice">
              Creating this round reserves no Treasury funds. Funding requires a passed DAO vote and
              enough available Treasury funds when the award is executed.
            </p>
            <label class="choice"
              ><input v-model="roundConfirmed" type="checkbox" />I checked the rules, funding limit
              and deadlines</label
            >
            <p v-if="!worksReady()" class="notice">
              Enable a compatible, verified Works module in Modules before creating a round.
            </p>
          </template>
        </template>
        <template v-else-if="mode === 'application'">
          <label for="grant-round">Grant round</label
          ><select
            id="grant-round"
            v-model="draft.roundId"
            required
            autofocus
            :disabled="!!editing"
          >
            <option value="" disabled>Choose an open round</option>
            <option v-for="round in openRounds" :key="round.id" :value="round.id">
              {{ roundTitle(round) }} · apply by {{ date(round.applications_close) }}
            </option>
          </select>
          <p v-if="!openRounds.length" class="notice">
            No rounds are accepting applications. An administrator can create a round from the
            Rounds tab.
          </p>
          <p v-if="selectedRound" class="field-help">
            Funding limit {{ asset(selectedRound.maximum) }} ·
            {{
              selectedRound.allow_agents
                ? 'Humans and active AI agents may apply.'
                : 'Only human members may apply.'
            }}
          </p>
          <label for="grant-proposal">Proposal document</label
          ><select id="grant-proposal" v-model="draft.proposal" required :disabled="choicesLoading">
            <option value="" disabled>Choose a published document</option>
            <option v-for="doc in documentOptions" :key="doc.id" :value="doc.id">
              {{ documentLabel(doc) }}
            </option>
          </select>
          <p class="field-help">
            Describe the scope, deliverables and review rules in this document. This exact version
            is submitted with your payment terms.
          </p>
          <div class="two-column">
            <label
              >Contribution starts<input
                v-model="draft.start"
                type="datetime-local"
                step="1"
                required /></label
            ><label
              >Contribution ends<input v-model="draft.end" type="datetime-local" step="1" required
            /></label>
          </div>
          <p class="field-help">
            Dates use {{ timezone }}. A contribution term can last up to one year.
          </p>
          <article
            v-for="(milestone, index) in draft.milestones"
            :key="milestone.id"
            class="milestone-editor"
          >
            <header class="record-heading">
              <h3>Milestone {{ index + 1 }}</h3>
              <button
                type="button"
                class="grants-icon"
                :aria-label="'Remove milestone ' + (index + 1)"
                :disabled="draft.milestones.length === 1"
                @click="removeMilestone(milestone.id)"
              >
                <Trash2 :size="20" aria-hidden="true" />
              </button>
            </header>
            <div class="two-column">
              <label :for="'grant-amount-' + milestone.id"
                >Milestone {{ index + 1 }} amount ({{ dao.token.symbol }})<input
                  :id="'grant-amount-' + milestone.id"
                  v-model="milestone.amount"
                  inputmode="numeric"
                  pattern="[1-9][0-9]*"
                  maxlength="19"
                  required /></label
              ><label
                >Milestone {{ index + 1 }} due date<input
                  v-model="milestone.due"
                  type="datetime-local"
                  step="1"
                  :min="draft.start"
                  :max="draft.end"
                  required
              /></label>
            </div>
          </article>
          <button
            type="button"
            class="secondary"
            :disabled="draft.milestones.length >= 16"
            @click="addMilestone"
          >
            Add milestone
          </button>
          <p class="field-help">
            Enter a positive whole {{ dao.token.symbol }} amount for each milestone. Nothing is
            rounded. Up to 16 milestones, each due within the term.
          </p>
          <div class="grant-total">
            <span>Total requested</span
            ><strong role="status" aria-label="Total requested">{{ paymentTotal }}</strong>
          </div>
          <p
            v-if="draft.milestones.some((row) => row.amount) && !applicationState.valid"
            class="alert"
            role="alert"
          >
            {{ applicationState.error }}
          </p>
          <p class="field-help">
            Saving creates a draft. Submitting it next records your consent to the exact document,
            payments, dates and review rules.
          </p>
          <p v-if="editing" class="notice">
            Editing removes previous consent and eligibility. Submit and request review again.
          </p>
          <label class="choice"
            ><input
              v-model="draft.confirmed"
              type="checkbox"
              :disabled="!applicationState.valid || !selectedDocument(draft.proposal)"
            />I checked the proposal, milestone dates and total</label
          >
        </template>
        <template v-else-if="selectedApp">
          <h3>{{ appTitle(selectedApp) }}</h3>
          <p>
            {{ memberName(selectedApp.contributor) }} · {{ total(selectedApp) }} requested ·
            proposal version {{ selectedApp.document_version }}
          </p>
          <p>Term {{ date(selectedApp.term_start) }} — {{ date(selectedApp.term_end) }}</p>
          <ul>
            <li v-for="(payment, index) in selectedApp.payments" :key="index">
              Milestone {{ index + 1 }}: {{ asset(payment) }}, due
              {{ date(selectedApp.dues[index] ?? 0) }}
            </li>
          </ul>
          <template v-if="mode === 'review'"
            ><label for="grant-review-record">Review record</label
            ><select
              id="grant-review-record"
              v-model="decision"
              required
              autofocus
              :disabled="choicesLoading"
            >
              <option value="" disabled>Choose a published document</option>
              <option v-for="doc in documentOptions" :key="doc.id" :value="doc.id">
                {{ documentLabel(doc) }}
              </option>
            </select>
            <p class="field-help">
              Choose the document recording why this application does or does not qualify under the
              round’s rules.
            </p>
            <label for="grant-eligibility">Eligibility decision</label>
            <select id="grant-eligibility" v-model="eligible">
              <option :value="true">Eligible for a funding vote</option>
              <option :value="false">Does not qualify</option>
            </select>
            <p class="notice">
              Eligibility approves no spending. A separate DAO vote must approve funding.
            </p>
            <label class="choice"
              ><input
                v-model="confirmed"
                type="checkbox"
                :disabled="!selectedDocument(decision)"
              />I checked this application and its review record</label
            ></template
          >
          <template v-else-if="mode === 'consent'"
            ><p class="notice">
              Submitting records your consent to these exact terms. Work still requires eligibility
              review and an approved funding vote. Independent review is required before milestone
              payout; cancellation preserves approved liabilities.
            </p>
            <label class="choice"
              ><input v-model="confirmed" type="checkbox" autofocus />I reviewed this exact
              application document, compensation, term, review and cancellation rules</label
            ></template
          >
          <template v-else-if="mode === 'award'"
            ><p v-if="policy?.policy">
              Voting lasts {{ readableDuration(policy.policy.config.duration) }} · quorum
              {{ percentageText(policy.policy.config.quorum) }}% · approval
              {{ percentageText(policy.policy.config.approval) }}%.
            </p>
            <p class="notice">
              This opens a funding vote in Decide. A passed, finalized vote must be executed before
              the deadline; the Treasury must back every milestone then. Delivery and payouts
              continue in Works.
            </p>
            <label class="choice"
              ><input v-model="confirmed" type="checkbox" autofocus />I checked the application
              total and funding terms</label
            ></template
          >
        </template>
        <div
          v-if="
            (mode === 'round' && roundStep === 0) || mode === 'application' || mode === 'review'
          "
          class="grant-documents"
        >
          <p v-if="choicesLoading" role="status">Loading DAO documents…</p>
          <p v-if="choicesError" class="alert" role="alert">
            Could not load DAO documents. {{ choicesError }}
          </p>
          <p v-if="!choicesLoading && !choicesError && !documentOptions.length" class="notice">
            No published documents yet. Publish the rules, proposal or review record in Documents
            first.
          </p>
          <div class="button-row">
            <RouterLink :to="`/dao/${dao.reference.daoId}/documents`" target="_blank" rel="noopener"
              >Open DAO documents</RouterLink
            ><button
              type="button"
              class="secondary"
              :disabled="choicesLoading"
              @click="refreshChoices"
            >
              {{ choicesError ? 'Retry documents and names' : 'Refresh documents and names' }}
            </button>
          </div>
        </div>
        <div class="button-row">
          <button
            v-if="mode === 'round' && roundStep > 0"
            type="button"
            class="secondary"
            @click="roundStep--"
          >
            Back
          </button>
          <button
            v-if="mode === 'round' && roundStep < 2"
            type="button"
            :disabled="
              choicesLoading || (roundStep === 0 ? !selectedDocument(rules) : !roundState.valid)
            "
            @click="nextStep"
          >
            Next
          </button>
          <button
            v-else-if="mode === 'round'"
            :disabled="
              !member.admin ||
              !allowed('newround') ||
              !selectedDocument(rules) ||
              !roundState.valid ||
              !roundConfirmed ||
              !worksReady()
            "
          >
            Create round
          </button>
          <button
            v-else-if="mode === 'application'"
            :disabled="
              choicesLoading ||
              !allowed(editing ? 'amend' : 'applygrant') ||
              !selectedDocument(draft.proposal) ||
              !applicationState.valid ||
              !draft.confirmed
            "
          >
            Save draft
          </button>
          <button
            v-else-if="mode === 'review'"
            :disabled="
              choicesLoading ||
              !member.admin ||
              !allowed('reviewapp') ||
              !reviewable(selectedApp) ||
              !selectedDocument(decision) ||
              !confirmed
            "
          >
            Save eligibility decision
          </button>
          <button
            v-else-if="mode === 'consent'"
            :disabled="
              !allowed('submitapp') ||
              !selectedApp ||
              selectedApp.status !== 0 ||
              !confirmed ||
              !accepts(data.rounds.find((round) => round.id === selectedApp?.round_id))
            "
          >
            Sign consent and submit
          </button>
          <button v-else-if="mode === 'award'" :disabled="!awardReady(selectedApp) || !confirmed">
            Open funding vote
          </button>
          <button type="button" class="secondary" @click="dialog?.close()">Cancel</button>
        </div>
      </fieldset>
    </form>
  </dialog>
</template>
<style scoped>
.grants-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.grants-toolbar .account-tabs {
  margin: 0;
}
.grants-toolbar .account-tabs button {
  min-height: 44px;
}
.grants-search {
  flex: 1 1 180px;
  min-width: 0;
}
.grants-filter {
  flex: 0 1 180px;
  margin: 0;
}
.grants-tools,
.record-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.grants-tools {
  margin-left: auto;
  flex: none;
}
.record-heading {
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.record-heading h2,
.record-heading h3 {
  margin: 0;
  overflow-wrap: anywhere;
}
.record-heading h2 {
  font-size: 1.15rem;
}
.grants-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--accent-amber);
  background: transparent;
  box-shadow: none;
}
.grants-icon :deep(svg) {
  width: 24px;
  height: 24px;
}
.grants-add :deep(svg) {
  width: 32px;
  height: 32px;
}
.grants-icon:hover {
  transform: none;
  background: var(--accent-soft);
  box-shadow: none;
}
.status-pill {
  padding: 6px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-size: 0.8rem;
}
.grant-record .button-row {
  margin-top: 20px;
}
.grants-dialog {
  width: min(840px, calc(100% - 32px));
  max-height: calc(100dvh - 48px);
  overflow: auto;
  margin: auto;
  color: var(--text-primary);
}
.grants-dialog::backdrop {
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
}
.grants-dialog fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.grant-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0;
  list-style: none;
  margin-bottom: 24px;
  color: var(--text-secondary);
}
.grant-steps li {
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
}
.grant-steps [aria-current] {
  color: var(--accent-amber);
  border-color: var(--border-warm);
  background: var(--accent-soft);
}
.milestone-editor {
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}
.grant-total {
  padding: 16px;
  margin-block: 20px;
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
}
.grant-total strong {
  display: block;
  margin-top: 8px;
  font-size: 1.25rem;
  overflow-wrap: anywhere;
}
.grant-documents {
  margin-block: 20px;
}
@media (max-width: 640px) {
  .grants-toolbar .account-tabs {
    width: 100%;
  }
  .grants-filter {
    flex: 1 1 140px;
  }
  .grants-dialog {
    padding: 20px;
  }
}
</style>
