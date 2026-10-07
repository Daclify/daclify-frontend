<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ModuleState } from '@daclify/modules';
import type { UserMembership } from '@daclify/core-protocol';
const props = defineProps<{
  project: ModuleState['projects'][number];
  milestones: ModuleState['milestones'];
  agreement: ModuleState['agreements'][number] | undefined;
  member: UserMembership | undefined;
  offerAllowed: boolean;
  acceptAllowed: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  offer: [project: string, start: number, end: number];
  accept: [project: string];
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
      ><h4>Contribution agreement</h4>
      <p>{{ date(agreement.term_start) }} — {{ date(agreement.term_end) }}</p>
      <p>
        Contributor {{ project.contributor }} ·
        {{ agreement.accepted ? 'Terms accepted' : 'Awaiting contributor consent'
        }}<span v-if="agreement.accepted"> · {{ date(agreement.accepted_at) }}</span>
      </p>
      <p>
        DAO review team approves milestones. Approved payment liabilities survive cancellation. This
        agreement grants no administrator role and does not establish legal certification.
      </p>
      <details>
        <summary>Frozen consent reference</summary>
        <p class="mono wrap">{{ agreement.terms }}</p>
        <p>
          Document {{ project.document_id }} / v{{ project.document_version }}; contributor,
          milestone amounts, due dates and term are committed. Changing terms requires a successor
          project.
        </p>
      </details>
      <template
        v-if="
          !agreement.accepted && project.status === 0 && member?.memberId === project.contributor
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
