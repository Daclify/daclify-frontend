<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Network, Plus } from '@lucide/vue';
import { DaoPresets, daoPaymentKey, type DirectoryEntry } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { connectOperator } from '../api/operators';
import { lockVault } from '../auth/session';
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
const registry = ref<DirectoryEntry[]>([]),
  registryError = ref(''),
  dialog = ref<HTMLDialogElement>(),
  selected = ref<DirectoryEntry>(),
  connecting = ref(false);
let directorySequence = 0;
watch(
  () => JSON.stringify([state.network?.chainId, state.network?.runtime]),
  async () => {
    const current = ++directorySequence;
    registry.value = [];
    registryError.value = '';
    try {
      const result = await api.hubDirectory();
      if (current === directorySequence) registry.value = result.entries;
    } catch (cause) {
      if (current === directorySequence) registryError.value = friendlyError(cause);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => directorySequence++);
const registered = computed(() =>
  registry.value.filter(
    (e) => !state.daos.some((d) => daoPaymentKey(d.reference) === daoPaymentKey(e.reference)),
  ),
);
const independent = computed(() =>
  registered.value
    .filter(
      (e) =>
        !query.value.mine &&
        (!query.value.purpose || e.purpose === query.value.purpose) &&
        (!query.value.q ||
          `${e.title} ${e.description}`.toLowerCase().includes(query.value.q.toLowerCase())),
    )
    .sort((a, b) => a.title.localeCompare(b.title)),
);
function endpointLabel(value: string) {
  return new URL(value).origin;
}
function review(entry: DirectoryEntry) {
  selected.value = entry;
  registryError.value = '';
  dialog.value?.showModal();
}
async function connect() {
  const entry = selected.value,
    network = state.network;
  if (!entry || !network) return;
  connecting.value = true;
  try {
    await connectOperator(entry);
    lockVault();
    window.location.assign('/dao/' + entry.reference.daoId);
  } catch (cause) {
    registryError.value = friendlyError(cause);
  } finally {
    connecting.value = false;
  }
}
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
      <span>Connected DAOs</span><strong>{{ state.daos.length + registered.length }}</strong
      ><small>Configured runtime and Hub registrations</small>
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
  <section v-if="independent.length" aria-label="Independent Hub registrations">
    <h2>Independent communities</h2>
    <p class="field-help">
      Public information from owner-authorized Hub registrations. A listing is not a security audit.
      Member statistics and private content are supplied by each operator.
    </p>
    <div class="dao-grid">
      <article v-for="entry in independent" :key="daoPaymentKey(entry.reference)" class="panel">
        <p class="eyebrow">
          {{ entry.purpose }} ·
          {{ entry.privacy === 'public' ? 'Public documents' : 'Encrypted documents' }}
        </p>
        <h3>{{ entry.title }}</h3>
        <p>{{ entry.description }}</p>
        <p>Operator: {{ entry.operator }}</p>
        <p class="field-help break-word">
          {{ entry.reference.contract }} · DAO {{ entry.reference.daoId }}
        </p>
        <template v-if="entry.portal.mode === 'external'"
          ><p class="field-help break-word">
            External portal: {{ endpointLabel(entry.portal.url) }}
          </p>
          <a
            class="button secondary"
            :href="entry.portal.url"
            target="_blank"
            rel="noopener noreferrer"
            >Open external DAO portal ↗</a
          ></template
        ><template v-else
          ><p class="field-help break-word">
            Independent API: {{ endpointLabel(entry.portal.apiOrigin) }}
          </p>
          <button class="secondary" @click="review(entry)">
            Review operator connection
          </button></template
        >
      </article>
    </div>
  </section>
  <p v-if="registryError" class="notice" role="alert">Independent directory: {{ registryError }}</p>
  <dialog ref="dialog" class="panel narrow" aria-labelledby="operator-title">
    <h2 id="operator-title">Connect to {{ selected?.operator }}</h2>
    <p>
      This operator runs its own contracts and API. Its service accounts, sign-in pairings, storage
      and backups are separate from Daclify’s.
    </p>
    <p v-if="selected?.portal.mode === 'daclify'" class="break-word">
      <strong>API:</strong> {{ selected.portal.apiOrigin }}
    </p>
    <p>
      Your user-controlled vault stays in this browser. Unlocking and signing in is a separate step,
      bound to this API. Cross-site cookies may require an API alias under daclify.com or the
      operator’s own frontend.
    </p>
    <p v-if="registryError" role="alert">{{ registryError }}</p>
    <button :disabled="connecting" @click="connect">
      {{ connecting ? 'Checking deployment…' : 'Verify and connect to this operator' }}</button
    ><button class="secondary" :disabled="connecting" @click="dialog?.close()">Cancel</button
    ><RouterLink to="/docs/independent-operators" @click="dialog?.close()"
      >Operator and privacy guide</RouterLink
    >
  </dialog>
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
