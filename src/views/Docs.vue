<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IdSchema } from '@daclify/core-protocol';
import { CoreHelpBundle } from '@daclify/core-protocol/help';
import permissionDiagram from '@daclify/core-protocol/diagrams/contract-permissions.svg?url';
import { ModulesHelpBundle } from '@daclify/modules/help';
import type { ModuleState } from '@daclify/modules';
import { ArrowUpRight, BookOpen } from '@lucide/vue';
import { api, friendlyError } from '../api/client';
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
const query = ref('');
const producer = ref<'all' | 'core' | 'modules'>('all');
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
const status = computed(() =>
  activeBundle.value
    ? documentationStatus(activeBundle.value, state.network, moduleState.value, active.value?.id)
    : undefined,
);
function guideLink(id: string) {
  return {
    path: `/docs/${id}`,
    query: typeof route.query.dao === 'string' ? { dao: route.query.dao } : {},
  };
}
function toggleReferences(event: Event) {
  if (event.target instanceof HTMLDetailsElement) referencesOpen.value = event.target.open;
}
watch(producer, () => {
  if (
    activeBundle.value &&
    producer.value !== 'all' &&
    activeBundle.value.producer !== producer.value
  )
    void router.push({ path: '/docs', query: route.query });
});
watch(
  () => route.query.dao,
  async (value) => {
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
    reading.value = true;
    try {
      const result = await api.moduleState(id.data);
      if (current === sequence) moduleState.value = result;
    } catch (cause) {
      if (current === sequence) readError.value = friendlyError(cause);
    } finally {
      if (current === sequence) reading.value = false;
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  sequence++;
});
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">HELP IN THE WORKSPACE</p>
      <h1>Daclify handbook</h1>
      <p class="lead">Practical guides for joining, running and growing your DAO.</p>
    </div>
    <span class="pill">Core interface {{ state.network?.interfaceVersion ?? 1 }}</span>
  </div>
  <div class="panel handbook-search">
    <div>
      <label for="guide-search">Search guides</label
      ><input
        id="guide-search"
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
      <p class="field-help">Each guide shows the release it applies to.</p>
    </div>
  </div>
  <div class="docs-layout">
    <nav
      class="docs-nav"
      :class="{ 'handbook-index': !route.params.topic }"
      aria-label="Documentation topics"
    >
      <RouterLink class="handbook-overview" :to="{ path: '/docs', query: route.query }"
        >Handbook overview</RouterLink
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
    <article class="panel docs-content">
      <p v-if="readError" class="alert" role="alert">{{ readError }}</p>
      <p v-if="reading" role="status">Verifying the DAO's module release…</p>
      <template v-if="active && activeBundle">
        <p class="muted">
          {{ activeBundle.producer === 'core' ? 'Core' : 'Modules' }} documentation v{{
            activeBundle.packageVersion
          }}
          · Interface {{ activeBundle.interfaceVersion }}
        </p>
        <div
          v-if="status && status.state !== 'matches'"
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
        <h2>{{ active.title }}</h2>
        <figure v-if="active.id === 'contract-permissions'" class="permission-diagram">
          <img
            :src="permissionDiagram"
            alt="Daclify contract permissions and module interaction map"
          />
          <figcaption>
            Illustrated configuration after handover. This is an example, not a live account audit.
            <a :href="permissionDiagram" target="_blank" rel="noopener">Open full-size diagram</a>
          </figcaption>
        </figure>
        <div v-if="active.id === 'contract-permissions'" class="grid">
          <section>
            <h3>Shared deployments</h3>
            <p>
              The Daclify DAO controls platform contracts. Your DAO controls its membership,
              settings and treasury through those contracts.
            </p>
          </section>
          <section>
            <h3>Independent deployments</h3>
            <p>
              Your executives control your runtime and module accounts. Registering with the Hub
              gives people a way to find your DAO and grants no control over your contracts.
            </p>
          </section>
        </div>
        <p v-for="paragraph in active.paragraphs" :key="paragraph">{{ paragraph }}</p>
        <section v-if="active.sources?.length" class="guide-sources">
          <h3>Sources & further reading</h3>
          <ul>
            <li v-for="source in active.sources" :key="source.url">
              <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a>
              <span class="muted">· Reviewed {{ source.reviewedAt }}</span>
            </li>
          </ul>
        </section>
        <ul v-if="active.id === 'license'">
          <li><a href="https://github.com/Daclify/daclify-backend-core">Core source</a></li>
          <li><a href="https://github.com/Daclify/daclify-backend-modules">Module source</a></li>
          <li><a href="https://github.com/Daclify/daclify-frontend">Frontend source</a></li>
          <li>
            <a href="/LICENSE">AGPL version 3 license text</a>
          </li>
          <li><a href="/third-party-licenses/inter-OFL-1.1.txt">Inter font license</a></li>
        </ul>
      </template>
      <template v-else-if="route.params.topic"
        ><h2>Guide unavailable</h2>
        <p>
          This documentation bundle does not contain the requested topic. Search the handbook or
          choose an available guide.
        </p></template
      >
      <template v-else>
        <p class="field-help">
          Core v{{ CoreHelpBundle.packageVersion }} · Modules v{{
            ModulesHelpBundle.packageVersion
          }}
          · Interface {{ CoreHelpBundle.interfaceVersion }}. Check your deployment’s Status page for
          available services.
        </p>
        <p v-if="!topics.length" role="status">
          No guides match your search. Try a shorter phrase.
        </p>
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
      <details class="reference-details" @toggle="toggleReferences">
        <summary>Developer and operator references</summary>
        <ReferencePanel
          v-if="referencesOpen"
          :bundles="activeBundle ? [activeBundle] : selectedBundles"
        />
      </details>
    </article>
  </div>
</template>

<style scoped>
.docs-nav {
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  display: block;
}
.docs-nav a {
  display: block;
  min-width: 0;
  padding: 12px;
  border-radius: 8px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.docs-nav a:hover,
.docs-nav a[aria-current='page'] {
  color: var(--text-primary);
  background: var(--surface-soft);
}
.docs-nav .handbook-overview {
  font-weight: 600;
  margin-bottom: 8px;
}
.guide-group {
  border-top: 1px solid var(--line);
  padding: 6px 0;
}
.guide-group summary {
  cursor: pointer;
  padding: 14px 8px;
  font-weight: 600;
  font-size: 13px;
}
.guide-count {
  color: var(--text-muted);
  font-size: 11px;
  margin-left: 6px;
}
.guide-collections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
  margin-top: 28px;
}
.docs-content .guide-collection {
  margin: 0;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-soft);
}
.collection-icon {
  color: var(--accent-amber);
}
.guide-collection h2 {
  margin: 14px 0 10px;
  font-size: 18px;
}
.guide-collection p {
  color: var(--text-muted);
  font-size: 13px;
}
.collection-guides summary {
  color: var(--accent-amber);
  cursor: pointer;
  padding: 12px 0;
  font-size: 13px;
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
  font-size: 13px;
  line-height: 1.5;
  padding: 10px 0;
  overflow-wrap: anywhere;
}
.guide-collection a svg {
  flex-shrink: 0;
  margin-top: 2px;
}
@media (max-width: 1100px) {
  .guide-collections {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 850px) {
  .docs-nav {
    max-height: none;
  }
  .docs-nav.handbook-index {
    display: none;
  }
}
</style>
