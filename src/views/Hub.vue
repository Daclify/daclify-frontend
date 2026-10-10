<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowUpRight,
  CircleAlert,
  Globe,
  Network,
  Plus,
  RefreshCw,
  Search,
  Users,
  X,
} from '@lucide/vue';
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
  void router.replace({ query: { ...route.query, [key]: value || undefined }, hash: route.hash });
}
const search = computed({ get: () => query.value.q, set: (value) => update('q', value) });
const purpose = computed({
  get: () => query.value.purpose,
  set: (value) => update('purpose', value),
});
const sort = computed({ get: () => query.value.sort, set: (value) => update('sort', value) });
const searchInput = ref<HTMLInputElement>(),
  resultsTitle = ref<HTMLHeadingElement>();
async function clearSearch() {
  await router.replace({ query: { ...route.query, q: undefined }, hash: route.hash });
  searchInput.value?.focus();
}
async function clearFilters() {
  await router.replace({
    query: { ...route.query, q: undefined, purpose: undefined, mine: undefined, sort: undefined },
    hash: route.hash,
  });
  searchInput.value?.focus();
}
const visible = computed(() => filterDirectory(state.daos, state.memberships, query.value));
const memberCount = computed(
  () => state.daos.filter((d) => directoryMember(d, state.memberships)).length,
);
const registry = ref<DirectoryEntry[]>([]),
  registryError = ref(''),
  registryLoading = ref(false),
  dialog = ref<HTMLDialogElement>(),
  dialogTitle = ref<HTMLHeadingElement>(),
  selected = ref<DirectoryEntry>(),
  connecting = ref(false),
  connectionError = ref('');
