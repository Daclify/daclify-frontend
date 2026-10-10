<script setup lang="ts">
import { computed, ref } from 'vue';
import { LayoutGrid, List, Search } from '@lucide/vue';
import type { PublicProfile } from '@daclify/core-protocol';
import PersonCard from './PersonCard.vue';
const props = defineProps<{
  people: Array<{
    key: string;
    label: string;
    to: string;
    profile?: PublicProfile | undefined;
    own?: boolean;
    badges?: string[];
    active?: boolean;
  }>;
  members?: boolean;
  loading?: boolean;
  failed?: boolean;
  hasMore?: boolean;
  emptyText?: string;
}>();
function savedView() {
  try {
    return localStorage.getItem('daclify.people.view') === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}
const view = ref(savedView()),
  search = ref(''),
  filter = ref('all');
function setView(value: 'cards' | 'list') {
  view.value = value;
  try {
    localStorage.setItem('daclify.people.view', value);
  } catch {
    /* Preference works for this page when storage is blocked. */
  }
}
const visible = computed(() =>
  props.people
    .filter(
      (person) =>
        [
          person.label,
          person.profile?.fullName,
          person.profile?.name,
          person.profile?.location,
          person.profile?.motto,
          ...(person.badges ?? []),
        ]
          .join(' ')
          .toLowerCase()
          .includes(search.value.trim().toLowerCase()) &&
        (filter.value === 'all' || (filter.value === 'active' ? person.active : !person.active)),
    )
    .sort((a, b) => Number(!!b.own) - Number(!!a.own)),
);
</script>
<template>
  <div class="people-toolbar">
    <label class="people-search"
      ><Search aria-hidden="true" /><span class="sr-only">Search users</span
      ><input
        v-model="search"
        placeholder="Search names, communities or locations…"
        type="search" /></label
    ><label v-if="members"
      ><span class="sr-only">Member status</span
      ><select v-model="filter">
        <option value="all">All members</option>
        <option value="active">Active members</option>
        <option value="inactive">Inactive members</option>
      </select></label
    >
    <div class="view-switch" role="group" aria-label="User presentation">
      <button
        type="button"
        :aria-pressed="view === 'cards'"
        aria-label="Cards view"
        @click="setView('cards')"
      >
        <LayoutGrid aria-hidden="true" /></button
      ><button
        type="button"
        :aria-pressed="view === 'list'"
        aria-label="List view"
        @click="setView('list')"
      >
        <List aria-hidden="true" />
      </button>
    </div>
  </div>
  <div class="people-results">
    <p class="field-help" role="status">
      {{ visible.length }} of {{ people.length }} {{ members ? 'members' : 'users' }} shown
      <span v-if="hasMore"> · search covers loaded users; load more to expand it</span>
    </p>
    <button
      v-if="search || filter !== 'all'"
      class="text-button"
      type="button"
      @click="
        search = '';
        filter = 'all';
      "
    >
      Clear filters
    </button>
  </div>
  <div class="people-grid" :class="{ 'people-list': view === 'list' }">
    <PersonCard
      v-for="person in visible"
      :key="person.key"
      :profile="person.profile"
      :label="person.label"
      :to="person.to"
      :own="person.own ?? false"
      :badges="person.badges ?? []"
      :heading="members ? 'h3' : 'h2'"
    />
  </div>
  <p v-if="!visible.length && !loading && !failed" class="empty-state">
    {{
      people.length
        ? 'No users match this view.'
        : (emptyText ?? 'No members are registered in this DAO yet.')
    }}
  </p>
</template>
<style scoped>
.people-results {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: -0.5rem 0 1rem;
}
.people-results p {
  margin: 0;
}
.people-results button {
  min-height: 44px;
}
</style>
