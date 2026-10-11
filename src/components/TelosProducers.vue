<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowUpRight, RefreshCw, Search, Server } from '@lucide/vue';
import type { TelosProducerPage } from '@daclify/modules';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
const state = useWorkspace();
const voteFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 2,
});
const page = ref<TelosProducerPage>(),
  loading = ref(false),
  error = ref(''),
  search = ref('');
let revision = 0,
  disposed = false;
function website(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
const visible = computed(
  () =>
    page.value?.producers
      .map((producer, index) => ({ ...producer, rank: index + 1, website: website(producer.url) }))
      .filter((p) => p.owner.includes(search.value.trim().toLowerCase())) ?? [],
);
async function load(cursor?: string) {
  const current = ++revision,
    issuer = resolveApiUrl('/');
  loading.value = true;
  error.value = '';
  if (!cursor) page.value = undefined;
  try {
    const result = await api.telosProducers(cursor);
    if (disposed || current !== revision || issuer !== resolveApiUrl('/')) return;
    if (cursor && result.nextCursor === cursor) throw new Error('TELOS_CURSOR_INVALID');
    if (page.value && JSON.stringify(page.value.source) !== JSON.stringify(result.source))
      throw new Error('TELOS_CHAIN_MISMATCH');
    const records = new Map((page.value?.producers ?? []).map((p) => [p.owner, p]));
    for (const producer of result.producers) records.set(producer.owner, producer);
    page.value = { ...result, producers: [...records.values()] };
  } catch (cause) {
    if (!disposed && current === revision) error.value = friendlyError(cause);
  } finally {
    if (current === revision) loading.value = false;
  }
}
watch(
  () => JSON.stringify([state.network?.chainId, state.network?.runtime]),
  () => {
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  ++revision;
});
</script>
<template>
  <section class="producer-view" aria-label="Block producer standings">
    <div class="producer-heading">
      <div>
        <p class="eyebrow">CONTINUOUS NETWORK ELECTION</p>
        <h2>Block Producers</h2>
        <p>See who is registered and who is currently producing blocks.</p>
      </div>
      <button class="secondary" :disabled="loading" @click="load()">
        <RefreshCw :size="15" aria-hidden="true" /> Refresh producers
      </button>
    </div>
    <div v-if="page" class="producer-summary">
      <Server :size="20" aria-hidden="true" />
      <p>
        <strong v-if="page.scheduleVersion !== null"
          >{{ page.activeSchedule.length }} producers in the active schedule</strong
        ><strong v-else>Active schedule unavailable</strong><br /><span
          >{{ page.source.environment }} · Schedule
          {{ page.scheduleVersion ?? 'unavailable' }}</span
        >
      </p>
    </div>
    <p class="producer-note">
      Standings use the contract’s weighted votes, rather than a direct TLOS balance. The active
      schedule comes from the chain separately. Producer voting is currently available through the
      Telos app.
    </p>
    <label class="producer-search"
      ><Search :size="17" aria-hidden="true" /><span class="sr-only">Search loaded producers</span
      ><input v-model="search" type="search" placeholder="Search loaded producers"
    /></label>
    <p v-if="error" class="producer-error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">Loading block producers…</p>
    <p v-if="page && !visible.length && !loading">No matching producers in the loaded records.</p>
    <ul class="producer-list">
      <li v-for="producer in visible" :key="producer.owner">
        <span class="producer-rank">{{ producer.rank }}</span>
        <div class="producer-identity">
          <strong>{{ producer.owner }}</strong
          ><span
            class="producer-status"
            :class="{ scheduled: page?.activeSchedule.includes(producer.owner) }"
            >{{
              page?.activeSchedule.includes(producer.owner)
                ? 'Active schedule'
                : producer.is_active
                  ? 'Registered'
                  : 'Unregistered'
            }}</span
          >
        </div>
        <div class="producer-weight">
          <strong :title="producer.total_votes"
            >≈ {{ voteFormat.format(Number(producer.total_votes)) }}</strong
          ><small>Weighted votes</small>
        </div>
        <a
          v-if="producer.website"
          :href="producer.website"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Producer website"
          ><ArrowUpRight :size="18" aria-hidden="true"
        /></a>
      </li>
    </ul>
    <button
      v-if="page?.nextCursor"
      class="secondary"
      :disabled="loading"
      @click="load(page.nextCursor)"
    >
      Load more producers
    </button>
    <p v-if="page" class="producer-note">
      Source: eosio · Observed {{ new Date(page.observedAt).toLocaleString() }}. This is the current
      schedule and retained registration state; past schedules are not provided by this view.
    </p>
    <a href="https://app.telos.net" target="_blank" rel="noopener noreferrer"
      >Open Telos app <ArrowUpRight :size="14" aria-hidden="true"
    /></a>
  </section>
</template>
<style scoped>
.producer-view {
  display: grid;
  gap: 1.25rem;
}
.producer-heading {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: start;
}
.producer-heading h2 {
  margin: 0.3rem 0 0.65rem;
}
.producer-heading p {
  margin: 0;
  color: var(--text-muted);
}
.producer-heading button,
.producer-view > a {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.producer-summary {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.2rem;
  border: 1px solid var(--border-warm);
  background: var(--accent-soft);
  border-radius: 12px;
  color: var(--accent-amber);
}
.producer-summary p {
  margin: 0;
  line-height: 1.6;
}
.producer-summary span,
.producer-note {
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.7;
}
.producer-note {
  margin: 0;
}
.producer-search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid var(--border-control);
  border-radius: 9px;
  padding: 0.3rem 0.8rem;
  color: var(--text-muted);
}
.producer-search input {
  border: 0;
  background: transparent;
  width: 100%;
  min-width: 0;
}
.producer-list {
  display: grid;
  list-style: none;
  padding: 0;
  margin: 0;
  gap: 0.7rem;
}
.producer-list li {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.2rem;
  border: 1px solid var(--border-default);
  background: var(--surface-panel);
  border-radius: 12px;
  min-width: 0;
}
.producer-rank {
  color: var(--text-muted);
  font-size: 0.8rem;
  min-width: 1.2rem;
}
.producer-identity,
.producer-weight {
  display: grid;
  gap: 0.4rem;
  min-width: 0;
}
.producer-identity {
  flex: 1;
}
.producer-status {
  font-size: 0.73rem;
  color: var(--text-muted);
}
.producer-status.scheduled {
  color: var(--accent-amber);
}
.producer-weight {
  text-align: right;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}
.producer-weight small {
  color: var(--text-muted);
}
.producer-error {
  color: var(--state-danger);
}
@media (max-width: 600px) {
  .producer-heading {
    flex-direction: column;
  }
  .producer-list li {
    flex-wrap: wrap;
    padding: 1rem;
    gap: 0.6rem;
  }
  .producer-identity {
    min-width: 60%;
  }
  .producer-weight {
    flex: 1;
    text-align: left;
    padding-left: 1.8rem;
  }
}
</style>
