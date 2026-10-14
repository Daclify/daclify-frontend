<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DaoRef, DaoContent, UserMembership } from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
import DocumentReview from './DocumentReview.vue';
const props = defineProps<{
  dao: DaoRef;
  member: UserMembership | undefined;
  content: DaoContent | undefined;
  target: ModuleState['ballotTargets'][number] | undefined;
  dispute: ModuleState['arbitrationPlans'][number] | undefined;
}>();
const emit = defineEmits<{ reviewed: [value: boolean] }>();
const checked = ref(false),
  documents = ref<Record<string, boolean>>({});
const references = computed(() => {
  const rows: { label: string; id: string; version: number; commitment: string }[] = [],
    target = props.target;
  if (target?.work)
    rows.push({
      label: 'Work proposal',
      id: target.work.project.document_id,
      version: target.work.project.document_version,
      commitment: target.work.document_commitment,
    });
  if (target?.grant) {
    const grant = target.grant;
    rows.push(
      {
        label: 'Round rules',
        id: grant.round.document_id,
        version: grant.round.document_version,
        commitment: grant.rules_commitment,
      },
      {
        label: 'Application',
        id: grant.application.document_id,
        version: grant.application.document_version,
        commitment: grant.application_commitment,
      },
      {
        label: 'Eligibility review',
        id: grant.application.decision_doc,
        version: grant.application.decision_version,
        commitment: grant.decision_commitment,
      },
    );
  }
  if (props.dispute) {
    const p = props.dispute.protection;
    rows.push(
      {
        label: 'Submission',
        id: p.submission_doc,
        version: p.submission_version,
        commitment: p.submission_commitment,
      },
      {
        label: 'Reviewer decision',
        id: p.review_doc,
        version: p.review_version,
        commitment: p.review_commitment,
      },
      {
        label: 'Challenge',
        id: p.challenge_doc,
        version: p.challenge_version,
        commitment: p.challenge_commitment,
      },
    );
  }
  return rows
    .filter((row) => row.id !== '0')
    .map((row) => ({ ...row, key: `${row.id}:${row.version}:${row.commitment}` }));
});
const protection = computed(
  () => props.target?.work?.protection ?? props.target?.grant?.protection,
);
const context = computed(() =>
  JSON.stringify([
    props.dao,
    props.member?.memberId,
    props.member?.signingKey,
    props.target,
    props.dispute,
  ]),
);
watch(context, () => {
  checked.value = false;
  documents.value = {};
  emit('reviewed', false);
});
const ready = computed(
  () => checked.value && references.value.every((row) => documents.value[row.key]),
);
watch(ready, (value) => emit('reviewed', value), { immediate: true });
</script>
<template>
  <section class="panel" aria-label="Exact ballot terms">
    <h3>{{ dispute ? 'Fixed dispute outcome' : 'Funding terms at ballot opening' }}</h3>
    <template v-if="target?.work">
      <p>
        Works project {{ target.work.project.id }} · contributor
        {{ target.work.project.contributor }}.
      </p>
      <ul>
        <li v-for="milestone in target.work.milestones" :key="milestone.id">
          Milestone {{ milestone.id }}: {{ milestone.quantity }} · due
          {{ new Date(milestone.due * 1000).toLocaleString() }}
        </li>
      </ul>
      <p v-if="target.work.agreement">
        Agreement: {{ new Date(target.work.agreement.term_start * 1000).toLocaleString() }} to
        {{ new Date(target.work.agreement.term_end * 1000).toLocaleString() }}.
        {{ target.work.agreement.accepted ? 'Contributor accepted.' : 'No recorded acceptance.' }}
      </p>
    </template>
    <template v-if="target?.grant">
      <p>
        Grants round {{ target.grant.round.id }} · application {{ target.grant.application.id }},
        revision {{ target.grant.application.revision }} · contributor
        {{ target.grant.application.contributor }}.
      </p>
      <ul>
        <li v-for="(payment, index) in target.grant.application.payments" :key="index">
          {{ payment }} · due
          {{ new Date((target.grant.application.dues[index] ?? 0) * 1000).toLocaleString() }}
        </li>
      </ul>
      <p>
        Agreement: {{ new Date(target.grant.application.term_start * 1000).toLocaleString() }} to
        {{ new Date(target.grant.application.term_end * 1000).toLocaleString() }}. Round maximum
        {{ target.grant.round.maximum }}.
      </p>
    </template>
    <p v-if="protection">
      Protected agreement: member vote, then backup member {{ protection.rules.backup }}. Review
      {{ protection.rules.review_seconds }}s · challenge {{ protection.rules.challenge_seconds }}s ·
      vote {{ protection.rules.vote_seconds }}s · backup {{ protection.rules.backup_seconds }}s.
    </p>
    <template v-if="dispute">
      <p>
        Milestone {{ dispute.protection.source_id }} · contributor
        {{ dispute.protection.recipient }} · {{ dispute.quantity }}. Voting approves this fixed
        payment or cancels only this unpaid milestone.
      </p>
      <p>
        {{ dispute.voters.length }} eligible voters at opening. The contributor and all involved
        reviewers are excluded.
      </p>
      <p v-if="!dispute.voters.some((row) => row.member_id === member?.memberId)" class="notice">
        You are not in this ballot’s eligible voter list.
      </p>
      <details>
        <summary>Frozen eligible voters</summary>
        <ul>
          <li v-for="voter in dispute.voters" :key="voter.member_id">
            Member {{ voter.member_id }} · weight {{ voter.weight }}
          </li>
        </ul>
      </details>
    </template>
    <div v-for="reference in references" :key="reference.key">
      <h4>{{ reference.label }} · version {{ reference.version }}</h4>
      <DocumentReview
        :dao="dao"
        :member="member"
        :content="content"
        :document-id="reference.id"
        :version="reference.version"
        :commitment="reference.commitment"
        @reviewed="(value) => (documents[reference.key] = value)"
      />
    </div>
    <label class="choice"
      ><input
        v-model="checked"
        type="checkbox"
        :disabled="!references.every((row) => documents[row.key])"
      />
      I reviewed these exact terms and evidence</label
    >
  </section>
</template>