let directorySequence = 0;
async function loadRegistry(): Promise<boolean> {
  const current = ++directorySequence;
  registryLoading.value = true;
  try {
    const result = await api.hubDirectory();
    if (current !== directorySequence) return false;
    registry.value = result.entries;
    registryError.value = '';
    return true;
  } catch (cause) {
    if (current === directorySequence) registryError.value = friendlyError(cause);
    return false;
  } finally {
    if (current === directorySequence) registryLoading.value = false;
  }
}
async function retryRegistry() {
  if (registryLoading.value) return;
  if (await loadRegistry()) {
    await nextTick();
    resultsTitle.value?.focus();
  }
}
watch(
  () => JSON.stringify([state.network?.chainId, state.network?.runtime]),
  () => {
    registry.value = [];
    registryError.value = '';
    void loadRegistry();
  },
  { immediate: true },
);
onBeforeUnmount(() => directorySequence++);
const registered = computed(() =>
  registry.value.filter(
    (e) => !state.daos.some((d) => daoPaymentKey(d.reference) === daoPaymentKey(e.reference)),
  ),
);
const independent = computed(() => {
  const text = query.value.q.trim().toLocaleLowerCase();
  return registered.value
    .filter(
      (e) =>
        !query.value.mine &&
        (!query.value.purpose || e.purpose === query.value.purpose) &&
        (!text || `${e.title} ${e.description}`.toLocaleLowerCase().includes(text)),
    )
    .sort((a, b) => a.title.localeCompare(b.title));
});
const totalCount = computed(() => state.daos.length + registered.value.length);
const resultCount = computed(() => visible.value.length + independent.value.length);
const filtered = computed(() => !!(query.value.q || query.value.purpose || query.value.mine));
const busy = computed(() => state.loading || registryLoading.value);
function endpointLabel(value: string) {
  return new URL(value).origin;
}
async function review(entry: DirectoryEntry) {
  selected.value = entry;
  connectionError.value = '';
  await nextTick();
  dialog.value?.showModal();
  dialogTitle.value?.focus();
}
async function connect() {
  const entry = selected.value,
    network = state.network;
  if (!entry || !network || connecting.value) return;
  connecting.value = true;
  connectionError.value = '';
  try {
    await connectOperator(entry);
    lockVault();
    window.location.assign('/dao/' + entry.reference.daoId);
  } catch (cause) {
    connectionError.value = friendlyError(cause);
  } finally {
    connecting.value = false;
  }
}
</script>
<template>
  <div class="hub-page">
    <header class="hub-heading">
      <div>
        <p class="eyebrow">CONNECTED COMMUNITIES</p>
        <h1>Your DAO hub</h1>
        <p class="lead">Find your people. Build something together.</p>
      </div>
      <RouterLink class="button" to="/create"><Plus aria-hidden="true" /> Create DAO</RouterLink>
    </header>
    <div class="hub-context">
      <span v-if="state.network" class="hub-network"
        ><span class="status-dot" aria-hidden="true"></span
        >{{
          state.network.environment === 'mainnet'
            ? 'Mainnet'
            : state.network.environment === 'testnet'
              ? 'Testnet'
              : 'Local network'
        }}</span
      >
      <span v-if="!busy"
        >{{ totalCount.toLocaleString() }} {{ totalCount === 1 ? 'community' : 'communities'
        }}{{ registryError || state.error ? ' loaded' : ' connected' }}</span
      >
      <span v-if="state.account && !state.loading" class="hub-membership"
        ><Users aria-hidden="true" />{{ memberCount.toLocaleString() }} of yours</span
      >
    </div>

    <section class="hub-browser" aria-label="Browse communities">
      <div class="hub-browser-heading">
        <div class="segmented" role="group" aria-label="DAO filter">
          <button :aria-pressed="!query.mine" @click="update('mine', undefined)">All DAOs</button>
          <button :aria-pressed="query.mine" @click="update('mine', '1')">My communities</button>
        </div>
        <RouterLink class="hub-guide" to="/docs/dao-presets"
          >Which DAO fits you? <ArrowUpRight aria-hidden="true"
        /></RouterLink>
      </div>
      <div class="hub-controls">
        <div class="hub-search">
          <label for="hub-search">Search DAOs</label>
          <div class="hub-search-input">
            <Search aria-hidden="true" />
            <input
              id="hub-search"
              ref="searchInput"
              v-model="search"
              type="search"
              placeholder="Search by name or what they do…"
              maxlength="200"
            />
            <button
              v-if="search"
              class="secondary hub-clear-search"
              aria-label="Clear search"
              @click="clearSearch"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
        <div>
          <label for="hub-purpose">Purpose</label>
          <select id="hub-purpose" v-model="purpose" aria-label="DAO purpose filter">
            <option value="">All purposes</option>
            <option v-for="preset in DaoPresets" :key="preset.id" :value="preset.id">
              {{ preset.title }}
            </option>
          </select>
        </div>
        <div>
          <label for="hub-sort">Sort DAOs</label>
          <select id="hub-sort" v-model="sort">
            <option value="name">Name</option>
            <option value="members">Member count</option>
          </select>
        </div>
      </div>
    </section>

    <section
      id="communities"
      class="hub-results"
      aria-labelledby="hub-results-title"
      :aria-busy="busy"
    >
      <div class="hub-results-heading">
        <div>
          <h2 id="hub-results-title" ref="resultsTitle" tabindex="-1">
            {{ query.mine ? 'Your communities' : 'Explore communities' }}
          </h2>
          <p class="hub-result-count" role="status" aria-live="polite">
            {{
              busy
                ? 'Loading communities…'
                : registryError || state.error
                  ? `Showing ${resultCount.toLocaleString()} loaded communities`
                  : `Showing ${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} communities`
            }}
          </p>
        </div>
        <button v-if="filtered" class="text-button hub-reset" @click="clearFilters">
          <X aria-hidden="true" />Clear filters
        </button>
      </div>
      <div v-if="registryError" class="hub-notice" role="alert">
        <CircleAlert aria-hidden="true" />
        <div>
          <strong>Independent listings are unavailable</strong>
          <p>Loaded communities are still available. {{ registryError }}</p>
        </div>
        <button class="secondary" :disabled="registryLoading" @click="retryRegistry">
          <RefreshCw aria-hidden="true" />{{ registryLoading ? 'Retrying…' : 'Retry listings' }}
        </button>
      </div>
      <div v-if="state.loading" class="dao-grid hub-skeletons" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="hub-skeleton">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div v-else-if="query.mine && !state.account && !state.error" class="empty-state">
        <Users class="empty-icon" aria-hidden="true" />
        <h3>Sign in to see your communities</h3>
        <p>Your DAOs appear here when you sign in with an account that belongs to them.</p>
        <RouterLink class="button" :to="{ path: '/account', query: { returnTo: route.fullPath } }"
          >Sign in</RouterLink
        >
      </div>
      <div v-else-if="!busy && !resultCount && !state.error && !registryError" class="empty-state">
        <Network class="empty-icon" aria-hidden="true" />
        <h3>
          {{
            filtered
              ? query.mine && !search && !purpose
                ? 'Your next community is out there'
                : 'No matching communities'
              : 'A place for your next community'
          }}
        </h3>
        <p>
          {{
            filtered
              ? query.mine && !search && !purpose
                ? 'Explore the Hub or start a DAO of your own.'
                : 'Try another name or purpose, or clear the filters to explore every community.'
              : 'Start a DAO for your people, projects and shared decisions.'
          }}
        </p>
        <button v-if="filtered" class="secondary" @click="clearFilters">
          {{ query.mine && !search && !purpose ? 'Browse all DAOs' : 'Reset search and filters' }}
        </button>
        <RouterLink v-else class="button secondary" to="/create">Create your first DAO</RouterLink>
      </div>
      <ul v-else-if="visible.length" class="dao-grid" aria-label="Communities in this workspace">
        <li v-for="dao in visible" :key="daoPaymentKey(dao.reference)">
          <DaoCard
            :dao="dao"
            :member="!!directoryMember(dao, state.memberships)"
            :network="state.network"
          />
        </li>
      </ul>
      <section
        v-if="!state.loading && independent.length"
        class="hub-independent"
        aria-labelledby="independent-title"
      >
        <div class="hub-independent-heading">
          <h2 id="independent-title">Independent communities</h2>
          <p>These communities run their own services. A Hub listing is not a security audit.</p>
          <p v-if="sort === 'members'">
            Member counts are provided by each operator, so these listings stay sorted by name.
          </p>
        </div>
        <ul class="dao-grid" aria-label="Independent Hub registrations">
          <li v-for="entry in independent" :key="daoPaymentKey(entry.reference)">
            <article class="dao-card registry-card">
              <div class="dao-cover dao-cover-fallback" aria-hidden="true">
                <span class="cover-symbol"><Network /></span>
              </div>
              <div class="dao-card-body">
                <div class="dao-card-badges">
                  <span class="pill">{{
                    DaoPresets.find((p) => p.id === entry.purpose)?.title
                  }}</span
                  ><span class="pill">{{
                    entry.privacy === 'public' ? 'Public' : 'Encrypted documents'
                  }}</span>
                </div>
                <h3 class="dao-card-title">{{ entry.title }}</h3>
                <p class="dao-card-description">
                  {{
                    entry.description ||
                    'An independently operated community connected through the Hub.'
                  }}
                </p>
                <p class="registry-operator">Managed by {{ entry.operator }}</p>
                <div class="dao-card-context">
                  <Globe aria-hidden="true" /><span>{{
                    endpointLabel(
                      entry.portal.mode === 'external' ? entry.portal.url : entry.portal.apiOrigin,
                    )
                  }}</span>
                </div>
                <div class="dao-card-context">
                  <span>{{ entry.reference.contract }}</span
                  ><span>DAO {{ entry.reference.daoId }}</span>
                </div>
                <div class="dao-card-footer">
                  <a
                    v-if="entry.portal.mode === 'external'"
                    class="button secondary"
                    :href="entry.portal.url"
                    :aria-label="`Open ${entry.title} portal (opens in a new tab)`"
                    target="_blank"
                    rel="noopener noreferrer"
                    >Open portal <ArrowUpRight aria-hidden="true"
                  /></a>
                  <button
                    v-else
                    class="secondary"
                    :aria-label="`Review operator connection for ${entry.title}`"
                    @click="review(entry)"
                  >
                    Review connection <ArrowUpRight aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          </li>
        </ul>
      </section>
    </section>

    <aside class="hub-deployment-note">
      <Network aria-hidden="true" />
      <div>
        <strong>Your community. Your setup.</strong>
        <p>Start with shared contracts or connect an independent deployment.</p>
      </div>
      <RouterLink to="/docs/deployments"
        >Explore deployment options <ArrowUpRight aria-hidden="true"
      /></RouterLink>
    </aside>
    <dialog
      ref="dialog"
      class="panel hub-operator-dialog"
      aria-labelledby="operator-title"
      @cancel="connecting && $event.preventDefault()"
      @close="
        selected = undefined;
        connectionError = '';
      "
    >
      <div class="hub-dialog-heading">
        <h2 id="operator-title" ref="dialogTitle" tabindex="-1">
          Connect to {{ selected?.title }}
        </h2>
        <button
          class="secondary"
          aria-label="Close operator review"
          :disabled="connecting"
          @click="dialog?.close()"
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <p>
        This operator runs its own contracts and API. Its service accounts, sign-in pairings,
        storage and backups are separate from Daclify’s.
      </p>
      <dl class="hub-operator-details">
        <dt>Operator</dt>
        <dd>{{ selected?.operator }}</dd>
        <template v-if="selected?.portal.mode === 'daclify'"
          ><dt>API destination</dt>
          <dd>{{ selected.portal.apiOrigin }}</dd></template
        >
      </dl>
      <p>
        Your user-controlled vault stays in this browser. Unlocking and signing in is a separate
        step, bound to this API. Cross-site cookies may require an API alias under daclify.com or
        the operator’s own frontend.
      </p>
      <p v-if="connectionError" class="alert" role="alert">{{ connectionError }}</p>
      <div class="hub-dialog-actions">
        <button :disabled="connecting || !state.network" @click="connect">
          {{ connecting ? 'Checking deployment…' : 'Verify and connect' }}</button
        ><button class="secondary" :disabled="connecting" @click="dialog?.close()">Cancel</button>
      </div>
      <RouterLink
        v-if="!connecting"
        class="hub-dialog-guide"
        to="/docs/independent-operators"
        @click="dialog?.close()"
        >Operator and privacy guide <ArrowUpRight aria-hidden="true"
      /></RouterLink>
    </dialog>
  </div>
