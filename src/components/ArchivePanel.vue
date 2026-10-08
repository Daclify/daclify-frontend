<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { daoPaymentKey, type DaoRef, type UserMembership } from '@daclify/core-protocol';
import { ArchiveRoutes, MIN_ARCHIVE_RETENTION_SECONDS } from '@daclify/modules/archive';
import type { ModuleState } from '@daclify/modules';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoRef; member: UserMembership }>(),
  workspace = useWorkspace();
const ballots = ref<ModuleState['ballots']>([]),
  next = ref<string | null>(null),
  selected = ref(''),
  busy = ref(false),
  error = ref('');
const plan = ref<z.infer<typeof ArchiveRoutes.preview.response>>();
let sequence = 0;
function clearPreview() {
  sequence++;
  plan.value = undefined;
  error.value = '';
  busy.value = false;
}
async function load(cursor?: string) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const page = await api.moduleState(
      props.dao.daoId,
      cursor
        ? {
            ballots: cursor,
            projects: 'done',
            schedules: 'done',
            elections: 'done',
            terms: 'done',
            joinApplications: 'done',
            rounds: 'done',
            applications: 'done',
          }
        : {},
    );
    if (daoPaymentKey(page.dao) !== daoPaymentKey(props.dao)) throw new Error('DAO_REFERENCE');
    if (request === sequence) {
      for (const row of page.ballots)
        if (row.status !== 0 && !ballots.value.some((item) => item.id === row.id))
          ballots.value.push(row);
      next.value = page.next.ballots;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function preview() {
  if (!selected.value || !props.member.active || !props.member.admin) return;
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  plan.value = undefined;
  try {
    const result = await api.archivePreview({
      dao: props.dao,
      ballotIds: [selected.value],
      retentionSeconds: MIN_ARCHIVE_RETENTION_SECONDS,
    });
    if (request === sequence) plan.value = result;
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      props.dao,
      props.member.active,
      props.member.admin,
      props.member.memberId,
      workspace.account?.id,
    ]),
  () => {
    sequence++;
    selected.value = '';
    ballots.value = [];
    next.value = null;
    plan.value = undefined;
    error.value = '';
    busy.value = false;
    if (props.member.active && props.member.admin) void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => sequence++);
const reasons = {
  'protected-family': 'This ballot controls work, grants or an election. Its records stay live.',
  'ballot-active': 'Finalize the ballot before planning its archive.',
  'terminal-marker-required':
    'The operator must create a verified terminal marker. Legacy records then wait a new 90 days.',
  'terminal-not-irreversible':
    'The finalization marker is awaiting irreversible chain confirmation.',
  retention: 'The 90-day wait from actual finalization or legacy marking has not ended.',
};
</script>
<template>
  <section
    v-if="member.active && member.admin"
    class="panel narrow"
    aria-labelledby="archive-heading"
  >
    <h2 id="archive-heading">Archive preview</h2>
    <p>
      Check finalized ordinary polls against the 90-day retention rule. Previewing does not delete
      records, unpin files or authorize a charge.
    </p>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <p v-if="busy" role="status">Reading archive eligibility…</p>
    <form @submit.prevent="preview">
      <label for="archive-ballot">Finalized ballot</label>
      <select
        id="archive-ballot"
        v-model="selected"
        :disabled="busy"
        required
        @change="clearPreview"
      >
        <option value="" disabled>Choose a finalized ballot</option>
        <option v-for="ballot in ballots" :key="ballot.id" :value="ballot.id">
          Ballot #{{ ballot.id }}
        </option>
      </select>
      <button :disabled="busy || !selected">Preview archive eligibility</button>
    </form>
    <button v-if="next" class="secondary" :disabled="busy" @click="load(next)">
      Load more finalized ballots
    </button>
    <p v-if="!busy && !ballots.length && !error">No finalized ballots on this page.</p>
    <template v-if="plan">
      <p v-for="blocked in plan.blocked" :key="blocked.parentId" class="notice" role="status">
        {{ reasons[blocked.reason] }}
      </p>
      <template v-if="plan.families.length">
        <p role="status">
          Eligible for export planning. Estimated gross row/index RAM:
          {{ BigInt(plan.grossRamBytes).toLocaleString() }} bytes.
        </p>
        <p>
          Retained markers and future archive commitments reduce net savings. An export still needs
          storage capacity, a verified independent backup and matching administrator approval before
          pruning.
        </p>
      </template>
      <p class="field-help">
        Snapshot block {{ plan.snapshot.blockNumber }} ·
        {{ new Date(plan.snapshot.timestamp).toLocaleString() }}.
      </p>
    </template>
    <p class="field-help">
      Export, approval, pruning and historic restore are still being implemented. This screen
      provides a read-only preview.
    </p>
    <RouterLink to="/docs/archive" class="help-link">Archive and recovery guide ↗</RouterLink>
  </section>
</template>
