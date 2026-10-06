<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowUpRight, Network, Plus } from '@lucide/vue';
import { useWorkspace } from '../state/workspace';
import { DaoPresets, type DaoPurpose } from '@daclify/core-protocol';
const state = useWorkspace();
const search = ref('');
const filter = ref('all');
const purpose = ref<DaoPurpose | ''>('');
const visible = computed(() =>
  state.daos.filter(
    (dao) =>
      (filter.value === 'all' ||
        state.memberships.some((m) => m.dao.daoId === dao.reference.daoId)) &&
      dao.title.toLowerCase().includes(search.value.toLowerCase()) &&
      (!purpose.value || (dao.purpose ?? 'custom') === purpose.value),
  ),
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
      ><small>Shared and independent deployments</small>
    </article>
    <article class="stat-card">
      <span>Your memberships</span><strong>{{ state.memberships.length }}</strong
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
      <button :aria-pressed="filter === 'all'" @click="filter = 'all'">All DAOs</button
      ><button :aria-pressed="filter === 'mine'" @click="filter = 'mine'">My communities</button>
    </div>
    <label class="search"
      ><span class="sr-only">Search DAOs</span
      ><input v-model="search" type="search" placeholder="Search communities…"
    /></label>
  </div>
  <p v-if="state.loading" role="status">Loading the hub…</p>
  <div v-else-if="!visible.length" class="empty-state">
    <Network class="empty-icon" aria-hidden="true" />
    <h2>{{ search ? 'No matching communities' : 'A place for your next community' }}</h2>
    <p>
      {{
        search
          ? 'Try another name or clear the filter.'
          : 'Create your first DAO, or connect an independently deployed community through the hub.'
      }}
    </p>
    <RouterLink class="button secondary" to="/create">Create your first DAO</RouterLink>
  </div>
  <div v-else class="dao-grid">
    <RouterLink
      v-for="dao in visible"
      :key="dao.reference.daoId"
      :to="`/dao/${dao.reference.daoId}`"
      class="dao-card"
      ><div class="dao-card-top">
        <span class="dao-avatar" aria-hidden="true">{{ dao.title.slice(0, 2).toUpperCase() }}</span
        ><span class="pill">{{ dao.privacy === 'public' ? 'Public' : 'Encrypted content' }}</span>
      </div>
      <h2>{{ dao.title }}</h2>
      <span class="pill">{{
        DaoPresets.find((preset) => preset.id === (dao.purpose ?? 'custom'))?.title
      }}</span>
      <span v-if="dao.participantMode === 'agents-guarded'" class="pill"
        >Agents · human emergency controls</span
      >
      <p>
        {{
          dao.description ||
          'A community workspace for decisions, contributions, and shared resources.'
        }}
      </p>
      <div class="dao-card-footer">
        <span>{{ dao.members }} members</span>
        <span class="card-action">Open workspace <ArrowUpRight aria-hidden="true" /></span></div
    ></RouterLink>
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
