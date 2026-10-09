<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import {
  daoPaymentKey,
  type DaoRef,
  type DaoContent,
  type PublicPerson,
  type GovernanceState,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import PeopleGrid from './PeopleGrid.vue';
const props = defineProps<{ dao: DaoRef; members: DaoContent['members'] }>();
const state = useWorkspace(),
  profiles = ref<PublicPerson[]>([]),
  governance = ref<GovernanceState>(),
  error = ref('');
let generation = 0,
  disposed = false;
watch(
  () => daoPaymentKey(props.dao),
  async () => {
    const request = ++generation;
    profiles.value = [];
    error.value = '';
    governance.value = undefined;
    void api
      .governance(props.dao.daoId)
      .then((value) => {
        if (!disposed && request === generation) governance.value = value;
      })
      .catch(() => {});
    try {
      let after: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await api.people({ daoId: props.dao.daoId, ...(after ? { after } : {}) });
        if (disposed || request !== generation) return;
        profiles.value.push(...page.profiles);
        after = page.next ?? undefined;
        if (after && seen.has(after)) throw new Error('CHAIN_RESPONSE_INVALID');
        if (after) seen.add(after);
      } while (after);
    } catch (cause) {
      if (request === generation) error.value = friendlyError(cause);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
const people = computed(() =>
  props.members.map((member) => {
    const profile = profiles.value.find((person) => person.memberId === member.id)?.profile;
    return {
      key: member.id,
      label: profile?.name || member.native_account || `Member ${member.id}`,
      profile,
      to: `/users/${props.dao.daoId}/${member.id}`,
      active: member.active,
      own: state.memberships.some(
        (m) => daoPaymentKey(m.dao) === daoPaymentKey(props.dao) && m.memberId === member.id,
      ),
      badges: [
        member.active ? 'Active' : 'Inactive',
        ...(member.admin ? ['Administrator'] : []),
        ...(member.reviewer ? ['Reviewer'] : []),
        ...(governance.value?.executives.some((e) => e.member_id === member.id)
          ? ['Executive']
          : []),
        ...(governance.value?.excludedVoters.some((v) => v.member_id === member.id)
          ? ['Non-voting member']
          : []),
        `${member.credits} credits`,
      ],
    };
  }),
);
</script>
<template>
  <p v-if="error" class="notice">
    Public profiles are unavailable. Member records are still shown.
  </p>
  <PeopleGrid :people="people" members />
</template>
