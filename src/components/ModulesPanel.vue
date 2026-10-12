<script setup lang="ts">
import ElectionPanel from './ElectionPanel.vue';
import GrantsPanel from './GrantsPanel.vue';
import ContributionAgreementPanel from './ContributionAgreementPanel.vue';
import ServiceCatalogue from './ServiceCatalogue.vue';
import VotingDurationInput from './VotingDurationInput.vue';
import PercentageInput from './PercentageInput.vue';
import { parseWholeWorkPayments } from '../content/token-payments';
import { parsePayrollInputs } from '../content/payroll-inputs';
import { documentLabel } from '../content/document-labels';
import { percentageText } from '../content/governance-inputs';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Plus, CircleHelp, X, Trash2 } from '@lucide/vue';
import { z } from 'zod';
import {
  formatUnits,
  type PublicPerson,
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
const decideTabs = [
  { id: 'ballots', label: 'Ballots' },
  { id: 'elections', label: 'Elections' },
] as const;
const decideTab = ref<(typeof decideTabs)[number]['id']>('ballots');
const ballotDialog = ref<HTMLDialogElement>();
const electionPanel = ref<InstanceType<typeof ElectionPanel>>();
const creationLabel = computed(() =>
  decideTab.value === 'elections' ? 'Election and term rules' : 'Open a ballot',
);
const visibleBallots = computed(
  () =>
    data.value?.ballots.filter(
      (ballot) => !data.value?.elections.some((election) => election.id === ballot.id),
    ) ?? [],
);
function navigateDecideTabs(event: KeyboardEvent) {
  const current = decideTabs.findIndex((tab) => tab.id === decideTab.value);
  const index =
    event.key === 'ArrowRight'
      ? (current + 1) % decideTabs.length
      : event.key === 'ArrowLeft'
        ? (current + decideTabs.length - 1) % decideTabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? decideTabs.length - 1
            : undefined;
  if (index === undefined) return;
  const tab = decideTabs[index];
  if (!tab) return;
  event.preventDefault();
  decideTab.value = tab.id;
  void nextTick(() => document.getElementById('decide-tab-' + tab.id)?.focus());
}
const contributor = ref('1');
const workDocument = ref('');
const worksDialog = ref<HTMLDialogElement>();
const worksTab = ref<'proposals' | 'services'>('proposals');
const projectStatus = ref('');
const projectContributor = ref('');
const choicesLoading = ref(false);
const choicesError = ref('');
const profiles = ref<PublicPerson[]>([]);
const profilesError = ref('');
let choicesRequest = 0;
const payrollDialog = ref<HTMLDialogElement>();
const payrollRecipient = ref('');
const payrollAmount = ref('');
const payrollConfirmed = ref(false);
const workMilestones = ref([{ id: 1, amount: '', due: '' }]);
let nextMilestoneId = 2;
const paymentsConfirmed = ref(false);
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
  choicesRequest++;
  worksDialog.value?.close();
  payrollDialog.value?.close();
  clearInterval(clock);
});
const submissionDoc = ref('');
const reviewDoc = ref('');
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
  activity: 'Community Activity',
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
function showCreationDialog() {
  if (busy.value || !props.member?.active || !current.value?.enabled) return;
  error.value = '';
  success.value = '';
  if (decideTab.value === 'elections') electionPanel.value?.showDialog();
  else ballotDialog.value?.showModal();
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
  if (['works', 'payroll'].includes(props.section)) void loadMemberChoices();
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
      props.section === 'grants-rounds'
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
    if (!['works', 'payroll'].includes(props.section)) content.value = documents;
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
    ballotDialog.value?.close();
    worksDialog.value?.close();
    payrollDialog.value?.close();
    choicesRequest++;
    profiles.value = [];
    profilesError.value = '';
    choicesError.value = '';
    choicesLoading.value = false;
    worksTab.value = 'proposals';
    clearWorkFilters();
    payrollRecipient.value = '';
    payrollAmount.value = '';
    payrollConfirmed.value = false;
    periods.value = 2;
    intervalDays.value = 30;
    payrollStarts.value = new Date(Date.now() + 60000).toISOString().slice(0, 19);
    resetWorkMilestones();
    generation++;
    data.value = undefined;
    treasury.value = undefined;
    governance.value = undefined;
    content.value = undefined;
    title.value = '';
    contributor.value = '';
    workDocument.value = '';
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
    ballotDialog.value?.close();
    worksDialog.value?.close();
    payrollDialog.value?.close();
    choicesRequest++;
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
  if (!current.value || !allowed('open')) return;
  const domain = context.value;
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
    if (!disposed && domain === context.value && success.value === 'Ballot opened') {
      title.value = '';
      decideTab.value = 'ballots';
      ballotDialog.value?.close();
    }
  } catch (cause) {
    if (!disposed && domain === context.value) error.value = friendlyError(cause);
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
async function loadMemberChoices() {
  const request = ++choicesRequest,
    domain = context.value,
    section = props.section;
  choicesLoading.value = true;
  choicesError.value = '';
  profilesError.value = '';
  const reference = props.dao.reference;
  async function people() {
    const rows: PublicPerson[] = [],
      cursors = new Set<string>();
    let after: string | undefined;
    do {
      const result = await api.people({ daoId: reference.daoId, ...(after ? { after } : {}) });
      if (result.profiles.some((row) => JSON.stringify(row.dao) !== JSON.stringify(reference)))
        throw new Error('DAO_REFERENCE');
      rows.push(...result.profiles);
      after = result.next ?? undefined;
      if (after && cursors.has(after)) throw new Error('INVALID_CURSOR');
      if (after) cursors.add(after);
    } while (after);
    return rows;
  }
  const [documents, names] = await Promise.allSettled([api.content(reference.daoId), people()]);
  if (
    disposed ||
    request !== choicesRequest ||
    domain !== context.value ||
    props.section !== section
  )
    return;
  if (
    documents.status === 'fulfilled' &&
    JSON.stringify(documents.value.dao) === JSON.stringify(reference)
  )
    content.value = documents.value;
  else {
    content.value = undefined;
    choicesError.value =
      documents.status === 'rejected'
        ? friendlyError(documents.reason)
        : friendlyError(new Error('DAO_REFERENCE'));
  }
  profiles.value = names.status === 'fulfilled' ? names.value : [];
  if (names.status === 'rejected')
    profilesError.value =
      'Member names are unavailable. Wallet names or member references are shown.';
  choicesLoading.value = false;
}
function memberLabel(id: string) {
  const profile = profiles.value.find((row) => row.memberId === id)?.profile;
  return (
    (profile?.fullName ? `${profile.fullName} · ${profile.name}` : profile?.name) ||
    content.value?.members.find((row) => row.id === id)?.native_account ||
    `Member ${id}`
  );
}
const contributorOptions = computed(() =>
  (content.value?.members ?? [])
    .filter((row) => row.active)
    .sort((a, b) => memberLabel(a.id).localeCompare(memberLabel(b.id))),
);
const documentOptions = computed(() =>
  [...(content.value?.documents ?? [])].sort((a, b) =>
    a.document_id === b.document_id
      ? b.version - a.version
      : BigInt(a.document_id) < BigInt(b.document_id)
        ? -1
        : 1,
  ),
);
function selectedDocument(id: string) {
  return content.value?.documents.find((row) => row.id === id);
}
const proposalDocument = computed(() => selectedDocument(workDocument.value));
function resetWorkMilestones() {
  workMilestones.value = [{ id: nextMilestoneId++, amount: '', due: '' }];
  paymentsConfirmed.value = false;
}
function addWorkMilestone() {
  if (busy.value || workMilestones.value.length >= 16) return;
  const id = nextMilestoneId++;
  workMilestones.value.push({ id, amount: '', due: '' });
  void nextTick(() => document.getElementById(`work-amount-${id}`)?.focus());
}
function removeWorkMilestone(index: number) {
  if (busy.value || workMilestones.value.length <= 1) return;
  workMilestones.value.splice(index, 1);
  const row = workMilestones.value[Math.min(index, workMilestones.value.length - 1)];
  if (row) void nextTick(() => document.getElementById(`work-amount-${row.id}`)?.focus());
}
function milestoneAmountError(amount: string) {
  if (!amount) return '';
  try {
    parseWholeWorkPayments([amount], props.dao.token.precision);
    return '';
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Enter a positive whole amount.';
  }
}
function milestoneDateError(due: string) {
  if (!due) return '';
  const seconds = Math.floor(new Date(due).getTime() / 1000);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 0xffffffff
    ? ''
    : 'Choose a supported date and time.';
}
const paymentState = computed(() => {
  try {
    const result = parseWholeWorkPayments(
      workMilestones.value.map((row) => row.amount),
      props.dao.token.precision,
    );
    return {
      valid: true,
      total: (result.total / 10n ** BigInt(props.dao.token.precision)).toLocaleString(),
      error: '',
    };
  } catch (cause) {
    return {
      valid: false,
      total: '',
      error: cause instanceof Error ? cause.message : 'Check every milestone amount.',
    };
  }
});
watch(
  () => JSON.stringify([contributor.value, workDocument.value, workMilestones.value]),
  () => {
    paymentsConfirmed.value = false;
  },
  { flush: 'sync' },
);
const proposalReady = computed(
  () =>
    !choicesLoading.value &&
    !!proposalDocument.value &&
    paymentState.value.valid &&
    workMilestones.value.every((row) => !milestoneDateError(row.due)) &&
    paymentsConfirmed.value &&
    contributorOptions.value.some((row) => row.id === contributor.value),
);
function showWorkDialog(memberId?: string) {
  if (busy.value || !props.member?.active || !current.value?.enabled) return;
  if (memberId) contributor.value = memberId;
  error.value = '';
  success.value = '';
  worksDialog.value?.showModal();
}
function navigateWorksTabs(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  worksTab.value =
    event.key === 'Home'
      ? 'proposals'
      : event.key === 'End'
        ? 'services'
        : worksTab.value === 'proposals'
          ? 'services'
          : 'proposals';
  void nextTick(() => document.getElementById('works-tab-' + worksTab.value)?.focus());
}
async function propose() {
  const document = proposalDocument.value,
    domain = context.value;
  if (!current.value || !document || !proposalReady.value || !allowed('propose')) return;
  try {
    const amounts = parseWholeWorkPayments(
      workMilestones.value.map((row) => row.amount),
      props.dao.token.precision,
    );
    const payments = amounts.units.map(
      (value) => `${formatUnits(value, props.dao.token.precision)} ${props.dao.token.symbol}`,
    );
    const dues = workMilestones.value.map((row) =>
      row.due ? Math.floor(new Date(row.due).getTime() / 1000) : 0,
    );
    await run(
      current.value.deployment.account,
      'propose',
      encodeWorks('propose', {
        ...actor(),
        project_id: newId(),
        contributor: contributor.value,
        document_id: document.document_id,
        document_version: document.version,
        payments,
        dues,
      }),
      'Work proposed',
    );
    if (!disposed && domain === context.value && success.value === 'Work proposed') {
      worksDialog.value?.close();
      worksTab.value = 'proposals';
      workDocument.value = '';
      contributor.value = '';
      resetWorkMilestones();
      clearWorkFilters();
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
function projectTitle(project: ModuleState['projects'][number]) {
  const document = content.value?.documents.find(
    (row) => row.document_id === project.document_id && row.version === project.document_version,
  );
  return document ? documentLabel(document) : `Work proposal #${project.id}`;
}
function workStatus(status: number) {
  return ['Proposed', 'Accepted', 'Cancelled'][status] ?? 'Unknown';
}
function clearWorkFilters() {
  agreementSearch.value = '';
  projectStatus.value = '';
  projectContributor.value = '';
  agreementsOnly.value = false;
}
const projectContributors = computed(() =>
  [...new Set(data.value?.projects.map((row) => row.contributor) ?? [])].sort((a, b) =>
    memberLabel(a).localeCompare(memberLabel(b)),
  ),
);
const visibleProjects = computed(
  () =>
    data.value?.projects.filter(
      (project) =>
        (!agreementsOnly.value ||
          data.value?.agreements.some((a) => a.project_id === project.id)) &&
        (!projectStatus.value || String(project.status) === projectStatus.value) &&
        (!projectContributor.value || project.contributor === projectContributor.value) &&
        `${projectTitle(project)} ${memberLabel(project.contributor)} ${project.id} ${project.contributor}`
          .toLocaleLowerCase()
          .includes(agreementSearch.value.trim().toLocaleLowerCase()),
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
const payrollState = computed(() => {
  try {
    const input = parsePayrollInputs(
      payrollAmount.value,
      periods.value,
      intervalDays.value,
      payrollStarts.value,
      props.dao.token.precision,
      now.value,
    );
    return {
      valid: true,
      total: (input.total / 10n ** BigInt(props.dao.token.precision)).toLocaleString(),
      error: '',
    };
  } catch (cause) {
    return {
      valid: false,
      total: '',
      error: cause instanceof Error ? cause.message : 'Check the payroll settings.',
    };
  }
});
const payrollReady = computed(
  () =>
    !choicesLoading.value &&
    payrollState.value.valid &&
    payrollConfirmed.value &&
    contributorOptions.value.some((member) => member.id === payrollRecipient.value),
);
watch(
  () =>
    JSON.stringify([
      payrollRecipient.value,
      payrollAmount.value,
      periods.value,
      intervalDays.value,
      payrollStarts.value,
    ]),
  () => {
    payrollConfirmed.value = false;
  },
  { flush: 'sync' },
);
function showPayrollDialog() {
  if (busy.value || !props.member?.active || !props.member.admin || !current.value?.enabled) return;
  error.value = '';
  success.value = '';
  payrollDialog.value?.showModal();
}
async function commit() {
  if (!current.value || !props.member?.admin || !payrollReady.value || !allowed('commit')) return;
  const domain = context.value;
  try {
    const input = parsePayrollInputs(
      payrollAmount.value,
      periods.value,
      intervalDays.value,
      payrollStarts.value,
      props.dao.token.precision,
      Math.floor(Date.now() / 1000),
    );
    await run(
      current.value.deployment.account,
      'commit',
      encodePayroll('commit', {
        ...actor(),
        schedule_id: newId(),
        recipient: payrollRecipient.value,
        quantity: `${formatUnits(input.quantity, props.dao.token.precision)} ${props.dao.token.symbol}`,
        periods: periods.value,
        interval: input.interval,
        starts: input.starts,
      }),
      'Funded payroll committed',
    );
    if (!disposed && domain === context.value && success.value === 'Funded payroll committed') {
      payrollDialog.value?.close();
      payrollRecipient.value = '';
      payrollAmount.value = '';
      payrollConfirmed.value = false;
      payrollQuery.value = '';
      showOngoing.value = true;
    }
  } catch (cause) {
    if (!disposed && domain === context.value) error.value = friendlyError(cause);
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
  const document = selectedDocument(submissionDoc.value);
  if (!current.value || !document) return;
  try {
    await run(
      current.value.deployment.account,
      'submitwork',
      encodeWorks('submitwork', {
        ...actor(),
        milestone_id: selectedMilestone.value,
        document_id: document.document_id,
        document_version: document.version,
      }),
      'Milestone submitted for review',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function reviewWork(approve: boolean) {
  const document = selectedDocument(reviewDoc.value);
  if (!current.value || !document) return;
  try {
    await run(
      current.value.deployment.account,
      'review',
      encodeWorks('review', {
        ...actor(),
        milestone_id: selectedMilestone.value,
        approve,
        document_id: document.document_id,
        document_version: document.version,
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

  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="success" class="notice" role="status">{{ success }}</p>
  <p v-if="loading" role="status">Reading contract state…</p>
  <template v-if="section === 'modules'"
    ><div v-if="!focusAccount" class="section-toolbar">
      <h2>DAO modules</h2>
      <RouterLink
        v-if="member?.admin"
        :to="{ path: '/module-access', query: { dao: JSON.stringify(dao.reference) } }"
        >Module access &amp; prices ↗</RouterLink
      >
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
              : module.deployment.id === 'activity'
                ? 'Member-authorised completions, independent reviews and compact references across connected apps.'
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
    ><div v-if="!['decide', 'works', 'payroll'].includes(section)" class="section-toolbar">
      <h2>{{ current ? names[current.deployment.id] : 'Module workspace' }}</h2>
      <RouterLink :to="helpLink(section)">Rules &amp; help ↗</RouterLink>
    </div>
    <div
      v-if="section === 'payroll'"
      class="decide-toolbar payroll-toolbar"
      role="group"
      aria-label="Payroll tools"
    >
      <button
        type="button"
        class="decide-icon decide-add"
        aria-label="Add payroll"
        title="Add payroll"
        aria-haspopup="dialog"
        :disabled="!member?.active || !member.admin || !current?.enabled || busy"
        @click="showPayrollDialog"
      >
        <Plus :size="32" aria-hidden="true" />
      </button>
      <RouterLink
        class="decide-icon"
        :to="helpLink('payroll')"
        aria-label="Payroll rules and help"
        title="Payroll rules and help"
        ><CircleHelp :size="24" aria-hidden="true"
      /></RouterLink>
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
      <h2>Enable this module</h2>
      <p>
        A DAO administrator must grant its contract permissions before member actions become
        available.
      </p>
      <RouterLink class="button secondary" :to="`/dao/${dao.reference.daoId}/modules`"
        >Configure modules</RouterLink
      >
    </section>
    <template v-if="section === 'decide'">
      <div class="decide-toolbar" role="group" aria-label="Decide tools">
        <div
          class="account-tabs decide-tabs"
          role="tablist"
          aria-label="Decide sections"
          @keydown="navigateDecideTabs"
        >
          <button
            v-for="tab in decideTabs"
            :id="'decide-tab-' + tab.id"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="decideTab === tab.id"
            :aria-controls="'decide-panel-' + tab.id"
            :tabindex="decideTab === tab.id ? 0 : -1"
            @click="decideTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
        <div class="decide-toolbar-actions">
          <button
            type="button"
            class="decide-icon decide-add"
            :aria-label="creationLabel"
            :title="creationLabel"
            aria-haspopup="dialog"
            :disabled="
              !member?.active ||
              !current?.enabled ||
              busy ||
              (decideTab === 'elections' && !member.admin)
            "
            @click="showCreationDialog"
          >
            <Plus :size="32" aria-hidden="true" />
          </button>
          <RouterLink
            class="decide-icon"
            :to="helpLink(decideTab === 'elections' ? 'representative-elections' : 'decide')"
            :aria-label="
              decideTab === 'elections' ? 'Election rules and help' : 'Ballot rules and help'
            "
            :title="decideTab === 'elections' ? 'Election rules and help' : 'Ballot rules and help'"
            ><CircleHelp :size="24" aria-hidden="true"
          /></RouterLink>
        </div>
      </div>
      <dialog
        v-if="member?.active && current?.enabled"
        ref="ballotDialog"
        class="panel ballot-dialog"
        aria-labelledby="ballot-dialog-title"
        @cancel="busy && $event.preventDefault()"
      >
        <header class="ballot-dialog-heading">
          <h2 id="ballot-dialog-title">Open a ballot</h2>
          <button
            type="button"
            class="decide-icon"
            aria-label="Close ballot form"
            :disabled="busy"
            @click="ballotDialog?.close()"
          >
            <X :size="24" aria-hidden="true" />
          </button>
        </header>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="busy" role="status">Opening ballot…</p>
        <p v-else-if="!signerReady" class="notice">
          Choose an authorized signer in Signing &amp; wallets before opening this ballot.
        </p>
        <form @submit.prevent="open">
          <fieldset :disabled="busy">
            <label for="ballot-title">Public ballot title</label
            ><input id="ballot-title" v-model="title" maxlength="160" autofocus />
            <p class="field-help">
              This label is public on chain. Leave it blank to avoid publishing a title.
            </p>
            <div class="three-column">
              <div>
                <label for="weight">Voting weight</label
                ><select id="weight" v-model="weight" :disabled="!!governance?.policy || busy">
                  <option value="member">Equal active members</option>
                  <option value="credit">Governance credits</option>
                  <option value="native-stake">Escrowed native stake</option>
                </select>
              </div>
              <VotingDurationInput
                id="duration"
                v-model="duration"
                label="Duration"
                :disabled="!!governance?.policy || busy"
                allow-date
                :now="now"
              />
              <PercentageInput
                id="quorum"
                v-model="quorum"
                label="Quorum (%)"
                kind="quorum"
                :disabled="!!governance?.policy || busy"
              />
            </div>
            <PercentageInput
              id="approval"
              v-model="approval"
              label="Approval (%)"
              kind="approval"
              :disabled="!!governance?.policy || busy"
            />
            <p v-if="governance?.policy" class="field-help">
              These settings follow your DAO’s saved governance policy.
            </p>
            <p class="field-help">
              Weight is frozen at opening. New members cannot vote in an existing ballot.
            </p>
            <div class="button-row">
              <button :disabled="!allowed('open')">Open ballot</button>
              <button
                type="button"
                class="secondary"
                :disabled="busy"
                @click="ballotDialog?.close()"
              >
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
      <div
        v-show="decideTab === 'ballots'"
        id="decide-panel-ballots"
        role="tabpanel"
        aria-labelledby="decide-tab-ballots"
        tabindex="0"
      >
        <div v-if="!visibleBallots.length" class="empty-state">
          <h2>No ballots yet</h2>
          <p>Open a decision with an explicit weight, quorum, and closing time.</p>
        </div>
        <article v-for="ballot in visibleBallots" :key="ballot.id" class="panel">
          <div class="panel-heading">
            <h2>{{ ballotTitle(ballot) }}</h2>
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
          <p class="field-help">
            Quorum {{ percentageText(ballot.quorum) }}% · Approval
            {{ percentageText(ballot.approval) }}%
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
        </article>
      </div>
      <div
        v-show="decideTab === 'elections'"
        id="decide-panel-elections"
        role="tabpanel"
        aria-labelledby="decide-tab-elections"
        tabindex="0"
      >
        <ElectionPanel
          v-if="data"
          ref="electionPanel"
          :key="context"
          :dao="dao"
          :member="member"
          :data="data"
          :governance="governance"
          :can-sign="canSign"
          :can-finalize="canSettle"
          :busy="busy"
          :action-error="error"
          :action-success="success"
          :now="now"
          :run="run"
          :finalize="finalize"
        />
        <div v-if="!data?.elections.length" class="empty-state">
          <h2>No elections yet</h2>
          <p>Schedule an election to choose representatives or executives for a fixed term.</p>
        </div>
      </div>
    </template>
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
    <template v-else-if="section === 'works'">
      <div class="decide-toolbar works-toolbar">
        <div
          class="account-tabs decide-tabs"
          role="tablist"
          aria-label="Works sections"
          @keydown="navigateWorksTabs"
        >
          <button
            v-for="tab in [
              { id: 'proposals', label: 'Work proposals' },
              { id: 'services', label: 'Member services' },
            ]"
            :id="'works-tab-' + tab.id"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="worksTab === tab.id"
            :aria-controls="'works-panel-' + tab.id"
            :tabindex="worksTab === tab.id ? 0 : -1"
            @click="worksTab = tab.id === 'proposals' ? 'proposals' : 'services'"
          >
            {{ tab.label }}
          </button>
        </div>
        <div class="decide-toolbar-actions">
          <button
            type="button"
            class="decide-icon decide-add"
            aria-label="Propose milestone work"
            aria-haspopup="dialog"
            title="Propose milestone work"
            :disabled="busy || !member?.active || !current?.enabled"
            @click="showWorkDialog()"
          >
            <Plus aria-hidden="true" />
          </button>
          <RouterLink
            :to="helpLink('works')"
            class="decide-icon"
            aria-label="Work rules and help"
            title="Work rules and help"
            ><CircleHelp aria-hidden="true"
          /></RouterLink>
        </div>
      </div>
      <p v-if="profilesError" class="field-help">
        {{ profilesError }}
        <button
          type="button"
          class="secondary"
          :disabled="choicesLoading || busy"
          @click="loadMemberChoices"
        >
          Retry member names
        </button>
      </p>
      <p v-if="choicesError" class="field-help">
        Members and documents are unavailable. Work references are shown.
        <button
          type="button"
          class="secondary"
          :disabled="choicesLoading || busy"
          @click="loadMemberChoices"
        >
          Retry members and documents
        </button>
      </p>
      <dialog
        v-if="member?.active && current?.enabled"
        ref="worksDialog"
        class="panel form-panel ballot-dialog"
        aria-labelledby="work-dialog-title"
        @cancel="busy && $event.preventDefault()"
      >
        <div class="ballot-dialog-heading">
          <h2 id="work-dialog-title">Propose milestone work</h2>
          <button
            type="button"
            class="decide-icon"
            aria-label="Close work proposal"
            :disabled="busy"
            @click="worksDialog?.close()"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <p>
          Choose who will do the work, its proposal and the payment for each milestone. Funding is
          approved separately; an independent reviewer approves completed milestones for payment.
        </p>
        <p v-if="error" role="alert" class="notice danger">{{ error }}</p>
        <p v-if="choicesError" role="alert" class="notice danger">
          {{ choicesError }}
          <button
            type="button"
            class="secondary"
            :disabled="busy || choicesLoading"
            @click="loadMemberChoices"
          >
            Retry members and documents
          </button>
        </p>
        <p v-if="choicesLoading" role="status">Loading members and documents…</p>
        <button
          type="button"
          class="secondary"
          :disabled="busy || choicesLoading"
          @click="loadMemberChoices"
        >
          Refresh members and documents
        </button>
        <form @submit.prevent="propose">
          <fieldset :disabled="busy">
            <label for="contributor">Contributor</label>
            <select
              id="contributor"
              v-model="contributor"
              required
              autofocus
              :disabled="choicesLoading"
            >
              <option value="" disabled>Choose a member</option>
              <option v-for="person in contributorOptions" :key="person.id" :value="person.id">
                {{ memberLabel(person.id) }}{{ person.id === member?.memberId ? ' (you)' : '' }}
              </option>
            </select>
            <p
              v-if="!choicesLoading && !choicesError && !contributorOptions.length"
              class="field-help"
            >
              No active members are available.
            </p>
            <label for="work-document">Proposal document</label>
            <select id="work-document" v-model="workDocument" required :disabled="choicesLoading">
              <option value="" disabled>Choose a published document</option>
              <option v-for="document in documentOptions" :key="document.id" :value="document.id">
                {{ documentLabel(document) }}
              </option>
            </select>
            <p
              v-if="!choicesLoading && !choicesError && !documentOptions.length"
              class="field-help"
            >
              No published documents yet.
            </p>
            <p class="field-help">
              Select the version describing the scope and deliverables.
              <RouterLink :to="`/dao/${dao.reference.daoId}/documents`"
                >Open DAO documents</RouterLink
              >
              to publish a proposal first.
            </p>
            <div class="milestone-editor-heading">
              <h3>Milestone payments</h3>
              <span class="muted">{{ workMilestones.length }} / 16</span>
            </div>
            <p class="field-help">
              Enter whole {{ dao.token.symbol }} amounts. Each row is one payment; nothing is
              rounded.
            </p>
            <section
              v-for="(row, index) in workMilestones"
              :key="row.id"
              class="milestone-editor"
              :aria-label="`Milestone ${index + 1}`"
            >
              <div class="milestone-editor-heading">
                <h4>Milestone {{ index + 1 }}</h4>
                <button
                  type="button"
                  class="secondary"
                  :aria-label="`Remove milestone ${index + 1}`"
                  :disabled="workMilestones.length === 1"
                  @click="removeWorkMilestone(index)"
                >
                  <Trash2 aria-hidden="true" />Remove
                </button>
              </div>
              <div class="two-column">
                <div>
                  <label :for="`work-amount-${row.id}`"
                    >Milestone {{ index + 1 }} amount ({{ dao.token.symbol }})</label
                  >
                  <div class="milestone-amount-field">
                    <input
                      :id="`work-amount-${row.id}`"
                      v-model="row.amount"
                      type="text"
                      inputmode="numeric"
                      pattern="[1-9][0-9]*"
                      maxlength="19"
                      autocomplete="off"
                      required
                      placeholder="e.g. 10"
                      :aria-invalid="!!milestoneAmountError(row.amount)"
                      :aria-describedby="`work-amount-help-${row.id}`"
                    /><span aria-hidden="true">{{ dao.token.symbol }}</span>
                  </div>
                  <p
                    :id="`work-amount-help-${row.id}`"
                    class="field-help"
                    :class="{ 'amount-error': milestoneAmountError(row.amount) }"
                  >
                    {{ milestoneAmountError(row.amount) || 'Positive whole tokens only.' }}
                  </p>
                </div>
                <div>
                  <label :for="`work-due-${row.id}`"
                    >Milestone {{ index + 1 }} due date (optional)</label
                  ><input
                    :id="`work-due-${row.id}`"
                    v-model="row.due"
                    type="datetime-local"
                    :aria-invalid="!!milestoneDateError(row.due)"
                  />
                  <p v-if="milestoneDateError(row.due)" class="field-help amount-error">
                    {{ milestoneDateError(row.due) }}
                  </p>
                </div>
              </div>
            </section>
            <button
              type="button"
              class="secondary"
              :disabled="workMilestones.length >= 16"
              @click="addWorkMilestone"
            >
              <Plus aria-hidden="true" />Add milestone
            </button>
            <div class="milestone-total">
              <span>Total milestone payment</span
              ><strong role="status" aria-label="Total milestone payment">{{
                paymentState.valid
                  ? `${paymentState.total} ${dao.token.symbol}`
                  : 'Complete every amount to see the total.'
              }}</strong>
              <p
                v-if="!paymentState.valid && workMilestones.every((row) => row.amount)"
                class="field-help amount-error"
              >
                {{ paymentState.error }}
              </p>
            </div>
            <label class="checkbox"
              ><input
                v-model="paymentsConfirmed"
                type="checkbox"
                :disabled="
                  !paymentState.valid || workMilestones.some((row) => milestoneDateError(row.due))
                "
                required
              />I checked the milestone amounts and total</label
            >
            <p class="field-help">
              Accepting a project reserves its full amount. You can offer a contribution agreement
              before requesting funding.
            </p>
          </fieldset>
          <p v-if="!signerReady" class="field-help">
            Unlock your signing keys to submit this proposal.
          </p>
          <div class="work-actions">
            <button :disabled="!allowed('propose') || !proposalReady">
              {{ busy ? 'Submitting…' : 'Propose work' }}</button
            ><button type="button" class="secondary" :disabled="busy" @click="worksDialog?.close()">
              Cancel
            </button>
          </div>
        </form>
      </dialog>
      <section
        id="works-panel-services"
        role="tabpanel"
        aria-labelledby="works-tab-services"
        v-show="worksTab === 'services'"
      >
        <ServiceCatalogue
          :content="content"
          :dao="dao.reference"
          :member-labels="
            Object.fromEntries((content?.members ?? []).map((row) => [row.id, memberLabel(row.id)]))
          "
          :can-propose="!busy && !!member?.active && !!current?.enabled"
          @choose="showWorkDialog"
        />
      </section>
      <section
        id="works-panel-proposals"
        role="tabpanel"
        aria-labelledby="works-tab-proposals"
        v-show="worksTab === 'proposals'"
      >
        <div class="panel work-filters">
          <label
            >Search work<input
              v-model="agreementSearch"
              type="search"
              placeholder="Proposal or contributor"
          /></label>
          <label
            >Work status<select v-model="projectStatus">
              <option value="">All statuses</option>
              <option value="0">Proposed</option>
              <option value="1">Accepted</option>
              <option value="2">Cancelled</option>
            </select></label
          >
          <label
            >Filter by contributor<select v-model="projectContributor">
              <option value="">All contributors</option>
              <option v-for="id in projectContributors" :key="id" :value="id">
                {{ memberLabel(id) }}
              </option>
            </select></label
          >
          <label class="checkbox"
            ><input v-model="agreementsOnly" type="checkbox" />Contribution agreements only</label
          >
          <button
            v-if="agreementSearch || projectStatus || projectContributor || agreementsOnly"
            type="button"
            class="secondary"
            @click="clearWorkFilters"
          >
            Clear filters
          </button>
        </div>
        <p class="field-help" role="status">
          {{ visibleProjects.length }} of {{ data?.projects.length ?? 0 }} loaded work
          proposals<span v-if="data?.next.projects"> · Load more below to search older work.</span>
        </p>
        <section v-if="!visibleProjects.length" class="empty-state">
          <h2>{{ data?.projects.length ? 'No matching work' : 'No work proposals yet' }}</h2>
          <p>
            {{
              data?.projects.length
                ? 'Try changing or clearing your filters.'
                : 'Use + to propose work with a contributor and milestone payments.'
            }}
          </p>
        </section>
        <article v-for="project in visibleProjects" :key="project.id" class="panel work-project">
          <div class="work-project-heading">
            <h2>{{ projectTitle(project) }}</h2>
            <span class="status-pill">{{ workStatus(project.status) }}</span>
          </div>
          <p class="muted">
            {{ memberLabel(project.contributor) }} · {{ project.milestones.length }} milestone{{
              project.milestones.length === 1 ? '' : 's'
            }}
            · Work reference {{ project.id }}
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
                  [
                    'Proposed',
                    'Reserved',
                    'Submitted',
                    'Changes requested',
                    'Approved',
                    'Cancelled',
                  ][milestone.status]
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
                  ((project.contributor === member?.memberId &&
                    [1, 3].includes(milestone.status)) ||
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
              selectedProject.contributor === member?.memberId &&
              [1, 3].includes(selectedWork.status)
            "
            @submit.prevent="submitWork"
          >
            <label for="submission-doc">Evidence document</label
            ><select
              id="submission-doc"
              v-model="submissionDoc"
              required
              :disabled="busy || choicesLoading"
            >
              <option value="" disabled>Choose a published document</option>
              <option v-for="document in documentOptions" :key="document.id" :value="document.id">
                {{ documentLabel(document) }}
              </option>
            </select>
            <p class="field-help">
              <RouterLink :to="`/dao/${dao.reference.daoId}/documents`"
                >Open DAO documents</RouterLink
              >
              to publish your evidence.
            </p>
            <button :disabled="!allowed('submitwork') || !selectedDocument(submissionDoc)">
              Submit milestone evidence
            </button>
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
            <label for="review-doc">Review document</label
            ><select
              id="review-doc"
              v-model="reviewDoc"
              required
              :disabled="busy || choicesLoading"
            >
              <option value="" disabled>Choose a published document</option>
              <option v-for="document in documentOptions" :key="document.id" :value="document.id">
                {{ documentLabel(document) }}
              </option>
            </select>
            <p class="field-help">
              <RouterLink :to="`/dao/${dao.reference.daoId}/documents`"
                >Open DAO documents</RouterLink
              >
              to publish your review.
            </p>
            <div class="work-actions">
              <button :disabled="!allowed('review') || !selectedDocument(reviewDoc)">
                Approve milestone</button
              ><button
                type="button"
                class="secondary"
                :disabled="!allowed('review') || !selectedDocument(reviewDoc)"
                @click="reviewWork(false)"
              >
                Request changes
              </button>
            </div>
            <p class="field-help">
              Approval creates a payable obligation. Cancellation preserves approved payments.
            </p>
          </form>
        </section>
      </section></template
    >
    <template v-else-if="section === 'payroll'">
      <dialog
        v-if="member?.active && member.admin && current?.enabled"
        ref="payrollDialog"
        class="panel ballot-dialog"
        aria-labelledby="payroll-dialog-title"
        @cancel="busy && $event.preventDefault()"
      >
        <header class="ballot-dialog-heading">
          <h2 id="payroll-dialog-title">Add payroll</h2>
          <button
            type="button"
            class="decide-icon"
            aria-label="Close payroll form"
            :disabled="busy"
            @click="payrollDialog?.close()"
          >
            <X :size="24" aria-hidden="true" />
          </button>
        </header>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="busy" role="status">Committing funded payroll…</p>
        <p v-else-if="!signerReady" class="notice">
          Choose an authorized signer in Signing &amp; wallets before committing this payroll.
        </p>
        <p class="notice">
          All installments are funded and approved now. Approved commitments cannot be cancelled.
          Choose only the term your DAO intends to honor. Settlement pays every installment that is
          already due. The recipient and the DAO treasury asset stay on the approved obligation.
        </p>
        <p v-if="choicesLoading" role="status">Loading DAO members…</p>
        <p v-if="choicesError" class="alert" role="alert">{{ choicesError }}</p>
        <p v-if="profilesError" class="notice">{{ profilesError }}</p>
        <button
          v-if="choicesError || profilesError"
          type="button"
          class="secondary"
          :disabled="choicesLoading || busy"
          @click="loadMemberChoices"
        >
          Retry members
        </button>
        <form class="form-panel" @submit.prevent="commit">
          <fieldset :disabled="busy">
            <label for="pay-recipient">Recipient</label>
            <select
              id="pay-recipient"
              v-model="payrollRecipient"
              required
              autofocus
              :disabled="choicesLoading"
            >
              <option value="" disabled>Choose a member</option>
              <option v-for="person in contributorOptions" :key="person.id" :value="person.id">
                {{ memberLabel(person.id) }}{{ person.id === member?.memberId ? ' (you)' : '' }}
              </option>
            </select>
            <p
              v-if="!choicesLoading && !choicesError && !contributorOptions.length"
              class="field-help"
            >
              No active members are available.
            </p>
            <label for="pay-amount">Amount per installment ({{ dao.token.symbol }})</label>
            <div class="milestone-amount-field">
              <input
                id="pay-amount"
                v-model="payrollAmount"
                type="text"
                inputmode="numeric"
                pattern="[1-9][0-9]*"
                maxlength="19"
                aria-describedby="pay-amount-help pay-input-error"
                required
              />
              <span class="milestone-currency" aria-hidden="true">{{ dao.token.symbol }}</span>
            </div>
            <p id="pay-amount-help" class="field-help">
              Enter whole {{ dao.token.symbol }} amounts. Nothing is rounded.
            </p>
            <div class="two-column">
              <div>
                <label for="pay-periods">Installments</label>
                <input
                  id="pay-periods"
                  v-model.number="periods"
                  type="number"
                  min="1"
                  max="12"
                  step="1"
                  required
                />
              </div>
              <div>
                <label for="pay-interval">Claim frequency (days)</label>
                <input
                  id="pay-interval"
                  v-model.number="intervalDays"
                  type="number"
                  min="1"
                  max="31"
                  step="1"
                  required
                />
              </div>
            </div>
            <label for="pay-starts">First installment due (UTC)</label>
            <input
              id="pay-starts"
              v-model="payrollStarts"
              type="datetime-local"
              step="1"
              required
            />
            <p class="field-help">
              Choose a future date within the next 31 days. Times are in UTC.
            </p>
            <p
              id="pay-input-error"
              class="field-help"
              :class="{ alert: payrollAmount && !payrollState.valid }"
            >
              {{ payrollAmount && !payrollState.valid ? payrollState.error : '' }}
            </p>
            <div class="milestone-total">
              <span>Total payroll commitment</span>
              <strong role="status" aria-label="Total payroll commitment">{{
                payrollState.valid ? payrollState.total + ' ' + dao.token.symbol : '—'
              }}</strong>
            </div>
            <p v-if="payrollState.valid" class="field-help">
              {{ periods }} installments of {{ payrollAmount }} {{ dao.token.symbol }}, every
              {{ intervalDays }} days. This total is reserved from the DAO treasury when you commit.
            </p>
            <label class="choice"
              ><input
                v-model="payrollConfirmed"
                type="checkbox"
                :disabled="!payrollState.valid || !payrollRecipient"
              />
              I checked the recipient, installments and total</label
            >
            <div class="button-row">
              <button :disabled="!allowed('commit') || !payrollReady">Commit funded payroll</button>
              <button type="button" class="secondary" @click="payrollDialog?.close()">
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
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
        <h2>{{ controlFor(schedule.id)?.label || `Schedule ${schedule.id}` }}</h2>
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
        (section === 'works' && worksTab === 'proposals' && data.next.projects) ||
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
<style scoped>
.milestone-editor {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.milestone-editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-block: 16px;
}
.milestone-editor-heading h3,
.milestone-editor-heading h4 {
  margin: 0;
}
.milestone-editor .milestone-editor-heading {
  margin-top: 0;
}
.milestone-amount-field {
  position: relative;
}
.milestone-amount-field input {
  padding-right: 76px;
}
.milestone-amount-field span {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-weight: 700;
  color: var(--text-secondary);
  pointer-events: none;
}
.milestone-total {
  margin-block: 20px;
  padding: 16px;
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
}
.milestone-total strong {
  display: block;
  margin-top: 8px;
  font-size: 1.25rem;
  overflow-wrap: anywhere;
}
.amount-error {
  color: var(--state-danger);
}

.status-pill {
  padding: 6px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-size: 0.8rem;
}
@media (max-width: 640px) {
  .works-toolbar .payroll-toolbar {
    justify-content: flex-end;
  }
  .decide-tabs {
    min-width: 0;
    gap: 4px;
  }
  .works-toolbar .decide-tabs button {
    font-size: 0.75rem;
    padding-inline: 8px;
  }
}

.work-filters {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  align-items: end;
  gap: 16px;
}
.work-filters label {
  margin: 0;
}
.work-actions,
.work-project-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.work-actions {
  margin-top: 20px;
}
.work-project-heading {
  justify-content: space-between;
}
.work-project-heading h2 {
  margin: 0;
  font-size: 1.15rem;
  overflow-wrap: anywhere;
}
.work-project .milestone-list {
  margin-top: 20px;
}
@media (max-width: 640px) {
  .work-filters {
    grid-template-columns: 1fr;
  }
}

.decide-toolbar,
.decide-toolbar-actions,
.ballot-dialog-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.decide-toolbar {
  justify-content: space-between;
  margin-bottom: 24px;
}
.payroll-toolbar {
  justify-content: flex-end;
}
.decide-tabs {
  margin: 0;
}
.decide-tabs button {
  min-height: 44px;
}
.decide-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--accent-amber);
  background: transparent;
  box-shadow: none;
}
.decide-icon :deep(svg) {
  width: 24px;
  height: 24px;
}
.decide-add :deep(svg) {
  width: 32px;
  height: 32px;
}
.decide-icon:hover {
  transform: none;
  background: var(--accent-soft);
  box-shadow: none;
}
.ballot-dialog {
  width: min(840px, calc(100% - 32px));
  max-height: calc(100dvh - 48px);
  overflow: auto;
  margin: auto;
  color: var(--text-primary);
}
.ballot-dialog::backdrop {
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
}
.ballot-dialog-heading {
  justify-content: space-between;
  margin-bottom: 20px;
}
.ballot-dialog-heading h2 {
  margin: 0;
}
.ballot-dialog fieldset {
  border: 0;
  margin: 0;
  padding: 0;
}
.ballot-dialog :deep(.duration-fields select) {
  padding-inline: 10px;
}
@media (max-width: 640px) {
  .three-column .voting-duration {
    grid-column: 1 / -1;
  }
}
</style>
