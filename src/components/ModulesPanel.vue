<script setup lang="ts">
import ElectionPanel from './ElectionPanel.vue';
import GrantsPanel from './GrantsPanel.vue';
import ContributionAgreementPanel from './ContributionAgreementPanel.vue';
import ServiceCatalogue from './ServiceCatalogue.vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { z } from 'zod';
import {
  parseUnits,
  formatUnits,
  type Treasury,
  type DaoContent,
  type DaoSummary,
  type UserMembership,
  type GovernanceState,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { DecideConfigSchema, ModulePermissions, type ModuleState } from '@daclify/modules';
import { encodeDecide, encodeWorks, encodePayroll } from '@daclify/modules/sdk';
import { api, friendlyError } from '../api/client';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
const signerReady = computed(() => canSignMember(props.member));
import { useWorkspace } from '../state/workspace';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  section: string;
  focusAccount?: string;
}>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const workspace = useWorkspace();
const data = ref<ModuleState>();
const governance = ref<GovernanceState>();
const content = ref<DaoContent>();
const governedWorks = computed(() => governance.value?.policy?.config.governed_works === true);
let generation = 0;
let disposed = false;
const context = computed(() =>
  JSON.stringify([
    props.dao.reference,
    workspace.account?.id,
    props.member?.memberId,
    props.dao.privacy,
  ]),
);
const loading = ref(false);
const busy = ref(false);
watch(busy, (value) => emit('busy', value), { flush: 'sync' });
const error = ref('');
const success = ref('');
const title = ref('');
const weight = ref<'member' | 'credit' | 'native-stake'>('member');
const duration = ref(300);
const quorum = ref(5000);
const approval = ref(5001);
const contributor = ref('1');
const documentId = ref('1');
const documentVersion = ref(1);
const milestoneAmounts = ref('1.0000');
const milestoneDue = ref('');
const agreementSearch = ref('');
const agreementsOnly = ref(false);
const periods = ref(2);
const intervalDays = ref(30);
const treasury = ref<Treasury>();
const now = ref(Math.floor(Date.now() / 1000));
const clock = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
}, 1000);
onBeforeUnmount(() => {
  disposed = true;
  emit('busy', false);
  generation++;
  clearInterval(clock);
});
const submissionDoc = ref('');
const submissionVersion = ref(1);
const reviewDoc = ref('');
const reviewVersion = ref(1);
const selectedMilestone = ref('');
const payrollStarts = ref(new Date(Date.now() + 60000).toISOString().slice(0, 19));
const payrollQuery = ref('');
const showOngoing = ref(true);
const draftLabel = ref<Record<string, string>>({});
const draftPaused = ref<Record<string, boolean>>({});
const names = {
  decide: 'Decide',
  works: 'Works',
  payroll: 'Payroll',
  'grants-rounds': 'Grants rounds',
  'endorsement-admission': 'Endorsement admission',
};
const canSign = computed(() => !!props.member?.active && signerReady.value && !busy.value);
const current = computed(() => data.value?.modules.find((m) => m.deployment.id === props.section));
const listedModules = computed(
  () =>
    data.value?.modules.filter(
      (module) => !props.focusAccount || module.deployment.account === props.focusAccount,
    ) ?? [],
);
const limitedActions = computed(() => {
  const module = current.value;
  if (!module?.enabled) return false;
  return ModulePermissions[module.deployment.id].actions.some(
    (action) => !module.actions.includes(action),
  );
});
const canAct = computed(
  () =>
    canSign.value &&
    !!current.value?.enabled &&
    current.value.compatible &&
    current.value.codeVerified,
);
function fundAllowed() {
  const decide = data.value?.modules.find((module) => module.deployment.id === 'decide');
  return (
    canAct.value &&
    !!decide?.enabled &&
    decide.compatible &&
    decide.codeVerified &&
    decide.actions.includes('openwork')
  );
}
function allowed(action: string) {
  return canAct.value && !!current.value?.actions.includes(action);
}
const canSettle = computed(() => !!workspace.account && !busy.value);
function helpLink(topic: string) {
  return { path: `/docs/${topic}`, query: { dao: props.dao.reference.daoId } };
}
function newId(): string {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(values[0] ?? 0) << 32n) | BigInt(values[1] ?? 0) || 1n).toString();
}
function actor() {
  if (!props.member) throw new Error('AUTH_REQUIRED');
  return {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: props.member.memberId,
  };
}
async function load(more = false) {
  const request = ++generation;
  const domain = context.value;
  loading.value = true;
  try {
    const [modules, records, policy, documents] = await Promise.all([
      api.moduleState(props.dao.reference.daoId, {
        ...(props.member ? { memberId: props.member.memberId } : {}),
        ...(more && data.value
          ? {
              ballots: props.section === 'decide' ? (data.value.next.ballots ?? 'done') : 'done',
              projects: props.section === 'works' ? (data.value.next.projects ?? 'done') : 'done',
              schedules:
                props.section === 'payroll' ? (data.value.next.schedules ?? 'done') : 'done',
              joinApplications: 'done',
              elections:
                props.section === 'decide' ? (data.value.next.elections ?? 'done') : 'done',
              terms: props.section === 'decide' ? (data.value.next.terms ?? 'done') : 'done',
              rounds:
                props.section === 'grants-rounds' ? (data.value.next.rounds ?? 'done') : 'done',
              applications:
                props.section === 'grants-rounds'
                  ? (data.value.next.applications ?? 'done')
                  : 'done',
            }
          : {}),
      }),
      api.treasury(props.dao.reference.daoId),
      workspace.network?.capabilities.includes('governance-policy')
        ? api.governance(props.dao.reference.daoId)
        : Promise.resolve(undefined),
      ['works', 'payroll', 'grants-rounds'].includes(props.section)
        ? api.content(props.dao.reference.daoId)
        : Promise.resolve(undefined),
    ]);
    if (disposed || request !== generation || domain !== context.value) return;
    if (
      [
        modules.dao,
        records.dao,
        ...(policy ? [policy.dao] : []),
        ...(documents ? [documents.dao] : []),
      ].some((reference) => JSON.stringify(reference) !== JSON.stringify(props.dao.reference))
    )
      throw new Error('DAO_REFERENCE');
    if (more && data.value) {
      const previous = data.value;
      modules.ballots.unshift(...previous.ballots);
      modules.votes.unshift(...previous.votes);
      modules.executions.unshift(...previous.executions);
      modules.projects.unshift(...previous.projects);
      modules.milestones.unshift(...previous.milestones);
      modules.agreements.unshift(...previous.agreements);
      modules.schedules.unshift(...previous.schedules);
      modules.entries.unshift(...previous.entries);
      modules.controls.unshift(...previous.controls);
      modules.elections.unshift(...previous.elections);
      modules.nominations.unshift(...previous.nominations);
      modules.terms.unshift(...previous.terms);
      modules.grantPlans.unshift(...previous.grantPlans);
      modules.rounds.unshift(...previous.rounds);
      modules.applications.unshift(...previous.applications);
      modules.next = {
        ...previous.next,
        ...(props.section === 'decide'
          ? {
              ballots: modules.next.ballots,
              elections: modules.next.elections,
              terms: modules.next.terms,
            }
          : props.section === 'works'
            ? { projects: modules.next.projects }
            : props.section === 'grants-rounds'
              ? { rounds: modules.next.rounds, applications: modules.next.applications }
              : { schedules: modules.next.schedules }),
      };
    }
    data.value = modules;
    treasury.value = records;
    governance.value = policy;
    content.value = documents;
    if (policy?.policy) {
      const saved = policy.policy.config;
      weight.value = saved.kind === 0 ? 'member' : saved.kind === 1 ? 'credit' : 'native-stake';
      duration.value = saved.duration;
      quorum.value = saved.quorum;
      approval.value = saved.approval;
    }
    const labels = { ...draftLabel.value };
    const pauses = { ...draftPaused.value };
    for (const schedule of modules.schedules) {
      const control = modules.controls.find((row) => row.schedule_id === schedule.id);
      if (labels[schedule.id] === undefined) labels[schedule.id] = control?.label ?? '';
      if (pauses[schedule.id] === undefined) pauses[schedule.id] = control?.paused === 1;
    }
    draftLabel.value = labels;
    draftPaused.value = pauses;
  } catch (cause) {
    if (!disposed && request === generation && domain === context.value)
      error.value = friendlyError(cause);
  } finally {
    if (!disposed && request === generation) loading.value = false;
  }
}
watch(
  context,
  () => {
    generation++;
    data.value = undefined;
    treasury.value = undefined;
    governance.value = undefined;
    content.value = undefined;
    title.value = '';
    contributor.value = '';
    documentId.value = '';
    submissionDoc.value = '';
    reviewDoc.value = '';
    selectedMilestone.value = '';
    draftLabel.value = {};
    draftPaused.value = {};
    error.value = '';
    success.value = '';
    void load();
  },
  { immediate: true, flush: 'sync' },
);
watch(
  () => props.section,
  () => {
    void load();
  },
);
async function run(target: string, action: string, payload: Uint8Array, message: string) {
  if (disposed || !props.member || !canSign.value) return;
  if (
    target !== props.dao.reference.contract &&
    !data.value?.modules.some(
      (module) =>
        module.deployment.account === target &&
        module.enabled &&
        module.compatible &&
        module.codeVerified &&
        module.actions.includes(action),
    )
  )
    return;
  const domain = context.value;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        props.dao.reference,
        props.member.memberId,
        props.member.nonce,
        Math.floor(Date.now() / 1000) + 300,
        target,
        action,
        payload,
      ),
    );
    if (disposed || domain !== context.value) return;
    await workspace.refresh();
    if (disposed || domain !== context.value) return;
    await load();
    if (disposed || domain !== context.value) return;
    success.value = message;
  } catch (cause) {
    if (!disposed && domain === context.value) error.value = friendlyError(cause);
  } finally {
    if (!disposed && domain === context.value) busy.value = false;
  }
}
async function install(module: ModuleState['modules'][number]) {
  const permission = ModulePermissions[module.deployment.id];
  await run(
    props.dao.reference.contract,
    'modconfig',
    encodeAction('modconfig', {
      ...actor(),
      account: module.deployment.account,
      version: 1,
      actions: [...permission.actions],
      grants: [...permission.grants],
      code_hash: module.deployment.codeHash,
    }),
    `${names[module.deployment.id]} enabled`,
  );
}
async function disable(module: ModuleState['modules'][number]) {
  await run(
    props.dao.reference.contract,
    'modconfig',
    encodeAction('modconfig', {
      ...actor(),
      account: module.deployment.account,
      version: 1,
      actions: [],
      grants: [],
      code_hash: '00'.repeat(32),
    }),
    `${names[module.deployment.id]} disabled. Approved obligations remain payable.`,
  );
}
async function open() {
  if (!current.value) return;
  try {
    const config = DecideConfigSchema.parse({
      configVersion: 1,
      weight: weight.value,
      duration: duration.value,
      quorumBasisPoints: quorum.value,
      approvalBasisPoints: approval.value,
    });
    await run(
      current.value.deployment.account,
      'open',
      encodeDecide('open', {
        ...actor(),
        ballot_id: newId(),
        kind: config.weight === 'member' ? 0 : config.weight === 'credit' ? 1 : 2,
        choices: 2,
        duration: config.duration,
        quorum: config.quorumBasisPoints,
        approval: config.approvalBasisPoints,
        metadata: title.value
          ? JSON.stringify({ schemaVersion: 1, title: title.value, options: ['Reject', 'Approve'] })
          : '{}',
      }),
      'Ballot opened',
    );
    title.value = '';
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function vote(id: string, choice: number) {
  if (current.value)
    await run(
      current.value.deployment.account,
      'vote',
      encodeDecide('vote', { ...actor(), ballot_id: id, choice }),
      'Vote recorded',
    );
}
function ballotTitle(ballot: ModuleState['ballots'][number]): string {
  try {
    const metadata = z.object({ title: z.string().max(160) }).parse(JSON.parse(ballot.metadata));
    return metadata.title;
  } catch {
    return `Ballot ${ballot.id}`;
  }
}
function ownVote(id: string) {
  return data.value?.votes.find((v) => v.ballot === id && v.member === props.member?.memberId);
}
function asset(value: string): string {
  return `${formatUnits(parseUnits(value.trim(), props.dao.token.precision), props.dao.token.precision)} ${props.dao.token.symbol}`;
}
async function propose() {
  if (!current.value) return;
  try {
    const payments = milestoneAmounts.value
      .split('\n')
      .filter((v) => v.trim())
      .map(asset);
    await run(
      current.value.deployment.account,
      'propose',
      encodeWorks('propose', {
        ...actor(),
        project_id: newId(),
        contributor: contributor.value,
        document_id: documentId.value,
        document_version: documentVersion.value,
        payments,
        dues: payments.map(() =>
          milestoneDue.value ? Math.floor(new Date(milestoneDue.value).getTime() / 1000) : 0,
        ),
      }),
      'Work proposed',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
const visibleProjects = computed(
  () =>
    data.value?.projects.filter(
      (project) =>
        (!agreementsOnly.value ||
          data.value?.agreements.some((a) => a.project_id === project.id)) &&
        `${project.id} ${project.contributor}`.includes(agreementSearch.value.trim()),
    ) ?? [],
);
function consentReady(project: string) {
  const agreement = data.value?.agreements.find((a) => a.project_id === project);
  return !agreement || agreement.accepted;
}
async function offerAgreement(project_id: string, term_start: number, term_end: number) {
  if (current.value)
    await run(
      current.value.deployment.account,
      'offeragr',
      encodeWorks('offeragr', { ...actor(), project_id, term_start, term_end }),
      'Agreement offered; contributor consent is required before funding.',
    );
}
async function acceptAgreement(project_id: string) {
  if (current.value)
    await run(
      current.value.deployment.account,
      'acceptagr',
      encodeWorks('acceptagr', { ...actor(), project_id }),
      'Agreement terms accepted. Funding still requires DAO approval.',
    );
}
async function accept(projectId: string) {
  if (current.value)
    await run(
      current.value.deployment.account,
      'accept',
      encodeWorks('accept', { ...actor(), project_id: projectId }),
      'Milestone funds reserved',
    );
}
async function fund(projectId: string) {
  const decide = data.value?.modules.find((module) => module.deployment.id === 'decide');
  const works = data.value?.modules.find((module) => module.deployment.id === 'works');
  const policy = governance.value?.policy;
  if (!decide?.enabled || !decide.compatible || !decide.codeVerified || !works || !policy) {
    error.value = 'Enable the compatible Decide module before proposing funding.';
    return;
  }
  await run(
    decide.deployment.account,
    'openwork',
    encodeDecide('openwork', {
      ...actor(),
      ballot_id: newId(),
      works: works.deployment.account,
      project_id: projectId,
      duration: policy.config.duration,
      quorum: policy.config.quorum,
      approval: policy.config.approval,
      metadata: '{}',
    }),
    'Funding vote opened. Finalize it in Decide, then execute a passed result.',
  );
}
async function execute(id: string) {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await api.execute(props.dao.reference, id);
    await workspace.refresh();
    await load();
    success.value =
      result.state === 'executed'
        ? 'Approved Works funds reserved. Deliverables still require review.'
        : 'Funding was already executed.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function commit() {
  if (!current.value) return;
  try {
    const starts = Math.floor(Date.parse(`${payrollStarts.value}Z`) / 1000);
    if (!Number.isFinite(starts) || starts <= Math.floor(Date.now() / 1000))
      throw new Error('PAYROLL_START');
    await run(
      current.value.deployment.account,
      'commit',
      encodePayroll('commit', {
        ...actor(),
        schedule_id: newId(),
        recipient: contributor.value,
        quantity: asset(milestoneAmounts.value),
        periods: periods.value,
        interval: intervalDays.value * 86400,
        starts,
      }),
      'Funded payroll committed',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
function obligation(id: string) {
  return treasury.value?.obligations.find(
    (row) => row.source === current.value?.deployment.account && row.source_id === id,
  );
}
function paymentStatus(id: string): string {
  const record = obligation(id);
  return record
    ? (['Reserved', 'Approved', 'Settled', 'Cancelled'][record.status] ?? 'Unknown state')
    : 'Not reserved';
}
function payable(id: string): boolean {
  const record = obligation(id);
  return record?.status === 1 && record.due <= now.value;
}
function scheduleEntries(scheduleId: string) {
  return (data.value?.entries ?? [])
    .filter((row) => row.schedule_id === scheduleId)
    .sort((left, right) => left.due - right.due);
}
function controlFor(scheduleId: string) {
  return data.value?.controls.find((row) => row.schedule_id === scheduleId);
}
function pausedSchedule(scheduleId: string): boolean {
  return controlFor(scheduleId)?.paused === 1;
}
function lastPayout(scheduleId: string): string {
  const payout = controlFor(scheduleId)?.last_payout ?? 0;
  return payout > 0 ? new Date(payout * 1000).toLocaleString() : 'none';
}
function outstandingEntry(scheduleId: string) {
  return scheduleEntries(scheduleId).find((entry) => payable(entry.id));
}
const visibleSchedules = computed(() => {
  const query = payrollQuery.value.trim().toLowerCase();
  return (data.value?.schedules ?? []).filter((schedule) => {
    const entries = scheduleEntries(schedule.id);
    const open = entries.some((entry) => obligation(entry.id)?.status !== 2);
    if (showOngoing.value && entries.length > 0 && !open) return false;
    if (!query) return true;
    const label = controlFor(schedule.id)?.label ?? '';
    return (
      schedule.id.includes(query) ||
      schedule.recipient.includes(query) ||
      label.toLowerCase().includes(query)
    );
  });
});
async function editSchedule(scheduleId: string) {
  if (!current.value) return;
  const label = draftLabel.value[scheduleId] ?? '';
  await run(
    current.value.deployment.account,
    'edit',
    encodePayroll('edit', {
      ...actor(),
      schedule_id: scheduleId,
      paused: draftPaused.value[scheduleId] ? 1 : 0,
      label,
    }),
    'Payroll settings saved',
  );
}
async function payOutstanding(scheduleId: string) {
  const entry = outstandingEntry(scheduleId);
  if (!entry || pausedSchedule(scheduleId)) return;
  await settle(entry.id);
}
async function settle(id: string) {
  const module = current.value;
  if (!module) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await api.settle({
      dao: props.dao.reference,
      source: module.deployment.account,
      sourceId: id,
    });
    await workspace.refresh();
    await load();
    success.value =
      result.state === 'already-settled' ? 'Payment was already settled.' : 'Payment settled.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function finalize(id: string) {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await api.finalize({ dao: props.dao.reference, ballotId: id });
    await workspace.refresh();
    await load();
    success.value =
      result.state === 'already-finalized' ? 'Ballot was already finalized.' : 'Ballot finalized.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function submitWork() {
  if (!current.value) return;
  try {
    await run(
      current.value.deployment.account,
      'submitwork',
      encodeWorks('submitwork', {
        ...actor(),
        milestone_id: selectedMilestone.value,
        document_id: submissionDoc.value,
        document_version: submissionVersion.value,
      }),
      'Milestone submitted for review',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function reviewWork(approve: boolean) {
  if (!current.value) return;
  try {
    await run(
      current.value.deployment.account,
      'review',
      encodeWorks('review', {
        ...actor(),
        milestone_id: selectedMilestone.value,
        approve,
        document_id: reviewDoc.value,
        document_version: reviewVersion.value,
      }),
      approve ? 'Milestone approved. Payment remains to be settled.' : 'Changes requested',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function cancelWork(id: string) {
  if (current.value)
    await run(
      current.value.deployment.account,
      'cancel',
      encodeWorks('cancel', { ...actor(), project_id: id }),
      'Project cancelled. Approved payments remain payable.',
    );
}
const selectedWork = computed(() =>
  data.value?.milestones.find((row) => row.id === selectedMilestone.value),
);
const selectedProject = computed(() =>
  data.value?.projects.find((row) => row.id === selectedWork.value?.project_id),
);
</script>
<template>
  <datalist id="work-members">
    <option
      v-for="person in content?.members.filter((person) => person.active)"
      :key="person.id"
      :value="person.id"
    >
      Member {{ person.id }} {{ person.native_account }}
    </option>
  </datalist>
  <datalist id="work-documents">
    <option v-for="document in content?.documents" :key="document.id" :value="document.document_id">
      Document {{ document.document_id }} · version {{ document.version }}
    </option>
  </datalist>

  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="success" class="notice" role="status">{{ success }}</p>
  <p v-if="loading" role="status">Reading contract state…</p>
  <template v-if="section === 'modules'"
    ><div v-if="!focusAccount" class="section-toolbar">
      <h2>DAO modules</h2>
      <RouterLink :to="helpLink('modules')">Permissions &amp; versions ↗</RouterLink>
    </div>
    <div class="dao-grid">
      <article
        v-for="module in listedModules"
        :key="module.deployment.id"
        class="panel module-card"
      >
        <div class="panel-heading">
          <h3>{{ names[module.deployment.id] }}</h3>
          <span class="pill">{{ module.enabled ? 'Enabled' : 'Available' }}</span>
        </div>
        <p v-if="!focusAccount" class="muted">
          v{{ module.deployment.version }} · Interface {{ module.manifest.interfaceVersion }}
        </p>
        <p>
          {{
            module.deployment.id === 'decide'
              ? 'Member, credit, or escrowed native stake ballots.'
              : module.deployment.id === 'works'
                ? 'Reserved milestones with independent contributor review.'
                : module.deployment.id === 'grants-rounds'
                  ? 'Application consent, eligibility review and vote-authorized Works awards.'
                  : module.deployment.id === 'endorsement-admission'
                    ? 'Opt-in membership with current member endorsements and a disclosed admission policy.'
                    : 'One settlement pays every due installment. Pause and the label do not rewrite the term.'
          }}
        </p>
        <dl>
          <dt>Contract</dt>
          <dd class="mono">{{ module.deployment.account }}</dd>
          <dt>Code</dt>
          <dd>{{ module.codeVerified ? 'Build hash verified' : 'Unverified deployment' }}</dd>
          <dt>Compatibility</dt>
          <dd>{{ module.compatible ? 'Compatible' : 'Incompatible release' }}</dd>
        </dl>
        <p class="field-help">
          {{ module.enabled ? 'Installed grants' : 'Enabling requests' }}:
          {{
            module.enabled
              ? module.grants.join(', ') || 'None'
              : ModulePermissions[module.deployment.id].grants.join(', ')
          }}. The contract’s upgrade authority can change its behavior.
        </p>
        <button
          v-if="!module.enabled && member?.admin"
          :disabled="!canSign || !module.compatible || !module.codeVerified"
          @click="install(module)"
        >
          Enable {{ names[module.deployment.id] }}</button
        ><button
          v-else-if="module.enabled && member?.admin && !focusAccount"
          class="secondary"
          :disabled="!canSign"
          @click="disable(module)"
        >
          Disable {{ names[module.deployment.id] }}</button
        ><RouterLink class="help-link" :to="helpLink(module.deployment.id)"
          >Module guide ↗</RouterLink
        >
      </article>
    </div>
    <p v-if="data && !listedModules.length" class="notice">
      {{
        focusAccount
          ? 'This module is not available in this DAO’s configured deployments.'
          : 'No module deployments are configured on this service. Connect a compatible release to enable it.'
      }}
    </p></template
  >
  <template v-else
    ><div class="section-toolbar">
      <h2>{{ current ? names[current.deployment.id] : 'Module workspace' }}</h2>
      <RouterLink :to="helpLink(section)">Rules &amp; help ↗</RouterLink>
    </div>
    <p v-if="current && (!current.codeVerified || !current.compatible)" class="alert" role="alert">
      New actions are unavailable because this deployment does not match the installed code pin or
      supported release. An administrator must review the upgrade and permissions in Modules.
      Existing approved Treasury liabilities remain separate.
    </p>
    <p v-if="limitedActions" class="notice">
      This DAO has limited this module’s actions. An administrator can review the permissions in
      Modules; unavailable actions remain disabled.
    </p>
    <section v-if="!current?.enabled" class="panel">
      <h3>Enable this module</h3>
      <p>
        A DAO administrator must grant its contract permissions before member actions become
        available.
      </p>
      <RouterLink class="button secondary" :to="`/dao/${dao.reference.daoId}/modules`"
        >Configure modules</RouterLink
      >
    </section>
    <template v-if="section === 'decide'"
      ><form
        v-if="member?.active && current?.enabled"
        class="panel form-panel"
        @submit.prevent="open"
      >
        <h3>Open a binary ballot</h3>
        <label for="ballot-title">Public ballot title</label
        ><input id="ballot-title" v-model="title" maxlength="160" />
        <p class="field-help">
          This label is public on chain. Leave it blank to avoid publishing a title.
        </p>
        <div class="three-column">
          <div>
            <label for="weight">Voting weight</label
            ><select id="weight" v-model="weight" :disabled="!!governance?.policy">
              <option value="member">Equal active members</option>
              <option value="credit">Governance credits</option>
              <option value="native-stake">Escrowed native stake</option>
            </select>
          </div>
          <div>
            <label for="duration">Duration (seconds)</label
            ><input
              id="duration"
              v-model.number="duration"
              :disabled="!!governance?.policy"
              type="number"
              min="60"
              max="2592000"
              required
            />
          </div>
          <div>
            <label for="quorum">Quorum (basis points)</label
            ><input
              id="quorum"
              v-model.number="quorum"
              :disabled="!!governance?.policy"
              type="number"
              min="1"
              max="10000"
              required
            />
          </div>
        </div>
        <label for="approval">Approval (basis points)</label
        ><input
          id="approval"
          v-model.number="approval"
          :disabled="!!governance?.policy"
          type="number"
          min="5001"
          max="10000"
          required
        />
        <p class="field-help">
          5000 = 50%. Weight is frozen at opening. New members cannot vote in an existing ballot.
        </p>
        <button :disabled="!allowed('open')">Open ballot</button>
      </form>
      <div v-if="!data?.ballots.length" class="empty-state">
        <h3>No ballots yet</h3>
        <p>Open a decision with an explicit weight, quorum, and closing time.</p>
      </div>
      <ElectionPanel
        v-if="data"
        :key="context"
        :dao="dao"
        :member="member"
        :data="data"
        :governance="governance"
        :can-sign="canSign"
        :can-finalize="canSettle"
        :now="now"
        :run="run"
        :finalize="finalize"
      />
      <article
        v-for="ballot in data?.ballots.filter((b) => !data?.elections.some((e) => e.id === b.id))"
        :key="ballot.id"
        class="panel"
      >
        <div class="panel-heading">
          <h3>{{ ballotTitle(ballot) }}</h3>
          <span class="pill">{{
            ballot.status === 0
              ? ballot.closes <= now
                ? 'Awaiting finalization'
                : 'Open'
              : ballot.status === 1
                ? 'Passed'
                : 'Not passed'
          }}</span>
        </div>
        <p>
          {{ ballot.cast }} / {{ ballot.denominator }} eligible weight cast. Closes
          {{ new Date(ballot.closes * 1000).toLocaleString() }}.
        </p>
        <p v-if="ownVote(ballot.id)">
          Your vote: {{ ownVote(ballot.id)?.choice === 1 ? 'Approve' : 'Reject' }}
        </p>
        <div
          v-else-if="ballot.status === 0 && ballot.closes > now && current?.enabled"
          class="button-row"
        >
          <button class="secondary" :disabled="!allowed('vote')" @click="vote(ballot.id, 0)">
            Vote Reject</button
          ><button :disabled="!allowed('vote')" @click="vote(ballot.id, 1)">Vote Approve</button>
        </div>
        <button
          v-if="ballot.status === 0 && ballot.closes <= now"
          :disabled="!canSettle || !current?.codeVerified || !current.compatible"
          @click="finalize(ballot.id)"
        >
          Finalize ballot {{ ballot.id }}
        </button>
        <p class="field-help">
          Reject {{ ballot.tallies[0] ?? '0' }} · Approve {{ ballot.tallies[1] ?? '0' }}
        </p>
        <template
          v-for="execution in [...(data?.executions ?? []), ...(data?.grantPlans ?? [])].filter(
            (execution) => execution.ballot_id === ballot.id,
          )"
          :key="execution.ballot_id"
        >
          <p class="field-help">
            Funds Works project {{ execution.project_id }} · policy revision
            {{ execution.policy_revision }} · execute by
            {{ new Date(execution.deadline * 1000).toISOString() }}.
          </p>
          <p v-if="execution.executed" role="status">Funding executed</p>
          <button
            v-else-if="ballot.status === 1"
            :disabled="!canSettle"
            @click="execute(ballot.id)"
          >
            Execute approved funding
          </button>
        </template>
      </article></template
    >
    <GrantsPanel
      v-else-if="section === 'grants-rounds' && data"
      :key="context"
      :dao="dao"
      :member="member"
      :data="data"
      :policy="governance"
      :can-sign="canSign"
      :run="run"
    />
    <template v-else-if="section === 'works'"
      ><form
        v-if="member?.active && current?.enabled"
        class="panel form-panel"
        @submit.prevent="propose"
      >
        <h3>Propose milestone work</h3>
        <p>
          1. Publish the proposal document. 2. Choose a contributor, offer an agreement if needed,
          then request funding. 3. Submit evidence. 4. An independent reviewer approves payment.
        </p>
        <RouterLink :to="`/dao/${dao.reference.daoId}/documents`">Open DAO documents</RouterLink>
        <label for="contributor">Contributor member ID</label
        ><input
          id="contributor"
          v-model="contributor"
          list="work-members"
          inputmode="numeric"
          required
        />
        <div class="two-column">
          <div>
            <label for="work-document">Proposal document ID</label
            ><input
              id="work-document"
              v-model="documentId"
              list="work-documents"
              inputmode="numeric"
              required
            />
          </div>
          <div>
            <label for="work-version">Document version</label
            ><input
              id="work-version"
              v-model.number="documentVersion"
              type="number"
              min="1"
              required
            />
          </div>
        </div>
        <label for="milestones">Milestone amounts · one per line ({{ dao.token.symbol }})</label
        ><textarea id="milestones" v-model="milestoneAmounts" rows="3" required></textarea>
        <label for="work-due">Milestone due date (optional; applies to each milestone)</label
        ><input id="work-due" v-model="milestoneDue" type="datetime-local" />
        <p class="field-help">
          Use due dates when offering a contribution agreement. For different milestone due dates,
          use the documented native action.
        </p>
        <p class="field-help">
          Use an existing durable document. Acceptance reserves the full project amount; review
          approves each payment.
        </p>
        <button :disabled="!allowed('propose')">Propose work</button>
      </form>
      <ServiceCatalogue
        :content="content"
        :dao="dao.reference"
        :can-propose="allowed('propose')"
        @choose="contributor = $event"
      />
      <div class="section-toolbar">
        <label>Find project or contributor<input v-model="agreementSearch" type="search" /></label
        ><label class="checkbox"
          ><input v-model="agreementsOnly" type="checkbox" />Contribution agreements only</label
        >
      </div>
      <article v-for="project in visibleProjects" :key="project.id" class="panel">
        <h3>Project {{ project.id }}</h3>
        <p>
          Contributor {{ project.contributor }} · Document {{ project.document_id }} / v{{
            project.document_version
          }}
          ·
          {{ project.status === 0 ? 'Proposed' : project.status === 1 ? 'Accepted' : 'Cancelled' }}
        </p>
        <ContributionAgreementPanel
          :project="project"
          :milestones="data?.milestones.filter((m) => m.project_id === project.id) ?? []"
          :agreement="data?.agreements.find((a) => a.project_id === project.id)"
          :member="member"
          :offer-allowed="allowed('offeragr')"
          :accept-allowed="allowed('acceptagr')"
          :busy="busy"
          @offer="offerAgreement"
          @accept="acceptAgreement"
        />
        <button
          v-if="project.status === 0 && !governedWorks && member?.active && member.admin"
          :disabled="!allowed('accept') || !consentReady(project.id)"
          @click="accept(project.id)"
        >
          Accept and reserve funds</button
        ><button
          v-if="project.status === 0 && governedWorks && member?.active"
          :disabled="!fundAllowed() || !consentReady(project.id)"
          @click="fund(project.id)"
        >
          Propose funding vote</button
        ><button
          v-if="project.status <= 1 && member?.active && member.admin"
          class="secondary"
          :disabled="!allowed('cancel')"
          @click="cancelWork(project.id)"
        >
          Cancel project {{ project.id }}
        </button>
        <ul class="milestone-list">
          <li
            v-for="milestone in data?.milestones.filter((m) => m.project_id === project.id)"
            :key="milestone.id"
          >
            <p>
              Milestone {{ milestone.id }} · {{ milestone.quantity }} ·
              {{
                ['Proposed', 'Reserved', 'Submitted', 'Changes requested', 'Approved', 'Cancelled'][
                  milestone.status
                ]
              }}
            </p>
            <p>
              Payment: {{ paymentStatus(milestone.id)
              }}<span v-if="milestone.due">
                · Due {{ new Date(milestone.due * 1000).toLocaleString() }}</span
              >
            </p>
            <p v-if="milestone.submission_doc !== '0'">
              Submission document {{ milestone.submission_doc }} / v{{
                milestone.submission_version
              }}
            </p>
            <p v-if="milestone.review_doc !== '0'">
              Review document {{ milestone.review_doc }} / v{{ milestone.review_version }} ·
              reviewer {{ milestone.reviewer }}
            </p>
            <button
              v-if="
                project.status === 1 &&
                ((project.contributor === member?.memberId && [1, 3].includes(milestone.status)) ||
                  (member?.active &&
                    (member.admin || member.reviewer) &&
                    member.memberId !== project.contributor &&
                    milestone.status === 2))
              "
              class="secondary"
              :disabled="!allowed(milestone.status === 2 ? 'review' : 'submitwork')"
              @click="selectedMilestone = milestone.id"
            >
              {{ milestone.status === 2 ? 'Review' : 'Submit evidence for' }} milestone
              {{ milestone.id }}</button
            ><button
              v-if="payable(milestone.id)"
              :disabled="!canSettle"
              @click="settle(milestone.id)"
            >
              Settle milestone {{ milestone.id }}
            </button>
          </li>
        </ul>
      </article>
      <section
        v-if="selectedWork && selectedProject && selectedProject.status === 1"
        class="panel narrow"
      >
        <h3>Milestone {{ selectedWork.id }}</h3>
        <form
          v-if="
            selectedProject.contributor === member?.memberId && [1, 3].includes(selectedWork.status)
          "
          @submit.prevent="submitWork"
        >
          <label for="submission-doc">Submission document ID</label
          ><input
            id="submission-doc"
            list="work-documents"
            v-model="submissionDoc"
            inputmode="numeric"
            pattern="[1-9][0-9]*"
            required
          /><label for="submission-version">Submission document version</label
          ><input
            id="submission-version"
            v-model.number="submissionVersion"
            type="number"
            min="1"
            required
          /><button :disabled="!allowed('submitwork')">Submit milestone evidence</button>
        </form>
        <form
          v-else-if="
            member?.active &&
            (member.admin || member.reviewer) &&
            member.memberId !== selectedProject.contributor &&
            selectedWork.status === 2
          "
          @submit.prevent="reviewWork(true)"
        >
          <label for="review-doc">Review document ID</label
          ><input
            id="review-doc"
            list="work-documents"
            v-model="reviewDoc"
            inputmode="numeric"
            pattern="[1-9][0-9]*"
            required
          /><label for="review-version">Review document version</label
          ><input
            id="review-version"
            v-model.number="reviewVersion"
            type="number"
            min="1"
            required
          />
          <div class="button-row">
            <button :disabled="!allowed('review')">Approve milestone</button
            ><button
              type="button"
              class="secondary"
              :disabled="!allowed('review') || !reviewDoc"
              @click="reviewWork(false)"
            >
              Request changes
            </button>
          </div>
          <p class="field-help">
            Approval creates a payable obligation. Cancellation preserves approved payments.
          </p>
        </form>
      </section></template
    >
    <template v-else
      ><form
        v-if="member?.active && member.admin && current?.enabled"
        class="panel form-panel"
        @submit.prevent="commit"
      >
        <h3>Commit fixed-term payroll</h3>
        <p class="notice">
          All installments are funded and approved now. Approved commitments cannot be cancelled.
          Choose only the term your DAO intends to honor. Settlement pays every installment that is
          already due. The recipient and the DAO treasury asset stay on the approved obligation.
        </p>
        <label for="pay-recipient">Recipient member ID</label
        ><input id="pay-recipient" v-model="contributor" inputmode="numeric" required /><label
          for="pay-amount"
          >Amount per installment ({{ dao.token.symbol }})</label
        ><input id="pay-amount" v-model="milestoneAmounts" required />
        <div class="two-column">
          <div>
            <label for="pay-periods">Installments</label
            ><input
              id="pay-periods"
              v-model.number="periods"
              type="number"
              min="1"
              max="12"
              required
            />
          </div>
          <div>
            <label for="pay-interval">Claim frequency (days)</label
            ><input
              id="pay-interval"
              v-model.number="intervalDays"
              type="number"
              min="1"
              max="31"
              required
            />
          </div>
        </div>
        <label for="pay-starts">First installment due (UTC)</label
        ><input
          id="pay-starts"
          v-model="payrollStarts"
          type="datetime-local"
          step="1"
          required
        /><button :disabled="!allowed('commit')">Commit funded payroll</button>
      </form>
      <form class="panel form-panel" @submit.prevent>
        <label for="pay-search">Search payrolls</label
        ><input id="pay-search" v-model="payrollQuery" placeholder="Label, member, or schedule" />
        <label class="choice"
          ><input v-model="showOngoing" type="checkbox" /> Ongoing schedules</label
        >
      </form>
      <p v-if="current?.enabled && !current.actions.includes('edit')" class="notice">
        Pause and the label need the edit action. Enable payroll again after disabling it once to
        grant that action. Approved installments stay payable.
      </p>
      <article v-for="schedule in visibleSchedules" :key="schedule.id" class="panel">
        <h3>{{ controlFor(schedule.id)?.label || `Schedule ${schedule.id}` }}</h3>
        <p>
          {{ schedule.periods }} installments of {{ schedule.quantity }} for member
          {{ schedule.recipient }}.
          {{
            scheduleEntries(schedule.id).filter((entry) => obligation(entry.id)?.status === 2)
              .length
          }}
          paid. Unpaid installments stay reserved in the DAO treasury.
        </p>
        <p>
          First due {{ new Date(schedule.starts * 1000).toLocaleString() }} · Claim frequency
          {{ schedule.interval / 86400 }} days · Last payout {{ lastPayout(schedule.id) }}.
        </p>
        <p v-if="pausedSchedule(schedule.id)">
          Schedule settlement is paused. Approved, due installments remain payable directly through
          the treasury. A DAO-wide guardian pause is a separate emergency control.
        </p>
        <form
          v-if="
            member?.active && member.admin && current?.enabled && current.actions.includes('edit')
          "
          class="form-panel"
          @submit.prevent="editSchedule(schedule.id)"
        >
          <label :for="`pay-label-${schedule.id}`">Label</label
          ><input
            :id="`pay-label-${schedule.id}`"
            v-model="draftLabel[schedule.id]"
            maxlength="80"
          />
          <label class="choice"
            ><input v-model="draftPaused[schedule.id]" type="checkbox" /> Pause schedule
            settlement</label
          ><button :disabled="!allowed('edit')">Save payroll settings</button>
        </form>
        <button
          v-if="outstandingEntry(schedule.id)"
          :disabled="!canSettle || pausedSchedule(schedule.id)"
          @click="payOutstanding(schedule.id)"
        >
          Pay outstanding
        </button>
        <ul class="milestone-list">
          <li v-for="entry in scheduleEntries(schedule.id)" :key="entry.id">
            <p>
              Installment {{ entry.id }} · Due {{ new Date(entry.due * 1000).toLocaleString() }} ·
              {{ paymentStatus(entry.id) }}
            </p>
          </li>
        </ul>
      </article></template
    ></template
  >
  <button
    v-if="
      data &&
      ((section === 'decide' && (data.next.ballots || data.next.elections || data.next.terms)) ||
        (section === 'works' && data.next.projects) ||
        (section === 'payroll' && data.next.schedules) ||
        (section === 'grants-rounds' && (data.next.rounds || data.next.applications)))
    "
    class="secondary"
    :disabled="loading || busy"
    @click="load(true)"
  >
    Load more
    {{ current ? names[current.deployment.id] : 'Module' }} records
  </button>
</template>
