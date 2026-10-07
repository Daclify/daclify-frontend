<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Network, Plus } from '@lucide/vue';
import { DaoPresets } from '@daclify/core-protocol';
import { useWorkspace } from '../state/workspace';
import { directoryQuery, directoryMember, filterDirectory } from '../state/directory';
import DaoCard from '../components/DaoCard.vue';
const state = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const query = computed(() => directoryQuery(route.query));
function update(key: 'q' | 'purpose' | 'mine' | 'sort', value: string | undefined) {
  void router.replace({ query: { ...route.query, [key]: value || undefined } });
}
const search = computed({ get: () => query.value.q, set: (value) => update('q', value) });
const purpose = computed({
  get: () => query.value.purpose,
  set: (value) => update('purpose', value),
});
const sort = computed({ get: () => query.value.sort, set: (value) => update('sort', value) });
const visible = computed(() => filterDirectory(state.daos, state.memberships, query.value));
const memberCount = computed(
  () => state.daos.filter((d) => directoryMember(d, state.memberships)).length,
);
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">CONNECTED COMMUNITIES</p>
      <h1>Your DAO hub</h1>
      <p class="lead">Find your community. Make decisions. Build something together.</p>
    </div>
    <RouterLink class="button" to="/create"><Plus aria-hidden="true" /> Create DAO</RouterLink>
  </div>
  <div class="stats-grid">
    <article class="stat-card">
      <span>Connected DAOs</span><strong>{{ state.daos.length }}</strong
      ><small>Current configured runtime</small>
    </article>
    <article class="stat-card">
      <span>Your memberships</span><strong>{{ memberCount }}</strong
      ><small>One identity, separate DAO permissions</small>
    </article>
    <article class="stat-card">
      <span>Core governance</span><strong>Free</strong><small>Optional Operations modules</small>
    </article>
  </div>
  <div class="section-toolbar">
    <label
      >DAO purpose filter<select v-model="purpose">
        <option value="">All purposes</option>
        <option v-for="preset in DaoPresets" :key="preset.id" :value="preset.id">
          {{ preset.title }}
        </option>
      </select></label
    >
    <div class="segmented" role="group" aria-label="DAO filter">
      <button :aria-pressed="!query.mine" @click="update('mine', undefined)">All DAOs</button
      ><button :aria-pressed="query.mine" @click="update('mine', '1')">My communities</button>
    </div>
    <label
      >Sort DAOs<select v-model="sort">
        <option value="name">Name</option>
        <option value="members">Member count</option>
      </select></label
    >
    <label class="search"
      ><span class="sr-only">Search DAOs</span
      ><input v-model="search" type="search" placeholder="Search communities…"
    /></label>
  </div>
  <p v-if="!state.loading" class="field-help" role="status">
    {{ visible.length }} of {{ state.daos.length }} DAOs · configured runtime directory
  </p>
  <p v-if="state.loading" role="status">Loading the hub…</p>
  <div v-else-if="!visible.length" class="empty-state">
    <Network class="empty-icon" aria-hidden="true" />
    <h2>
      {{
        search || query.purpose || query.mine
          ? 'No matching communities'
          : 'A place for your next community'
      }}
    </h2>
    <p>
      {{
        search || query.purpose || query.mine
          ? 'Try another name or clear the filters.'
          : 'Create your first DAO on this runtime. Independent deployment discovery in this application is still being completed.'
      }}
    </p>
    <button
      v-if="search || query.purpose || query.mine"
      class="secondary"
      @click="router.replace({ query: {} })"
    >
      Clear filters
    </button>
    <RouterLink v-else class="button secondary" to="/create">Create your first DAO</RouterLink>
  </div>
  <div v-else class="dao-grid">
    <DaoCard
      v-for="dao in visible"
      :key="JSON.stringify(dao.reference)"
      :dao="dao"
      :member="!!directoryMember(dao, state.memberships)"
      :network="state.network"
    />
  </div>
  <aside class="info-strip">
    <Network class="info-icon" aria-hidden="true" />
    <div>
      <strong>Your DAO, your deployment</strong>
      <p>
        Start in a shared contract or run your own. The hub connects communities without controlling
        their governance.
      </p>
    </div>
    <RouterLink to="/docs/deployments">Learn how</RouterLink>
  </aside>
</template>