</template>
<style scoped>
.hub-page {
  display: grid;
  gap: 24px;
}
.hub-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
}
.hub-heading h1 {
  font-size: clamp(2rem, 3vw, 2.5rem);
}
.hub-heading .lead {
  font-size: 1rem;
}
.hub-heading > .button {
  flex: none;
}
.hub-context {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 24px;
  color: var(--text-muted);
  font-size: 0.875rem;
  margin-top: -8px;
}
.hub-network,
.hub-membership {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.hub-network {
  color: var(--text-secondary);
}
.hub-context svg {
  width: 16px;
  height: 16px;
}
.hub-browser {
  padding: 20px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
}
.hub-browser-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.hub-browser-heading .segmented {
  max-width: 100%;
  flex-wrap: wrap;
}
.hub-browser-heading .segmented button {
  font-size: 0.875rem;
}
.hub-guide,
.hub-deployment-note a,
.hub-dialog-guide {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  font-size: 0.875rem;
}
.hub-guide svg,
.hub-deployment-note a svg,
.hub-dialog-guide svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.hub-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
}
.hub-controls > div {
  flex: 1 1 8rem;
  min-width: 0;
}
.hub-controls > .hub-search {
  flex: 2 1 16rem;
}
.hub-controls label {
  margin: 0 0 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}
