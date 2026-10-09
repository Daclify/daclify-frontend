<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { PublicProfileSchema, type PublicPerson, type PublicProfile } from '@daclify/core-protocol';
import PeopleGrid from '../components/PeopleGrid.vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const state = useWorkspace(),
  people = ref<PublicPerson[]>([]),
  ownProfile = ref<PublicProfile>(),
  next = ref<string | null>(null),
  busy = ref(false),
  error = ref(''),
  skipped = ref(0);
let generation = 0,
  disposed = false;
const seen = new Set<string>();
const own = (person: PublicPerson) =>
  state.memberships.some(
    (member) =>
      member.dao.chainId === person.dao.chainId &&
      member.dao.contract === person.dao.contract &&
      member.dao.daoId === person.dao.daoId &&
      member.memberId === person.memberId,
  );
const cards = computed(() => [
  ...(state.account
    ? [
        {
          key: 'me',
          label: ownProfile.value?.name ?? 'Your profile',
          profile: ownProfile.value,
          to: '/users/me',
          own: true,
        },
      ]
    : []),
  ...people.value
    .filter((person) => !own(person))
    .map((person) => ({
      key: person.id,
      label: person.accountName,
      profile: person.profile,
      to: `/users/${person.dao.daoId}/${person.memberId}`,
    })),
]);
async function load(after?: string) {
  const request = generation;
  busy.value = true;
  error.value = '';
  try {
    const page = await api.people(after ? { after } : {});
    if (disposed || request !== generation) return;
    if (page.next && (seen.has(page.next) || BigInt(page.next) <= BigInt(after ?? '0')))
      throw new Error('CHAIN_RESPONSE_INVALID');
    if (page.next) seen.add(page.next);
    people.value.push(...page.profiles);
    next.value = page.next;
    skipped.value += page.skipped;
  } catch (cause) {
    if (request === generation) error.value = friendlyError(cause);
  } finally {
    if (request === generation) busy.value = false;
  }
}
watch(
  () => JSON.stringify([state.network?.chainId, state.network?.runtime, state.account?.id]),
  () => {
    generation++;
    people.value = [];
    seen.clear();
    ownProfile.value = undefined;
    next.value = null;
    skipped.value = 0;
    void load();
  },
  { immediate: true },
);
watch(
  () => JSON.stringify(state.memberships.map((member) => [member.dao, member.memberId])),
  async () => {
    const request = generation;
    const member = state.memberships[0];
    if (!member) return;
    try {
      const row = await api.memberProfile(member.dao.daoId, member.memberId);
      if (disposed || request !== generation) return;
      ownProfile.value = row.profile
        ? PublicProfileSchema.parse(JSON.parse(row.profile))
        : undefined;
    } catch {
      /* An unpublished self profile retains its own card. */
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">THE PEOPLE BEHIND THE DAOS</p>
      <h1>Users</h1>
      <p class="lead">Meet people building and governing communities together.</p>
    </div>
    <RouterLink v-if="state.account" class="button secondary" to="/users/me"
      >Your profile</RouterLink
    ><RouterLink v-else class="button" to="/account">Sign in</RouterLink>
  </div>
  <p class="field-help">
    This directory shows profiles users chose to publish on-chain. Sign-in accounts and private
    pairings stay private. People can publish different handles for different DAO memberships.
  </p>
  <p v-if="error" class="alert" role="alert">
    {{ error }} <button class="text-button" @click="load(next ?? undefined)">Retry</button>
  </p>
  <PeopleGrid :people="cards" />
  <p v-if="busy" role="status">Loading public profiles…</p>
  <button v-else-if="next" class="secondary" @click="load(next ?? undefined)">
    Load more users
  </button>
  <p v-if="skipped" class="muted">{{ skipped }} incompatible profile records were skipped.</p>
</template>
