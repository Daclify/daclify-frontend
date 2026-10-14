<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ModuleState } from '@daclify/modules';
import ProtectionTermsForm from './ProtectionTermsForm.vue';
import type { WorksActions } from '@daclify/modules/sdk';
import type { DaoContent } from '@daclify/core-protocol';
import type { UserMembership } from '@daclify/core-protocol';
const props = defineProps<{
  project: ModuleState['projects'][number];
  milestones: ModuleState['milestones'];
  agreement: ModuleState['agreements'][number] | undefined;
  member: UserMembership | undefined;
  offerAllowed: boolean;
  acceptAllowed: boolean;
  busy: boolean;
  protection: ModuleState['protectedWorksTerms'][number] | undefined;
  protectionRequired: boolean;
  protectionAllowed: boolean;
  decideAccount: string;
  members: DaoContent['members'];
  labels: Record<string, string>;
}>();
const emit = defineEmits<{
  offer: [project: string, start: number, end: number];
  accept: [project: string];
  protect: [
    project: string,
    rules: Omit<WorksActions['offerprot'], 'runtime' | 'dao_id' | 'member_id' | 'project_id'>,
  ];
}>();
const now = Math.floor(Date.now() / 1000),
  latest = Math.max(now, ...props.milestones.map((m) => m.due));
function localInput(seconds: number) {
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const start = ref(localInput(now)),
  end = ref(localInput(latest + 86400)),
  reviewed = ref(false);
const dated = computed(() => props.milestones.every((m) => m.due > 0));
const date = (seconds: number) => new Date(seconds * 1000).toLocaleString();
function offer() {
  emit(
    'offer',
    props.project.id,
    Math.floor(new Date(start.value).getTime() / 1000),
    Math.floor(new Date(end.value).getTime() / 1000),
  );
}
</script>
<template>
  <section aria-label="Contribution agreement" class="agreement-consent">
    <template v-if="agreement"
      ><h3>Contribution agreement</h3>
      <p>{{ date(agreement.term_start) }} — {{ date(agreement.term_end) }}</p>
      <p>
        Contributor {{ project.contributor }} ·
        {{ agreement.accepted ? 'Terms accepted' : 'Awaiting contributor consent'
        }}<span v-if="agreement.accepted"> · {{ date(agreement.accepted_at) }}</span>
      </p>
      <p v-if="!protection">
        DAO review team approves milestones. Approved payment liabilities survive cancellation. This
        agreement grants no administrator role and does not establish legal certification.
      </p>
      <p v-if="protectionRequired && !protection" class="notice">
        This DAO requires protected terms before contributor consent and funding.
      </p>
      <ProtectionTermsForm
        v-if="
          !agreement.accepted &&
          !protection &&
          project.status === 0 &&
          (member?.admin || member?.memberId === project.creator)
        "
        :contributor="project.contributor"
        :decide="decideAccount"
        :members="members"
        :labels="labels"
        :allowed="protectionAllowed"
        :busy="busy"
        @offer="(rules) => emit('protect', project.id, rules)"
      />
      <template v-if="protection"
        ><p>
          Protected agreement · eligible members vote using
          {{ ['equal membership', 'governance credits', 'native stake'][protection.rules.kind] }}.
          Contributor and reviewers cannot vote on their dispute.
        </p>
        <p>
          Quorum {{ protection.rules.quorum / 100 }}% · decision threshold
          {{ protection.rules.approval / 100 }}%. Review
          {{ protection.rules.review_seconds / 86400 }} days · challenge
          {{ protection.rules.challenge_seconds / 86400 }} days · vote
          {{ protection.rules.vote_seconds / 86400 }} days, plus 60 seconds to execute.
        </p>
        <p>
          DAO representative
          {{
            labels[protection.rules.representative] || `Member ${protection.rules.representative}`
          }}
          · backup {{ labels[protection.rules.backup] || `Member ${protection.rules.backup}` }} has
          {{ protection.rules.backup_seconds / 86400 }} days after escalation. If no valid decision
          arrives, funds stay reserved until matching settlement consent.
        </p></template
      >
      <details>
        <summary>Frozen consent reference</summary>
        <p class="mono wrap">{{ protection?.commitment ?? agreement.terms }}</p>
        <p>
          Document {{ project.document_id }} / v{{ project.document_version }}; contributor,
          milestone amounts, due dates and term are committed. Changing terms requires a successor
          project.
        </p>
      </details>
      <template
        v-if="
          !agreement.accepted &&
          project.status === 0 &&
          member?.active &&
          member.memberId === project.contributor &&
          (!protectionRequired || !!protection)
        "
        ><label class="checkbox"
          ><input v-model="reviewed" type="checkbox" />I reviewed this document, milestones, review
          and cancellation policy</label
        ><button
          type="button"
          :disabled="busy || !acceptAllowed || !reviewed"
          @click="emit('accept', project.id)"
        >
          Sign agreement acceptance
        </button></template
      >
    </template>
    <details
      v-else-if="
        project.status === 0 &&
        member?.active &&
        (member.admin || member.memberId === project.creator)
      "
    >
      <summary>Offer as a contribution agreement</summary>
      <p>
        Freeze the contributor's consent to this proposal document and native milestone terms before
        funding. Publish any narrative changes as a successor project.
      </p>
      <p v-if="!dated" class="field-help">
        This project has undated milestones. Create a successor with due dates for a current
        contribution term.
      </p>
      <form v-else @submit.prevent="offer">
        <label :for="`agreement-start-${project.id}`">Term starts</label
        ><input
          :id="`agreement-start-${project.id}`"
          v-model="start"
          type="datetime-local"
          required
        /><label :for="`agreement-end-${project.id}`">Term ends</label
        ><input :id="`agreement-end-${project.id}`" v-model="end" type="datetime-local" required />
        <p class="field-help">
          Maximum one year; every milestone due date must fall inside the term. Review remains with
          the DAO's actual reviewer/admin team. Cancellation preserves approved payments.
        </p>
        <button :disabled="busy || !offerAllowed">Sign and offer agreement</button>
      </form>
    </details>
  </section>
</template>
