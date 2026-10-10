<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IdSchema } from '@daclify/core-protocol';
import { CoreHelpBundle } from '@daclify/core-protocol/help';
import permissionDiagram from '@daclify/core-protocol/diagrams/contract-permissions.svg?url';
import { ModulesHelpBundle } from '@daclify/modules/help';
import type { ModuleState } from '@daclify/modules';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, RefreshCw, Search } from '@lucide/vue';
import { api, ApiFailure, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import {
  documentationBundles,
  documentationStatus,
  groupGuides,
  searchGuides,
} from '../help/catalog';
import ReferencePanel from '../components/ReferencePanel.vue';

const state = useWorkspace();
const route = useRoute();
const router = useRouter();
const bundles = documentationBundles([CoreHelpBundle, ModulesHelpBundle]);
function updateFilter(key: 'q' | 'collection', value: string) {
  void router.replace({
    path:
      key === 'collection' &&
      activeBundle.value &&
      value !== 'all' &&
      activeBundle.value.producer !== value
        ? '/docs'
        : route.path,
    query: {
      ...route.query,
      [key]: value && (key !== 'collection' || value !== 'all') ? value : undefined,
    },
    hash: route.hash,
  });
}
const query = computed({
  get: () => (typeof route.query.q === 'string' ? route.query.q.slice(0, 200) : ''),
  set: (value: string) => updateFilter('q', value),
});
const producer = computed({
  get: () =>
    route.query.collection === 'core' || route.query.collection === 'modules'
      ? route.query.collection
      : 'all',
  set: (value: string) => updateFilter('collection', value),
});
const searching = computed(() => !!query.value.trim());
const searchOpen = ref(!route.params.topic || searching.value);
function toggleSearch(event: Event) {
  if (event.target instanceof HTMLDetailsElement) searchOpen.value = event.target.open;
}
const searchInput = ref<HTMLInputElement>();
const guideTitle = ref<HTMLHeadingElement>();
const sidebarMedia = window.matchMedia('(min-width: 1280px)');
const contentsOpen = ref(sidebarMedia.matches);
function resizeContents() {
  contentsOpen.value = sidebarMedia.matches;
}
function toggleContents(event: Event) {
  if (event.target instanceof HTMLDetailsElement) contentsOpen.value = event.target.open;
}
onMounted(() => sidebarMedia.addEventListener('change', resizeContents));
async function resetFilters() {
  await router.replace({
    query: { ...route.query, q: undefined, collection: undefined },
    hash: route.hash,
  });
  searchOpen.value = true;
  await nextTick();
  searchInput.value?.focus();
}
const moduleState = ref<ModuleState>();
const readError = ref('');
const reading = ref(false);
const referencesOpen = ref(false);
let sequence = 0;
const selectedBundles = computed(() =>
  bundles.filter((bundle) => producer.value === 'all' || bundle.producer === producer.value),
);
const topics = computed(() => searchGuides(selectedBundles.value, query.value));
const groups = computed(() => groupGuides(topics.value));
const active = computed(() =>
  bundles.flatMap((bundle) => bundle.topics).find((topic) => topic.id === route.params.topic),
);
const activeBundle = computed(() =>
  bundles.find((bundle) => bundle.topics.some((topic) => topic.id === active.value?.id)),
);
const activeGroup = computed(() =>
  groupGuides(bundles.flatMap((bundle) => bundle.topics)).find((group) =>
    group.topics.some((topic) => topic.id === active.value?.id),
  ),
);
const neighbors = computed(() => {
  const siblings = activeGroup.value?.topics ?? [];
  const index = siblings.findIndex((topic) => topic.id === active.value?.id);
  return { previous: siblings[index - 1], next: siblings[index + 1] };
});
const status = computed(() =>
  activeBundle.value
    ? documentationStatus(activeBundle.value, state.network, moduleState.value, active.value?.id)
    : undefined,
);
function guideLink(id: string) {
  const bundle = bundles.find((bundle) => bundle.topics.some((topic) => topic.id === id));
  return {
    path: `/docs/${id}`,
    query: {
      ...route.query,
      q: undefined,
      collection:
        producer.value !== 'all' && bundle?.producer !== producer.value
          ? undefined
          : route.query.collection,
    },
  };
}
const overviewLink = computed(() => ({ path: '/docs', query: { ...route.query, q: undefined } }));
function toggleReferences(event: Event) {
  if (event.target instanceof HTMLDetailsElement) referencesOpen.value = event.target.open;
}
watch(
  () => [route.params.topic, searching.value],
  async () => {
    referencesOpen.value = false;
    searchOpen.value = !route.params.topic || searching.value;
    if (searching.value || !route.params.topic) return;
    if (!sidebarMedia.matches) contentsOpen.value = false;
    await nextTick();
    guideTitle.value?.focus();
  },
);
async function loadDeployment() {
  const value = route.query.dao;
  const current = ++sequence;
  moduleState.value = undefined;
  readError.value = '';
  reading.value = false;
  if (value === undefined) return;
  const id = IdSchema.safeParse(value);
  if (!id.success) {
    readError.value = 'The DAO reference in this help link is invalid.';
    return;
  }
  if (activeBundle.value?.producer !== 'modules' || searching.value) return;
  reading.value = true;
  try {
    const result = await api.moduleState(id.data, {
      ballots: 'done',
      projects: 'done',
      schedules: 'done',
      elections: 'done',
      terms: 'done',
      joinApplications: 'done',
      rounds: 'done',
      applications: 'done',
    });
    if (current !== sequence) return;
    if (result.dao.daoId !== id.data) throw new ApiFailure('DAO_REFERENCE');
    moduleState.value = result;
  } catch (cause) {
    if (current === sequence) readError.value = friendlyError(cause);
  } finally {
    if (current === sequence) reading.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      route.query.dao,
      state.network?.chainId,
      state.network?.runtime,
      state.network?.interfaceVersion,
      activeBundle.value?.producer,
      searching.value,
    ]),
  () => {
    void loadDeployment();
  },
  { immediate: true },
);
onUnmounted(() => {
  sequence++;
  sidebarMedia.removeEventListener('change', resizeContents);
});
</script>
<template>
  <div class="handbook-page">
    <div v-if="!route.params.topic || searching" class="page-heading handbook-heading">
      <div>
        <p class="eyebrow">HELP IN THE WORKSPACE</p>
        <h1>Daclify handbook</h1>
        <p class="lead">Practical guides for joining, running and growing your DAO.</p>
      </div>
      <span class="pill">Core interface {{ state.network?.interfaceVersion ?? 1 }}</span>
    </div>
    <details class="handbook-tools" :open="searchOpen" @toggle="toggleSearch">
      <summary><Search aria-hidden="true" /> Search the handbook</summary>
      <div class="handbook-search">
        <div>
          <label for="guide-search">Search guides</label
          ><input
            id="guide-search"
            ref="searchInput"
            v-model="query"
            type="search"
            maxlength="200"
            placeholder="Accounts, privacy, milestones…"
          />
          <p class="field-help" role="status">
            {{ topics.length }} {{ topics.length === 1 ? 'guide' : 'guides' }} found
          </p>
        </div>
        <div>
          <label for="guide-bundle">Guide collection</label
          ><select id="guide-bundle" v-model="producer">
            <option value="all">All guides</option>
            <option v-for="bundle in bundles" :key="bundle.producer" :value="bundle.producer">
              {{ bundle.producer === 'core' ? 'Platform & accounts' : 'DAO modules' }}
            </option>
          </select>
          <p class="field-help">Search titles and guide text.</p>
        </div>
        <button
          v-if="searching || producer !== 'all'"
          class="text-button handbook-reset"
          @click="resetFilters"
        >
          Reset search and filters
        </button>
      </div>
    </details>
    <div class="docs-layout" :class="{ 'handbook-index': !route.params.topic || searching }">
      <details
        v-if="route.params.topic && !searching"
        class="docs-sidebar"
        :open="contentsOpen"
        @toggle="toggleContents"
      >
        <summary>
          <BookOpen aria-hidden="true" /> Contents
          <span>{{ activeGroup?.title ?? 'Browse guides' }}</span>
        </summary>
        <nav class="docs-nav" aria-label="Documentation topics">
          <RouterLink class="handbook-overview" :to="overviewLink"
            ><ArrowLeft aria-hidden="true" /> Handbook overview</RouterLink
          >
          <details
            v-for="group in groups"
            :key="group.id"
            class="guide-group"
            :open="
              !!query.trim() ||
              group.topics.some((topic) => topic.id === active?.id) ||
              (!active && group.id === 'getting-started')
            "
          >
            <summary>
              {{ group.title }} <span class="guide-count">{{ group.topics.length }}</span>
            </summary>
            <RouterLink v-for="topic in group.topics" :key="topic.id" :to="guideLink(topic.id)">{{
              topic.title
            }}</RouterLink>
          </details>
        </nav>
      </details>
      <article class="panel docs-content">
        <template v-if="searching">
          <header class="guide-results-heading">
            <h2>Search results</h2>
            <p>Guides matching “{{ query.trim() }}”</p>
          </header>
          <div v-if="topics.length" class="guide-results">
            <RouterLink
              v-for="topic in topics"
              :key="topic.id"
              :to="guideLink(topic.id)"
              class="guide-result"
            >
              <div>
                <h3>{{ topic.title }}</h3>
                <p>{{ topic.paragraphs[0] }}</p>
              </div>
              <ArrowUpRight aria-hidden="true" />
            </RouterLink>
          </div>
          <div v-else class="handbook-empty" role="status">
            <Search aria-hidden="true" />
            <h2>No matching guides</h2>
            <p>No guides match your search. Try a shorter phrase.</p>
            <button class="secondary" @click="resetFilters">Reset search and filters</button>
          </div>
        </template>
        <template v-else-if="active && activeBundle">
          <header class="guide-heading">
            <nav class="guide-breadcrumb" aria-label="Guide location">
              <RouterLink :to="overviewLink">Handbook overview</RouterLink
              ><span aria-hidden="true">/</span
              ><span>{{ activeGroup?.title ?? 'More guides' }}</span>
            </nav>
            <h1 ref="guideTitle" tabindex="-1">{{ active.title }}</h1>
            <p class="guide-release">
              {{ activeBundle.producer === 'core' ? 'Core' : 'Modules' }} documentation v{{
                activeBundle.packageVersion
              }}
              · Interface {{ activeBundle.interfaceVersion }}
              <span v-if="route.query.dao" class="pill">DAO {{ route.query.dao }}</span>
            </p>
          </header>
          <div v-if="readError" class="guide-check-error" role="alert">
            <div>
              <strong>Deployment check unavailable</strong>
              <p>{{ readError }}</p>
            </div>
            <button
              v-if="IdSchema.safeParse(route.query.dao).success"
              class="secondary"
              :disabled="reading"
              @click="loadDeployment"
            >
              <RefreshCw aria-hidden="true" /> Retry deployment check
            </button>
          </div>
          <p v-if="reading" role="status">Verifying the DAO's module release…</p>
          <div
            v-if="status && status.state !== 'matches'"
            class="guide-version"
            :class="status.state === 'mismatch' ? 'alert' : 'notice'"
            :role="status.state === 'mismatch' ? 'alert' : 'status'"
          >
            <strong>{{
              status.state === 'mismatch'
                ? 'Documentation version mismatch'
                : 'Deployment not verified'
            }}</strong>
            <p v-for="message in status.messages" :key="message">{{ message }}</p>
            <p v-if="status.state === 'mismatch'">
              Treat this as a reference for the labelled release. Obtain matching deployment
              documentation before following its transaction or configuration instructions.
            </p>
          </div>
          <p v-else class="field-help">
            {{
              activeBundle.producer === 'core'
                ? 'Guide version matches the service’s reported version. Core contract code verification is a separate release check.'
                : 'Module guide matches the checked code and reported package version.'
            }}
          </p>
          <div class="guide-body">
            <figure v-if="active.id === 'contract-permissions'" class="permission-diagram">
              <img
                :src="permissionDiagram"
                alt="Daclify contract permissions and module interaction map"
              />
              <figcaption>
                Illustrated configuration after handover. This is an example, not a live account
                audit.
                <a :href="permissionDiagram" target="_blank" rel="noopener"
                  >Open full-size diagram</a
                >
              </figcaption>
            </figure>
            <div v-if="active.id === 'contract-permissions'" class="grid">
              <section>
                <h2>Shared deployments</h2>
                <p>
                  The Daclify DAO controls platform contracts. Your DAO controls its membership,
                  settings and treasury through those contracts.
                </p>
              </section>
              <section>
                <h2>Independent deployments</h2>
                <p>
                  Your executives control your runtime and module accounts. Registering with the Hub
                  gives people a way to find your DAO and grants no control over your contracts.
                </p>
              </section>
            </div>
            <p v-for="paragraph in active.paragraphs" :key="paragraph">{{ paragraph }}</p>
            <section v-if="active.sources?.length" class="guide-sources">
              <h2>Sources & further reading</h2>
              <ul>
                <li v-for="source in active.sources" :key="source.url">
                  <a :href="source.url" target="_blank" rel="noopener noreferrer">{{
                    source.title
                  }}</a>
                  <span class="muted">· Reviewed {{ source.reviewedAt }}</span>
                </li>
              </ul>
            </section>
            <ul v-if="active.id === 'license'">
              <li><a href="https://github.com/Daclify/daclify-backend-core">Core source</a></li>
              <li>
                <a href="https://github.com/Daclify/daclify-backend-modules">Module source</a>
              </li>
              <li><a href="https://github.com/Daclify/daclify-frontend">Frontend source</a></li>
              <li>
                <a href="/LICENSE">AGPL version 3 license text</a>
              </li>
              <li><a href="/third-party-licenses/inter-OFL-1.1.txt">Inter font license</a></li>
            </ul>
          </div>
        </template>
        <template v-else-if="route.params.topic"
          ><h1 ref="guideTitle" tabindex="-1">Guide unavailable</h1>
          <p>
            This documentation bundle does not contain the requested topic. Search the handbook or
            choose an available guide.
          </p>
          <RouterLink class="button secondary" :to="overviewLink"
            >Browse available guides</RouterLink
          ></template
        >
        <template v-else>
          <p class="field-help handbook-version">
            Core v{{ CoreHelpBundle.packageVersion }} · Modules v{{
              ModulesHelpBundle.packageVersion
            }}
            · Interface {{ CoreHelpBundle.interfaceVersion }}. Check your deployment’s Status page
            for available services.
          </p>
          <p v-if="!topics.length" role="status">No guides are available in this collection.</p>
          <div class="guide-collections">
            <section v-for="group in groups" :key="group.id" class="guide-collection">
              <BookOpen :size="22" class="collection-icon" aria-hidden="true" />
              <h2>{{ group.title }}</h2>
              <p>{{ group.description }}</p>
              <details :open="!!query.trim()" class="collection-guides">
                <summary>
                  Browse {{ group.topics.length }}
                  {{ group.topics.length === 1 ? 'guide' : 'guides' }}
                </summary>
                <ul>
                  <li v-for="topic in group.topics" :key="topic.id">
                    <RouterLink :to="guideLink(topic.id)"
                      ><span>{{ topic.title }}</span
                      ><ArrowUpRight :size="16" aria-hidden="true"
                    /></RouterLink>
                  </li>
                </ul>
              </details>
            </section>
          </div>
        </template>
        <details
          v-if="!searching"
          class="reference-details"
          :open="referencesOpen"
          @toggle="toggleReferences"
        >
          <summary>Developer and operator references</summary>
          <h2 v-if="referencesOpen" class="sr-only">Technical references</h2>
          <ReferencePanel
            v-if="referencesOpen"
            :bundles="activeBundle ? [activeBundle] : selectedBundles"
          />
        </details>
        <nav
          v-if="active && activeGroup && !searching"
          class="guide-pagination"
          aria-label="Related guides"
        >
          <RouterLink
            v-if="neighbors.previous"
            :to="guideLink(neighbors.previous.id)"
            class="guide-previous"
            ><ArrowLeft aria-hidden="true" /><span
              ><small>Previous guide</small><strong>{{ neighbors.previous.title }}</strong></span
            ></RouterLink
          >
          <RouterLink v-if="neighbors.next" :to="guideLink(neighbors.next.id)" class="guide-next"
            ><span
              ><small>Next guide</small><strong>{{ neighbors.next.title }}</strong></span
            ><ArrowRight aria-hidden="true"
          /></RouterLink>
        </nav>
      </article>
    </div>
  </div>
