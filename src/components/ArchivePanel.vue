<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { daoPaymentKey, type DaoRef, type UserMembership } from '@daclify/core-protocol';
import {
  ArchiveRoutes,
  MIN_ARCHIVE_RETENTION_SECONDS,
  archiveExportConsent,
  ArchivePreviewRequestSchema,
  verifyArchiveBundle,
} from '@daclify/modules/archive';
import type { ModuleState } from '@daclify/modules';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { canSignMember } from '../auth/action-signer';
import { relayInstruction } from '../auth/session';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { downloadFile } from '../content/files';
const props = defineProps<{ dao: DaoRef; member: UserMembership }>(),
  workspace = useWorkspace();
const ballots = ref<ModuleState['ballots']>([]),
  next = ref<string | null>(null),
  selected = ref(''),
  busy = ref(false),
  error = ref('');
const plan = ref<z.infer<typeof ArchiveRoutes.preview.response>>();
const approvalConsent = ref<string | null>(null),
  retentionDays = ref(String(MIN_ARCHIVE_RETENTION_SECONDS / 86400));
const consent = ref(false),
  pendingRequest = ref<z.infer<typeof ArchiveRoutes.export.input>>(),
  exports = ref<z.infer<typeof ArchiveRoutes.export.response>[]>([]),
  exportsNext = ref<string | null>(null);