.hub-controls input,
.hub-controls select {
  font-size: 1rem;
}
.hub-search-input {
  display: flex;
  align-items: center;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  padding: 0 4px 0 14px;
}
.hub-search-input:focus-within {
  border-color: var(--accent-amber);
  outline: 2px solid var(--accent-amber);
  outline-offset: 3px;
}
.hub-search-input > svg {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--text-muted);
}
.hub-search-input input {
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 12px;
}
.hub-search-input input:focus-visible {
  outline: none;
}
.hub-search-input input::-webkit-search-cancel-button {
  display: none;
}
.hub-clear-search {
  padding: 8px;
  width: 44px;
  flex: none;
  border: 0;
  background: transparent;
}
.hub-results {
  min-width: 0;
  scroll-margin-top: 24px;
}
.hub-results-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.hub-results-heading h2 {
  font-size: 1.25rem;
  margin: 0 0 6px;
}
.hub-result-count {
  color: var(--text-muted);
  font-size: 0.875rem;
  margin: 0;
}
.hub-reset {
  gap: 6px;
  font-size: 0.875rem;
  flex: none;
}
.dao-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
  padding: 0;
  margin: 0;
  list-style: none;
}
.dao-grid > li {
  display: flex;
  min-width: 0;
}
.hub-notice {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-warm);
  background: var(--accent-soft);
  border-radius: var(--radius-md);
  margin: 0 0 20px;
}
.hub-notice > svg {
  width: 20px;
  height: 20px;
  flex: none;
  color: var(--accent-amber);
}
.hub-notice div {
  flex: 1;
  min-width: 0;
}
.hub-notice strong {
  font-size: 0.875rem;
}
.hub-notice p {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 4px 0 0;
}
.hub-notice button {
  flex: none;
}
.hub-skeleton {
  min-height: 300px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  padding: 24px;
}
.hub-skeleton span {
  display: block;
  height: 16px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  margin-top: 20px;
}
.hub-skeleton span:first-child {
  height: 100px;
  margin: 0 0 28px;
}
.hub-skeleton span:last-child {
  width: 65%;
}
.empty-state h3 {
  font-size: 1.25rem;
}
.hub-independent {
  margin-top: 32px;
}
.hub-independent-heading {
  margin-bottom: 20px;
}
.hub-independent-heading h2 {
  font-size: 1.25rem;
  margin-bottom: 6px;
}
.hub-independent-heading p {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin: 0;
}
.registry-card .dao-card-body {
  padding-top: 20px;
}
.registry-card .registry-operator {
  margin-top: auto;
  margin-bottom: 12px;
  font-size: 0.8125rem;
  min-height: 0;
  color: var(--text-muted);
}
.registry-card .dao-card-footer .button,
.registry-card .dao-card-footer button {
  width: 100%;
}
.dao-card-context > svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.dao-card-context + .dao-card-context {
  margin-top: 8px;
}
.hub-deployment-note {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid var(--border-default);
}
.hub-deployment-note > svg {
  width: 24px;
  height: 24px;
  color: var(--accent-amber);
  flex: none;
}
.hub-deployment-note div {
  flex: 1;
  min-width: 0;
}
.hub-deployment-note strong {
  font-size: 0.875rem;
}
.hub-deployment-note p {
  margin: 4px 0 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}