</template>

<style scoped>
.handbook-page {
  container-type: inline-size;
  container-name: handbook;
}
.handbook-tools {
  padding: 20px 28px;
  margin-bottom: 24px;
  background: var(--surface-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
.handbook-tools > summary {
  cursor: pointer;
  min-height: 44px;
  font-size: 0.875rem;
  font-weight: 600;
}
.handbook-tools > summary svg {
  width: 18px;
  height: 18px;
  vertical-align: middle;
  color: var(--accent-amber);
  margin-right: 6px;
}
.handbook-tools[open] > summary {
  margin-bottom: 12px;
}
.handbook-heading h1 {
  font-size: clamp(2rem, 3vw, 2.5rem);
}
.handbook-heading .lead {
  font-size: 1rem;
}
.handbook-search {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 16px 24px;
}
.handbook-search label {
  font-size: 0.875rem;
}
.handbook-search .field-help {
  font-size: 0.8125rem;
}
.handbook-reset {
  justify-self: start;
  min-height: 44px;
  grid-column: 1 / -1;
}
.docs-layout {
  grid-template-columns: minmax(14rem, 17rem) minmax(0, 1fr);
  align-items: start;
}
.docs-layout.handbook-index {
  grid-template-columns: minmax(0, 1fr);
}
.docs-sidebar {
  position: sticky;
  top: 16px;
  min-width: 0;
  padding: 16px;
  background: var(--surface-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
.docs-sidebar > summary {
  cursor: pointer;
  min-height: 44px;
  font-size: 0.875rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.docs-sidebar > summary svg {
  width: 18px;
  height: 18px;
  color: var(--accent-amber);
  vertical-align: middle;
  margin-right: 6px;
}
.docs-sidebar > summary > span {
  display: block;
  font-weight: 400;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 8px 0 12px;
}
.docs-nav {
  position: static;
  max-height: calc(100dvh - 9rem);
  overflow-y: auto;
  display: block;
}
.docs-nav a {
  display: block;
  min-width: 0;
  min-height: 44px;
  padding: 12px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.docs-nav a:hover,
.docs-nav a[aria-current='page'] {
  color: var(--text-primary);
  background: var(--surface-soft);
}
.docs-nav a[aria-current='page'] {
  box-shadow: inset 3px 0 var(--accent-amber);
}
.docs-nav .handbook-overview {
  font-weight: 600;
  margin-bottom: 8px;
}
.handbook-overview svg {
  width: 16px;
  height: 16px;
  vertical-align: middle;
  margin-right: 4px;
}
.guide-group {
  border-top: 1px solid var(--border-default);
  padding: 6px 0;
}
.guide-group summary {
  cursor: pointer;
  padding: 14px 8px;
  min-height: 44px;
  font-weight: 600;
  font-size: 0.875rem;
}
.guide-count {
  color: var(--text-muted);
  font-size: 0.8125rem;
  margin-left: 6px;
}
.docs-content {
  min-width: 0;
  width: 100%;
  max-width: none;
  margin: 0;
}
.docs-content p {
  font-size: 1rem;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.docs-content .field-help {
  font-size: 0.8125rem;
}
.guide-heading {
  border-bottom: 1px solid var(--border-default);
  padding-bottom: 20px;
  margin-bottom: 24px;
}
.guide-heading h1 {
  font-size: clamp(1.75rem, 2.4vw, 2.25rem);
  line-height: 1.25;
  max-width: 28ch;
  overflow-wrap: anywhere;
  margin: 20px 0 16px;
}
.guide-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.guide-breadcrumb a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.docs-content .guide-release {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}
.guide-release .pill {
  overflow-wrap: anywhere;
  white-space: normal;
}
.guide-body {
  max-width: 72ch;
  margin-inline: auto;
}
.guide-body > p {
  margin: 0 0 24px;
}
.guide-body h2,
.guide-results-heading h2 {
  font-size: 1.5rem;
}
.guide-body h3 {
  font-size: 1.125rem;
}
.guide-version,
.guide-check-error {
  margin-bottom: 24px;
  padding: 16px;
}
.docs-content .guide-version p,
.docs-content .guide-check-error p {
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 8px 0 0;
}
.guide-check-error {
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
.guide-check-error > div {
  flex: 1;
  min-width: min(100%, 15rem);
}
.guide-check-error svg {
  width: 16px;
  height: 16px;
}
.guide-collections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
  gap: 20px;
  margin-top: 24px;
}
.docs-content .guide-collection {
  margin: 0;
  padding: 24px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
}
.collection-icon {
  color: var(--accent-amber);
}
.guide-collection h2 {
  margin: 16px 0 10px;
  font-size: 1.125rem;
}
.docs-content .guide-collection p {
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.6;
}
.collection-guides summary {
  color: var(--accent-amber);
  cursor: pointer;
  min-height: 44px;
  padding: 12px 0;
  font-size: 0.875rem;
  font-weight: 600;
}
.guide-collection ul {
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
}
.guide-collection a {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 12px;
  font-size: 0.875rem;
  line-height: 1.5;
  min-height: 44px;
  padding: 12px 0;
  overflow-wrap: anywhere;
}
.guide-collection a svg {
  flex: none;
  margin-top: 2px;
}
.guide-results-heading {
  margin-bottom: 24px;
}
.guide-results-heading h2 {
  margin: 0 0 8px;
}
.docs-content .guide-results-heading p {
  margin: 0;
  color: var(--text-secondary);
}
.guide-results {
  display: grid;
  gap: 12px;
}
.guide-result {
  display: flex;
  gap: 20px;
  align-items: start;
  padding: 20px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
}
.guide-result h3 {
  margin: 0 0 10px;
  font-size: 1.125rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.docs-content .guide-result p {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.guide-result svg {
  width: 18px;
  height: 18px;
  flex: none;
  margin-left: auto;
}
.guide-result:hover,
.guide-pagination a:hover {
  border-color: var(--accent-amber);
  text-decoration: none;
}
.handbook-empty {
  padding: 24px 0;
}
.handbook-empty > svg {
  color: var(--accent-amber);
  width: 28px;
  height: 28px;
}
.handbook-empty h2 {
  font-size: 1.5rem;
}
.guide-pagination {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  border-top: 1px solid var(--border-default);
  padding-top: 24px;
  margin-top: 32px;
}
.guide-pagination a {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;
}
.guide-pagination small {
  display: block;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.guide-pagination strong {
  font-size: 0.875rem;
  line-height: 1.5;
}
.guide-pagination svg {
  width: 18px;
  height: 18px;
  flex: none;
}
.guide-next {
  grid-column: 2;
  justify-content: space-between;
}
.docs-content :deep(.reference-details > summary),
.docs-content :deep(.reference-details h4) {
  font-size: 0.875rem;
}
.docs-content :deep(.reference-scroll table) {
  font-size: 0.8125rem;
}
.docs-content :deep(.reference-details pre) {
  font-size: 0.75rem;
}
@media (max-width: 1049px) {
  .docs-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .docs-sidebar {
    position: static;
  }
  .docs-nav {
    max-height: none;
  }
}
@container handbook (max-width: 58rem) {
  .docs-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .docs-sidebar {
    position: static;
  }
  .docs-nav {
    max-height: none;
  }
  .guide-pagination {
    grid-template-columns: minmax(0, 1fr);
  }
  .guide-next {
    grid-column: auto;
  }
}
@media (max-width: 850px) {
  .handbook-search {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 500px) {
  .handbook-tools {
    padding: 16px 20px;
  }
  .docs-content {
    padding: 20px;
  }
  .guide-pagination {
    grid-template-columns: minmax(0, 1fr);
  }
  .guide-next {
    grid-column: auto;
  }
  .guide-result,
  .docs-content .guide-collection {
    padding: 16px;
  }
}
</style>