let sequence = 0;
function clearPreview() {
  sequence++;
  plan.value = undefined;
  consent.value = false;
  approvalConsent.value = null;
  pendingRequest.value = undefined;
  error.value = '';
  busy.value = false;
}
async function load(cursor?: string) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const [page, saved] = await Promise.all([
      api.moduleState(
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
      ),
      cursor ? Promise.resolve(undefined) : api.archiveExports(props.dao),
    ]);
    if (daoPaymentKey(page.dao) !== daoPaymentKey(props.dao)) throw new Error('DAO_REFERENCE');
    if (request === sequence) {
      for (const row of page.ballots)
        if (row.status !== 0 && !ballots.value.some((item) => item.id === row.id))
          ballots.value.push(row);
      next.value = page.next.ballots;
      if (saved) {
        exports.value = saved.exports;
        exportsNext.value = saved.next;
      }
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
    if (!/^[1-9][0-9]{1,3}$/.test(retentionDays.value)) throw new Error('ARCHIVE_RETENTION');
    const retentionSeconds = ArchivePreviewRequestSchema.shape.retentionSeconds.parse(
      Number(retentionDays.value) * 86400,
    );
    const result = await api.archivePreview({
      dao: props.dao,
      ballotIds: [selected.value],
      retentionSeconds,
    });
    if (request === sequence) {
      plan.value = result;
      consent.value = false;
      pendingRequest.value =
        result.families.length && !result.blocked.length
          ? {
              requestId: crypto.randomUUID(),
              selection: {
                dao: props.dao,
                ballotIds: [selected.value],
                retentionSeconds,
              },
              ...archiveExportConsent(result),
            }
          : undefined;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
function saveStatus(status: z.infer<typeof ArchiveRoutes.export.response>) {
  exports.value = [status, ...exports.value.filter((e) => e.id !== status.id)];
}
async function createExport() {
  if (!consent.value || !pendingRequest.value || busy.value) return;
  const request = ++sequence,
    input = pendingRequest.value;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.archiveExport(input);
    if (request === sequence) saveStatus(result);
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function authorizeExport(
  item: z.infer<typeof ArchiveRoutes.export.response>,
  action: 'archapprove' | 'archrevoke',
) {
  if (
    busy.value ||
    (action === 'archapprove' && (!item.backup || !item.manifest)) ||
    !props.member.active ||
    !props.member.admin ||
    !canSignMember(props.member)
  )
    return;
  if (action === 'archapprove' && approvalConsent.value !== item.id) return;
  const request = ++sequence,
    member = props.member;
  busy.value = true;
  error.value = '';
  try {
    let anchor = item.anchor;
    if (action === 'archapprove') {
      if (!item.backup || !item.manifest) return;
      const bundle = await api.archiveBundle(props.dao, item.id);
      const status = await api.archiveAttest(props.dao, item.id, {
        manifestCommitment: item.manifest.commitment,
        descriptorCommitment: bundle.manifest.descriptorCommitment,
        backupCommitment: item.backup.commitment,
        retentionSeconds: item.retentionSeconds,
      });
      anchor = status.anchor;
    }
    if (
      request !== sequence ||
      (action === 'archapprove' && approvalConsent.value !== item.id) ||
      !canSignMember(member)
    )
      return;
    if (!anchor) throw new Error('ARCHIVE_ANCHOR_INVALID');
    await relayInstruction(
      makeInstruction(
        member.dao,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 120,
        member.dao.contract,
        action,
        encodeAction(action, {
          runtime: member.dao.contract,
          dao_id: member.dao.daoId,
          member_id: member.memberId,
          manifest_commitment: anchor.manifest_commitment,
          descriptor_commitment: anchor.descriptor_commitment,
          backup_commitment: anchor.backup_commitment,
          retention_seconds: anchor.retention_seconds,
        }),
      ),
    );
    await workspace.refresh();
    const result = await api.archiveRefresh(member.dao, item.id);
    if (request === sequence) {
      saveStatus(result);
      approvalConsent.value = null;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function pruneExport(item: z.infer<typeof ArchiveRoutes.export.response>) {
  if (
    busy.value ||
    !item.pruningAuthorized ||
    !item.manifest ||
    !props.member.active ||
    !props.member.admin
  )
    return;
  const request = ++sequence,
    dao = props.dao;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.archivePrune(dao, item.id, item.manifest.commitment);
    if (request === sequence) saveStatus(result);
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function backupExport(item: z.infer<typeof ArchiveRoutes.export.response>) {
  if (busy.value || !item.manifest || !props.member.active || !props.member.admin) return;
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.archiveBackup(props.dao, item.id, item.manifest.commitment);
    if (request === sequence) saveStatus(result);
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function refreshExport(id: string) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.archiveRefresh(props.dao, id);
    if (request === sequence) saveStatus(result);
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function downloadExport(id: string) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const status = exports.value.find((e) => e.id === id);
    if (!status?.manifest || status.state !== 'verified') throw new Error('ARCHIVE_NOT_READY');
    const bundle = verifyArchiveBundle(
      await api.archiveBundle(props.dao, id),
      status.manifest.commitment,
    );
    if (request === sequence)
      downloadFile(new TextEncoder().encode(JSON.stringify(bundle)), {
        version: 1,
        filename: `daclify-dao-${props.dao.daoId}-archive-${id}.json`,
        mediaType: 'application/json',
      });
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function moreExports() {
  if (!exportsNext.value) return;
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.archiveExports(props.dao, exportsNext.value);
    if (request === sequence) {
      for (const row of result.exports)
        if (!exports.value.some((e) => e.id === row.id)) exports.value.push(row);
      exportsNext.value = result.next;
    }
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
    consent.value = false;
    pendingRequest.value = undefined;
    approvalConsent.value = null;
    exports.value = [];
    exportsNext.value = null;
    error.value = '';
    busy.value = false;
    if (props.member.active && props.member.admin) void load();
  },
  { immediate: true },
);
watch(retentionDays, clearPreview);
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
    <h2 id="archive-heading">Archive exports</h2>
    <p>
      Check finalized ordinary polls against the 90-day retention rule. Previewing does not delete
      records, unpin files or authorize a charge.
    </p>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <p v-if="busy" role="status">Checking archive progress…</p>
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
      <label for="archive-retention">Retention delay (days, minimum 90)</label>
      <input
        id="archive-retention"
        v-model="retentionDays"
        type="number"
        min="90"
        max="3650"
        step="1"
        :disabled="busy"
        required
      />
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
        <form v-if="pendingRequest" @submit.prevent="createExport">
          <p>
            Reserve up to {{ BigInt(pendingRequest.maximumStoredBytes).toLocaleString() }} stored
            bytes from this DAO’s existing hosting capacity. Archive bundles use normal IPFS storage
            pricing.
          </p>
          <label class="checkbox"
            ><input v-model="consent" type="checkbox" :disabled="busy" /> I approve this export and
            its storage reservation.</label
          >
          <button :disabled="busy || !consent">Create archive export</button>
        </form>
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
    <h3>Saved exports</h3>
    <p v-if="!exports.length && !busy">No saved exports for this DAO.</p>
    <ul v-if="exports.length" class="plain-list">
      <li v-for="item in exports" :key="item.id">
        <p>
          Export {{ item.id }} · {{ item.state }}<br />{{ item.verifiedChunks }} of
          {{ item.totalChunks }} chunks verified ·
          {{ BigInt(item.heldBytes).toLocaleString() }} bytes still reserved.
        </p>
        <p v-if="item.state === 'review'" class="notice">
          Operator review is needed. Its files and reservation are retained.
        </p>
        <p v-if="item.manifest" class="field-help">
          Manifest SHA-256: <code class="archive-commitment">{{ item.manifest.commitment }}</code
          >. Keep this commitment separately with your backup.
          {{
            item.anchor
              ? 'The matching anchor is on chain.'
              : 'It has not been anchored on chain yet.'
          }}
        </p>
        <p v-if="item.backup" class="notice">
          Encrypted backup restored and verified
          {{ new Date(item.backup.verifiedAt).toLocaleString() }}. Backup SHA-256:
          <code class="archive-commitment">{{ item.backup.commitment }}</code
          >. This does not authorize pruning.
        </p>
        <p v-else-if="item.state === 'verified' && !item.backupSupported" class="field-help">
          The operator has not configured an independent encrypted backup store. Download your
          recovery bundle and keep it separately.
        </p>
        <button
          v-if="item.state === 'verified' && item.backupSupported && !item.backup"
          :disabled="busy"
          @click="backupExport(item)"
        >
          Create and verify encrypted backup
        </button>
        <p v-if="item.anchor" class="field-help">
          On-chain archive #{{ item.anchor.id }} ·
          {{
            item.anchor.revoked
              ? 'Approval revoked'
              : item.anchor.approved_by !== '0'
                ? 'Administrator approval recorded'
                : 'Availability attested; approval required'
          }}. Retention: {{ item.retentionSeconds / 86400 }} days. Pruning stays separately gated.
        </p>
        <template
          v-if="
            (item.backup || item.anchor) &&
            ['verified', 'pruning', 'completed'].includes(item.state)
          "
        >
          <label
            v-if="
              !item.anchor ||
              item.anchor.revoked ||
              item.anchor.approved_by === '0' ||
              item.anchor.approved_by !== member.memberId
            "
            class="checkbox"
          >
            <input
              type="checkbox"
              :checked="approvalConsent === item.id"
              :disabled="busy"
              @change="approvalConsent = approvalConsent === item.id ? null : item.id"
            />
            I approve this exact manifest and backup for manual pruning of its ordinary poll votes
            after {{ item.retentionSeconds / 86400 }} days and all availability checks.
          </label>
          <button
            v-if="
              !item.anchor ||
              item.anchor.revoked ||
              item.anchor.approved_by === '0' ||
              item.anchor.approved_by !== member.memberId
            "
            :disabled="busy || approvalConsent !== item.id || !canSignMember(member)"
            @click="authorizeExport(item, 'archapprove')"
          >
            Sign archive approval
          </button>
          <button
            v-if="item.anchor && item.anchor.approved_by !== '0' && !item.anchor.revoked"
            class="secondary"
            :disabled="busy || !canSignMember(member)"
            @click="authorizeExport(item, 'archrevoke')"
          >
            Revoke archive approval
          </button>
        </template>
        <button
          v-if="item.pruningAuthorized && item.state !== 'completed'"
          :disabled="busy"
          @click="pruneExport(item)"
        >
          Prune next batch (up to 25 old votes)
        </button>
        <p v-if="item.state === 'pruning'" class="field-help">
          Partial pruning is recorded on chain. Continue manually; revoked approval blocks further
          batches.
        </p>
        <button class="secondary" :disabled="busy" @click="refreshExport(item.id)">
          Refresh export status
        </button>
        <button
          v-if="['verified', 'pruning', 'completed'].includes(item.state)"
          :disabled="busy"
          @click="downloadExport(item.id)"
        >
          Download recovery bundle
        </button>
      </li>
    </ul>
    <button v-if="exportsNext" class="secondary" :disabled="busy" @click="moreExports">
      Load more exports
    </button>
    <p class="field-help">
      This exports ordinary poll votes and a verified manifest. It does not include account recovery
      keys, social-login pairings or original document files. Save the recovery bundle off the
      server. On-chain approval is separate from exporting. Source pruning requires separate
      operator qualification and a manual batch request. Exporting and signing an approval do not
      delete anything. Archived records remain available through verified on-chain history.
    </p>
    <RouterLink to="/docs/archive" class="help-link">Archive and recovery guide ↗</RouterLink>
  </section>
</template>
<style scoped>
.archive-commitment {
  overflow-wrap: anywhere;
}
</style>