.hub-operator-dialog {
  width: min(640px, calc(100% - 32px));
  max-height: calc(100dvh - 32px);
  overflow: auto;
  margin: auto;
  background: linear-gradient(var(--surface-panel), var(--surface-panel)), var(--color-bg-base);
}
.hub-operator-dialog::backdrop {
  background: var(--color-bg-base);
  opacity: 0.8;
}
.hub-dialog-heading {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}
.hub-dialog-heading h2 {
  flex: 1;
  margin: 8px 0 0;
  overflow-wrap: anywhere;
}
.hub-dialog-heading > button {
  padding: 8px;
  flex: none;
  width: 44px;
}
.hub-operator-details {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px 20px;
  padding: 16px;
  margin: 0 0 20px;
  background: var(--surface-soft);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
}
.hub-operator-details dt {
  color: var(--text-muted);
}
.hub-operator-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.hub-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.hub-dialog-guide {
  margin-top: 12px;
}
@media (max-width: 700px) {
  .hub-heading {
    flex-direction: column;
    align-items: flex-start;
    gap: 20px;
  }
  .hub-browser-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .hub-notice {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .hub-notice button {
    margin-left: 36px;
  }
  .hub-deployment-note {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .hub-deployment-note a {
    width: 100%;
  }
}
@media (max-width: 560px) {
  .hub-browser {
    padding: 16px;
  }
  .hub-browser-heading .segmented {
    width: 100%;
    border-radius: var(--radius-md);
  }
  .hub-browser-heading .segmented button {
    flex: 1;
    padding: 8px 10px;
  }
  .hub-results-heading {
    flex-wrap: wrap;
    gap: 8px;
  }
  .hub-reset {
    margin-left: auto;
  }
  .hub-dialog-actions {
    flex-direction: column;
  }
  .hub-operator-details {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .hub-operator-details dd + dt {
    margin-top: 10px;
  }
}
</style>
