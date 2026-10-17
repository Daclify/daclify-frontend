<script setup lang="ts">
import { computed } from 'vue';
import { type PublicMember } from '@daclify/core-protocol';
import PeopleGrid from '../components/PeopleGrid.vue';
import { useWorkspace } from '../state/workspace';
import { usePublicDirectory } from '../state/public-people';
const state = useWorkspace(),
  { users, next, busy, error, load } = usePublicDirectory();
const localMembership = computed(() =>
  state.memberships.find(
    (member) =>
      member.dao.chainId === state.network?.chainId &&
      member.dao.contract === state.network.runtime,
  ),
);
const own = (person: PublicMember) =>
  state.memberships.some(
    (member) =>
      member.dao.chainId === person.dao.chainId &&
      member.dao.contract === person.dao.contract &&
      member.dao.daoId === person.dao.daoId &&
      member.memberId === person.id,
  );
const cards = computed(() => {
  const result = users.value.map((user) => {
    const member = user.memberships.find((m) => !!m.profile) ?? user.memberships[0];
    if (!member) throw new Error('PUBLIC_MEMBER_REQUIRED');
    const ownedMember = state.account ? user.memberships.find(own) : undefined;
    const yours = !!ownedMember;
    const ownRoute = ownedMember
      ? ownedMember.dao.daoId === localMembership.value?.dao.daoId &&
        ownedMember.id === localMembership.value?.memberId
        ? '/users/me'
        : `/users/${ownedMember.dao.daoId}/${ownedMember.id}`
      : undefined;
    const profile = user.profile;
    return {
      key: user.key,
      label: profile?.name || user.nativeAccount || `Member ${member.id}`,
      profile: profile ?? undefined,
      to: ownRoute ?? `/users/${member.dao.daoId}/${member.id}`,
      own: yours,
      lastActive: user.lastActive,
      communities: [
        ...new Map(
          user.memberships.map((m) => [
            m.dao.daoId,
            {
              key: m.dao.daoId,
              title:
                state.daos.find(
                  (d) =>
                    d.reference.daoId === m.dao.daoId &&
                    d.reference.chainId === m.dao.chainId &&
                    d.reference.contract === m.dao.contract,
                )?.title ?? `DAO ${m.dao.daoId}`,
              to: `/dao/${m.dao.daoId}`,
              active: m.active,
            },
          ]),
        ).values(),
      ],
    };
  });
  if (state.account && !result.some((card) => card.own))
    result.unshift({
      key: 'me',
      label: localMembership.value?.nativeAccount || 'Your profile',
      profile: undefined,
      to: '/users/me',
      own: true,
      lastActive: null,
      communities: state.memberships
        .filter(
          (m) =>
            m.dao.chainId === state.network?.chainId && m.dao.contract === state.network.runtime,
        )
        .map((m) => ({
          key: m.dao.daoId,
          title:
            state.daos.find((d) => d.reference.daoId === m.dao.daoId)?.title ??
            `DAO ${m.dao.daoId}`,
          to: `/dao/${m.dao.daoId}`,
          active: m.active,
        })),
    });
  return result;
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
    Explore members and their public aliases. Personal fields in encrypted profiles appear only in
    the profile view for authorized readers.
  </p>
  <p v-if="error" class="alert" role="alert">
    {{
      cards.length
        ? 'Could not load more users. The users below are still available.'
        : 'Could not load users.'
    }}
    {{ error }}
    <button type="button" class="text-button" @click="load()">Retry</button>
  </p>
  <PeopleGrid
    :people="cards"
    :loading="busy"
    :failed="!!error"
    :has-more="busy || !!next"
    empty-text="No public DAO members are registered on this network yet."
  />
  <p v-if="busy" role="status">Loading members across DAOs…</p>
  <p v-if="busy || next" class="field-help">
    Community links and latest activity cover memberships loaded so far.
  </p>
  <button v-if="next && !busy" class="secondary" @click="load()">Load more users</button>
  <details class="users-privacy">
    <summary>About this directory</summary>
    <p class="field-help">
      Members appear even before publishing a profile. Encrypted profiles expose only their alias;
      older plaintext profiles remain public. Profiles belong to public DAO memberships; matching
      public accounts or signing identities connect their communities. Private sign-in pairings are
      never displayed. Last active means their latest successful DAO action; older activity may not
      have been recorded.
    </p>
  </details>
</template>
<style scoped>
.users-privacy {
  margin-top: 1.5rem;
}
</style>
