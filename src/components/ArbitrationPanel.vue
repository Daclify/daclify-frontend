<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import {
  daoPaymentKey,
  type DaoContent,
  type DaoSummary,
  type Treasury,
  type UserMembership,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction, type RuntimeActions } from '@daclify/core-protocol/sdk';
import type { ModuleState } from '@daclify/modules';
import { api, friendlyError } from '../api/client';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { useWorkspace } from '../state/workspace';
import { documentLabel } from '../content/document-labels';
import DocumentReferenceLink from './DocumentReferenceLink.vue';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  protection: Treasury['protectedObligations'][number];
  treasury: Treasury;
  data: ModuleState;
  content: DaoContent | undefined;
  busy: boolean;
  now: number;
}>();
const emit = defineEmits<{ updated: []; busy: [value: boolean] }>(),
  workspace = useWorkspace();
const error = ref(''),
  notice = ref(''),
  documentId = ref(''),
  working = ref(false);
let generation = 0,
  disposed = false;
const context = computed(() =>
  JSON.stringify([
    daoPaymentKey(props.dao.reference),
    workspace.account?.id,
    props.member?.memberId,
    props.member?.signingKey,
    props.protection.id,
    props.protection.state,
    props.protection.deadline,
    props.protection.terms,
  ]),
);
watch(context, () => {
  generation++;
  if (working.value) emit('busy', false);
  working.value = false;
  error.value = '';
  notice.value = '';
  documentId.value = '';
});
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  if (working.value) emit('busy', false);
});
const debt = computed(() =>
  props.treasury.obligations.find((row) => row.id === props.protection.id),
);
const poll = computed(() =>
  props.data.ballots.find((row) => row.id === props.protection.ballot_id),
);
const canApprove = computed(() => canSignMember(props.member) && !props.busy && !working.value);
const contributor = computed(() => props.member?.memberId === props.protection.recipient);
const representative = computed(
  () =>
    props.member?.active &&
    props.member.admin &&
    props.member.memberId === props.protection.rules.representative,
);
const canChallenge = computed(
  () =>
    props.now < props.protection.deadline &&
    ((props.protection.state === 2 && representative.value) ||
      (props.protection.state === 3 && contributor.value && props.member?.active)),
);
const stage = computed(
  () =>
    [
      'Awaiting delivery',
      'Awaiting review',
      'Provisional approval',
      'Revision requested',
      'Member vote',
      'Backup decision',
      'Unresolved — funds reserved',
      'Payment approved',
      'Unpaid milestone cancelled',
    ][props.protection.state] ?? 'Unsupported dispute state',
);
const evidence = computed(() =>
  [
    {
      label: 'Review submission',
      id: props.protection.submission_doc,
      version: props.protection.submission_version,
      commitment: props.protection.submission_commitment,
    },
    {
      label: 'Review decision',
      id: props.protection.review_doc,
      version: props.protection.review_version,
      commitment: props.protection.review_commitment,
    },
    {
      label: 'Review challenge',
      id: props.protection.challenge_doc,
      version: props.protection.challenge_version,
      commitment: props.protection.challenge_commitment,
    },
  ].filter((row) => row.id !== '0'),
);
async function perform(operation: () => Promise<unknown>, message: string) {
  if (working.value || props.busy) return;
  const current = ++generation,
    domain = context.value;
  working.value = true;
  emit('busy', true);
  error.value = '';
  notice.value = '';
  try {
    await operation();
    if (disposed || current !== generation || domain !== context.value) return;
    await workspace.refresh();
    if (disposed || current !== generation || domain !== context.value) return;
    emit('updated');
    notice.value = message;
  } catch (cause) {
    if (!disposed && current === generation) error.value = friendlyError(cause);
  } finally {
    if (!disposed && current === generation) {
      working.value = false;
      emit('busy', false);
    }
  }
}
function actor() {
  if (!props.member) throw new Error('AUTH_REQUIRED');
  return {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: props.member.memberId,
    obligation_id: props.protection.id,
    expected_terms: props.protection.terms,
  };
}
async function sign<K extends 'arbchallenge' | 'arbbackup' | 'arbconsent'>(
  action: K,
  fields: RuntimeActions[K],
  message: string,
) {
  const member = props.member;
  if (!member || !canApprove.value) return;
  await perform(
    () =>
      relayInstruction(
        makeInstruction(
          props.dao.reference,
          member.memberId,
          member.nonce,
          Math.floor(Date.now() / 1000) + 300,
          props.dao.reference.contract,
          action,
          encodeAction(action, fields),
        ),
      ),
    message,
  );
}
async function challenge() {
  const document = props.content?.documents.find((row) => row.id === documentId.value);
  if (!canChallenge.value || !document) return;
  await sign(
    'arbchallenge',
    { ...actor(), document_id: document.document_id, document_version: document.version },
    'Dispute opened. Funds remain reserved.',
  );
}
async function backup(payout: boolean) {
  if (
    props.protection.state !== 5 ||
    props.now >= props.protection.deadline ||
    !props.member?.active ||
    props.member.memberId !== props.protection.rules.backup
  )
    return;
  await sign(
    'arbbackup',
    { ...actor(), payout },
    payout ? 'Fixed payment approved.' : 'The unpaid milestone was cancelled.',
  );
}
async function consent(outcome: 0 | 1 | 2) {
  if (props.protection.state !== 6 || (!contributor.value && !representative.value)) return;
  await sign(
    'arbconsent',
    { ...actor(), outcome },
    outcome === 2
      ? 'Your settlement consent was withdrawn.'
      : 'Settlement consent recorded. Both parties must approve the same outcome.',
  );
}
async function advance(operation: 'advance' | 'open-vote') {
  if (!workspace.account) return;
  await perform(
    () =>
      api.arbitration({ dao: props.dao.reference, obligationId: props.protection.id, operation }),
    operation === 'open-vote'
      ? 'Primary voting opened when eligible voters were available; funds remain reserved.'
      : 'The deadline transition was applied.',
  );
}
async function execute() {
  if (
    props.protection.state !== 4 ||
    poll.value?.status !== 1 ||
    props.now >= props.protection.deadline
  )
    return;
  await perform(
    () => api.execute(props.dao.reference, props.protection.ballot_id),
    'The approved dispute outcome was applied once.',
  );
}
</script>
<template>
  <section class="panel" aria-label="Protected milestone">
    <h3>{{ stage }}</h3>
    <p>
      Milestone {{ protection.source_id }} · {{ debt?.quantity }} · contributor
      {{ protection.recipient }}.
      {{ protection.state < 7 ? 'Its fixed amount remains reserved.' : '' }}
    </p>
    <p v-if="protection.state < 7">
      Deadline: {{ new Date(protection.deadline * 1000).toLocaleString() }}. Backup member
      {{ protection.rules.backup }}; DAO representative {{ protection.rules.representative }}.
    </p>
    <p v-for="reference in evidence" :key="reference.label">
      <DocumentReferenceLink
        :dao-id="dao.reference.daoId"
        :document-id="reference.id"
        :version="reference.version"
        :commitment="reference.commitment"
        :return-to="`/dao/${dao.reference.daoId}/works`"
        :label="reference.label"
      />
    </p>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <form v-if="canChallenge" @submit.prevent="challenge">
      <label
        >Challenge evidence<select v-model="documentId" :disabled="busy || working" required>
          <option value="" disabled>Choose the exact document version</option>
          <option
            v-for="document in content?.documents ?? []"
            :key="document.id"
            :value="document.id"
          >
            {{ documentLabel(document) }} · version {{ document.version }}
          </option>
        </select></label
      ><button :disabled="!canApprove || !documentId">Challenge this decision</button>
    </form>
    <div v-if="workspace.account" class="button-row">
      <button
        v-if="
          (protection.state === 0 || protection.state === 1 || protection.state === 3) &&
          now >= protection.deadline
        "
        type="button"
        :disabled="busy || working"
        @click="advance('open-vote')"
      >
        Open member vote
      </button>
      <button
        v-if="
          protection.state === 4 && protection.ballot_id === '0' && now + 60 < protection.deadline
        "
        type="button"
        :disabled="busy || working"
        @click="advance('open-vote')"
      >
        Open member vote
      </button>
      <RouterLink
        v-if="protection.state === 4 && protection.ballot_id !== '0'"
        :to="`/dao/${dao.reference.daoId}/decide`"
        >Review dispute ballot</RouterLink
      >
      <button
        v-if="protection.state === 4 && poll?.status === 1 && now < protection.deadline"
        type="button"
        :disabled="busy || working"
        @click="execute"
      >
        Apply voted outcome
      </button>
      <button
        v-if="protection.state < 6 && now >= protection.deadline"
        type="button"
        :disabled="busy || working"
        @click="advance('advance')"
      >
        {{
          protection.state === 2
            ? 'Finalize unchallenged approval'
            : protection.state === 4
              ? 'Escalate to backup'
              : protection.state === 5
                ? 'Record unresolved outcome'
                : 'Apply deadline transition'
        }}
      </button>
    </div>
    <div
      v-if="
        protection.state === 5 &&
        member?.active &&
        member.memberId === protection.rules.backup &&
        now < protection.deadline
      "
      class="button-row"
    >
      <button type="button" :disabled="!canApprove" @click="backup(true)">
        Approve fixed payment</button
      ><button type="button" class="secondary" :disabled="!canApprove" @click="backup(false)">
        Cancel unpaid milestone
      </button>
    </div>
    <template v-if="protection.state === 6"
      ><p>
        The primary and backup deadlines expired. Funds remain reserved. The contributor and fixed
        DAO representative must approve matching payout or cancellation; either can withdraw their
        own consent before settlement.
      </p>
      <p>
        Current settlement:
        {{
          protection.consent_outcome === 2
            ? 'None'
            : protection.consent_outcome === 1
              ? 'Payout'
              : 'Cancellation'
        }}
        · {{ protection.consent_mask & 1 ? 'Contributor approved.' : '' }}
        {{ protection.consent_mask & 2 ? 'DAO representative approved.' : '' }}
      </p>
      <div v-if="contributor || representative" class="button-row">
        <button type="button" :disabled="!canApprove" @click="consent(1)">
          Consent to fixed payout</button
        ><button type="button" class="secondary" :disabled="!canApprove" @click="consent(0)">
          Consent to cancellation</button
        ><button type="button" class="secondary" :disabled="!canApprove" @click="consent(2)">
          Withdraw my consent
        </button>
      </div></template
    >
  </section>
</template>
