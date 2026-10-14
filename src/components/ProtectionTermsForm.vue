<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DaoContent } from '@daclify/core-protocol';
import type { WorksActions } from '@daclify/modules/sdk';
type Rules = Omit<WorksActions['offerprot'], 'runtime' | 'dao_id' | 'member_id' | 'project_id'>;
const props = defineProps<{
  contributor: string;
  decide: string;
  members: DaoContent['members'];
  labels: Record<string, string>;
  allowed: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{ offer: [rules: Rules] }>();
const backup = ref(''),
  representative = ref(''),
  reviewDays = ref(1),
  challengeDays = ref(1),
  voteDays = ref(2),
  backupDays = ref(7),
  confirmed = ref(false);
const representatives = computed(() =>
  props.members.filter((row) => row.active && row.admin && row.id !== props.contributor),
);
const backups = computed(() =>
  props.members.filter(
    (row) => row.active && row.id !== props.contributor && row.id !== representative.value,
  ),
);
watch(
  () =>
    JSON.stringify([
      props.contributor,
      props.decide,
      backup.value,
      representative.value,
      reviewDays.value,
      challengeDays.value,
      voteDays.value,
      backupDays.value,
    ]),
  () => {
    confirmed.value = false;
  },
  { flush: 'sync' },
);
const valid = computed(
  () =>
    representatives.value.some((row) => row.id === representative.value) &&
    backups.value.some((row) => row.id === backup.value) &&
    [reviewDays.value, challengeDays.value, voteDays.value, backupDays.value].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 30,
    ),
);
function offer() {
  if (!valid.value || !confirmed.value || !props.allowed || props.busy) return;
  emit('offer', {
    decide: props.decide,
    backup: backup.value,
    representative: representative.value,
    review_seconds: reviewDays.value * 86400,
    challenge_seconds: challengeDays.value * 86400,
    vote_seconds: voteDays.value * 86400,
    backup_seconds: backupDays.value * 86400,
  });
}
</script>
<template>
  <details>
    <summary>Protect this agreement</summary>
    <form @submit.prevent="offer">
      <fieldset :disabled="busy">
        <p>
          Reviews are provisional. Eligible members vote on disputes using the frozen DAO voting
          rules; the contributor and all reviewers are excluded. The agreed backup acts if voting
          has no valid result. Unresolved funds stay reserved until both parties agree.
        </p>
        <label
          >DAO representative<select v-model="representative" required>
            <option value="" disabled>Choose an executive</option>
            <option v-for="member in representatives" :key="member.id" :value="member.id">
              {{ labels[member.id] || `Member ${member.id}` }}
            </option>
          </select></label
        >
        <label
          >Backup decision maker<select v-model="backup" required>
            <option value="" disabled>Choose another member</option>
            <option v-for="member in backups" :key="member.id" :value="member.id">
              {{ labels[member.id] || `Member ${member.id}` }}
            </option>
          </select></label
        >
        <div class="two-column">
          <label
            >Review deadline (days)<input
              v-model.number="reviewDays"
              type="number"
              min="1"
              max="30"
              required /></label
          ><label
            >Challenge window (days)<input
              v-model.number="challengeDays"
              type="number"
              min="1"
              max="30"
              required /></label
          ><label
            >Dispute vote (days)<input
              v-model.number="voteDays"
              type="number"
              min="1"
              max="30"
              required /></label
          ><label
            >Backup deadline (days)<input
              v-model.number="backupDays"
              type="number"
              min="1"
              max="30"
              required
          /></label>
        </div>
        <p>
          Give the representative and backup access to private evidence before offering these terms.
          Offering protection does not fund the agreement.
        </p>
        <label class="choice"
          ><input v-model="confirmed" type="checkbox" /> I checked the voting rules, deadlines and
          backup</label
        >
        <button :disabled="!allowed || !valid || !confirmed">Offer protected terms</button>
      </fieldset>
    </form>
  </details>
</template>
