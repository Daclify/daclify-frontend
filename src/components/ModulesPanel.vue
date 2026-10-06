<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { z } from 'zod';
import {
  parseUnits,
  formatUnits,
  type Treasury,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { DecideConfigSchema, type ModuleState } from '@daclify/modules';
import { encodeDecide, encodeWorks, encodePayroll } from '@daclify/modules/sdk';
import { api, friendlyError } from '../api/client';
import { vaultUnlocked, relayInstruction } from '../auth/session';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  section: string;
}>();
const workspace = useWorkspace();
const data = ref<ModuleState>();
const loading = ref(false);
const busy = ref(false);
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
const periods = ref(2);
const intervalDays = ref(30);
const treasury = ref<Treasury>();
const now = ref(Math.floor(Date.now() / 1000));
const clock = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
}, 1000);
onBeforeUnmount(() => clearInterval(clock));
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
const names = { decide: 'Decide', works: 'Works', payroll: 'Payroll' };
const permissions = {
  decide: { actions: ['open', 'vote'], grants: ['govlock'] },
  works: {
    actions: ['propose', 'accept', 'submitwork', 'review', 'cancel'],
    grants: ['reserve', 'approve', 'cancel'],
  },
  payroll: { actions: ['commit', 'edit'], grants: ['reserve', 'approve'] },
};
const canSign = computed(() => !!props.member?.active && vaultUnlocked.value && !busy.value);
const current = computed(() => data.value?.modules.find((m) => m.deployment.id === props.section));
const canAct = computed(
  () =>
    canSign.value &&
    !!current.value?.enabled &&
    current.value.compatible &&
    current.value.codeVerified,
);
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
async function load() {
  loading.value = true;
  try {
    const [modules, records] = await Promise.all([
      api.moduleState(props.dao.reference.daoId),
      api.treasury(props.dao.reference.daoId),
    ]);
    data.value = modules;
    treasury.value = records;
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
    error.value = friendlyError(cause);
  } finally {
    loading.value = false;
  }
}
watch(
  () => props.dao.reference.daoId,
  () => {
    void load();
  },
  { immediate: true },
);
async function run(target: string, action: string, payload: Uint8Array, message: string) {
  if (!props.member) return;
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
    await workspace.refresh();
    await load();
    success.value = message;
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function install(module: ModuleState['modules'][number]) {
  const permission = permissions[module.deployment.id];
  await run(
    props.dao.reference.contract,
    'modconfig',
    encodeAction('modconfig', {
      ...actor(),
      account: module.deployment.account,
      version: 1,
      actions: permission.actions,
      grants: permission.grants,
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
        dues: payments.map(() => 0),
      }),
      'Work proposed',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
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
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="success" class="notice" role="status">{{ success }}</p>
  <p v-if="loading" role="status">Reading contract state…</p>
  <template v-if="section === 'modules'"
    ><div class="section-toolbar">
      <h2>DAO modules</h2>
      <RouterLink :to="helpLink('modules')">Permissions &amp; versions ↗</RouterLink>
    </div>
    <div class="dao-grid">
      <article
        v-for="module in data?.modules"
        :key="module.deployment.id"
        class="panel module-card"
      >
        <div class="panel-heading">
          <h3>{{ names[module.deployment.id] }}</h3>
          <span class="pill">{{ module.enabled ? 'Enabled' : 'Available' }}</span>
        </div>
        <p class="muted">
          v{{ module.deployment.version }} · Interface {{ module.manifest.interfaceVersion }}
        </p>
        <p>
          {{
            module.deployment.id === 'decide'
              ? 'Member, credit, or escrowed native stake ballots.'
              : module.deployment.id === 'works'
                ? 'Reserved milestones with independent contributor review.'
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
          Grants: {{ permissions[module.deployment.id].grants.join(', ') }}. The contract’s upgrade
          authority can change its behavior.
        </p>
        <button
          v-if="!module.enabled && member?.admin"
          :disabled="!canSign || !module.compatible || !module.codeVerified"
          @click="install(module)"
        >
          Enable {{ names[module.deployment.id] }}</button
        ><button
          v-else-if="module.enabled && member?.admin"
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
    <p v-if="data && !data.modules.length" class="notice">
      No module deployments are configured on this service. Connect a compatible release to enable
      it.
    </p></template
  >
  <template v-else
    ><div class="section-toolbar">
      <h2>{{ section === 'decide' ? 'Decide' : section === 'works' ? 'Works' : 'Payroll' }}</h2>
      <RouterLink :to="helpLink(section)">Rules &amp; help ↗</RouterLink>
    </div>
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
            ><select id="weight" v-model="weight">
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
          type="number"
          min="5001"
          max="10000"
          required
        />
        <p class="field-help">
          5000 = 50%. Weight is frozen at opening. New members cannot vote in an existing ballot.
        </p>
        <button :disabled="!canAct">Open ballot</button>
      </form>
      <div v-if="!data?.ballots.length" class="empty-state">
        <h3>No ballots yet</h3>
        <p>Open a decision with an explicit weight, quorum, and closing time.</p>
      </div>
      <article v-for="ballot in data?.ballots" :key="ballot.id" class="panel">
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
          <button class="secondary" :disabled="!canAct" @click="vote(ballot.id, 0)">
            Vote Reject</button
          ><button :disabled="!canAct" @click="vote(ballot.id, 1)">Vote Approve</button>
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
      </article></template
    >
    <template v-else-if="section === 'works'"
      ><form
        v-if="member?.active && current?.enabled"
        class="panel form-panel"
        @submit.prevent="propose"
      >
        <h3>Propose milestone work</h3>
        <label for="contributor">Contributor member ID</label
        ><input id="contributor" v-model="contributor" inputmode="numeric" required />
        <div class="two-column">
          <div>
            <label for="work-document">Proposal document ID</label
            ><input id="work-document" v-model="documentId" inputmode="numeric" required />
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
        <p class="field-help">
          Use an existing durable document. Acceptance reserves the full project amount; review
          approves each payment.
        </p>
        <button :disabled="!canAct">Propose work</button>
      </form>
      <article v-for="project in data?.projects" :key="project.id" class="panel">
        <h3>Project {{ project.id }}</h3>
        <p>
          Contributor {{ project.contributor }} · Document {{ project.document_id }} / v{{
            project.document_version
          }}
          ·
          {{ project.status === 0 ? 'Proposed' : project.status === 1 ? 'Accepted' : 'Cancelled' }}
        </p>
        <button
          v-if="project.status === 0 && member?.admin"
          :disabled="!canAct"
          @click="accept(project.id)"
        >
          Accept and reserve funds</button
        ><button
          v-if="project.status <= 1 && member?.admin"
          class="secondary"
          :disabled="!canAct"
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
                  (member?.reviewer &&
                    member.memberId !== project.contributor &&
                    milestone.status === 2))
              "
              class="secondary"
              :disabled="!canAct"
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
          /><button :disabled="!canAct">Submit milestone evidence</button>
        </form>
        <form
          v-else-if="
            member?.reviewer &&
            member.memberId !== selectedProject.contributor &&
            selectedWork.status === 2
          "
          @submit.prevent="reviewWork(true)"
        >
          <label for="review-doc">Review document ID</label
          ><input
            id="review-doc"
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
            <button :disabled="!canAct">Approve milestone</button
            ><button
              type="button"
              class="secondary"
              :disabled="!canAct || !reviewDoc"
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
        v-if="member?.admin && current?.enabled"
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
        /><button :disabled="!canAct">Commit funded payroll</button>
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
          Paused. Settlement pays nothing until an administrator resumes it.
        </p>
        <form
          v-if="member?.admin && current?.enabled && current.actions.includes('edit')"
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
            ><input v-model="draftPaused[schedule.id]" type="checkbox" /> Paused</label
          ><button :disabled="!canAct">Save payroll settings</button>
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
</template>
