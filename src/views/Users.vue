<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  PeopleRoutes,
  PublicProfileSchema,
  type PublicMember,
  type PublicProfile,
} from '@daclify/core-protocol';
import type { z } from 'zod';
import PeopleGrid from '../components/PeopleGrid.vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const state = useWorkspace(),
  people = ref<PublicMember[]>([]),
  ownProfile = ref<PublicProfile>(),
  next = ref<z.infer<typeof PeopleRoutes.members.response>['next']>(null),
  busy = ref(false),
  error = ref('');
let generation = 0,
  disposed = false;
const seen = new Set<string>();
const own = (person: PublicMember) =>
  state.memberships.some(
    (member) =>
      member.dao.chainId === person.dao.chainId &&
      member.dao.contract === person.dao.contract &&
      member.dao.daoId === person.dao.daoId &&
      member.memberId === person.id,
  );
const publicUsers = computed(() => {
  const users = new Map<string, PublicMember>();
  for (const person of people.value.filter((p) => !own(p))) {
    const key = person.native_account
      ? `native:${person.native_account}`
      : `${person.dao.daoId}:${person.id}`;
    const existing = users.get(key);
    if (!existing || (!existing.profile && person.profile)) users.set(key, person);
  }
  return [...users.entries()].map(([key, person]) => ({
    key,
    label: person.profile?.name || person.native_account || `Member ${person.id}`,
    profile: person.profile ?? undefined,
    to: `/users/${person.dao.daoId}/${person.id}`,
    badges: [
      state.daos.find((dao) => dao.reference.daoId === person.dao.daoId)?.title ??
        `DAO ${person.dao.daoId}`,
    ],
  }));
});
const cards = computed(() => [
  ...(state.account
    ? [
        {
          key: 'me',
          label: ownProfile.value?.name || state.memberships[0]?.nativeAccount || 'Your profile',
          profile: ownProfile.value,
          to: '/users/me',
          own: true,
        },
      ]
    : []),
  ...publicUsers.value,
]);
async function load(cursor?: z.infer<typeof PeopleRoutes.members.query>) {
  const request = generation;
  busy.value = true;
  error.value = '';
  try {
    const page = await api.publicMembers(cursor);
    if (disposed || request !== generation) return;
    if (page.next) {
      const key = JSON.stringify(page.next);
      const previousDao = BigInt(cursor?.daoId ?? '0'),
        currentDao = BigInt(page.next.daoId);
      if (
        seen.has(key) ||
        currentDao < previousDao ||
        (currentDao === previousDao && BigInt(page.next.after) <= BigInt(cursor?.after ?? '0'))
      )
        throw new Error('CHAIN_RESPONSE_INVALID');
      seen.add(key);
    }
    people.value.push(...page.members);
    next.value = page.next;
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
    Browse public DAO members, including people who have not published a profile yet. Profile
    details come from a public DAO membership. The same native account is listed once; private
    sign-in accounts and pairings are not displayed.
  </p>
  <p v-if="error" class="alert" role="alert">
    {{ error }} <button class="text-button" @click="load(next ?? undefined)">Retry</button>
  </p>
  <PeopleGrid
    :people="cards"
    :loading="busy"
    empty-text="No public DAO members are registered on this network yet."
  />
  <p v-if="busy" role="status">Loading public members…</p>
  <button v-else-if="next" class="secondary" @click="load(next ?? undefined)">
    Load more users
  </button>
</template>
