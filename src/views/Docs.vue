<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IdSchema } from '@daclify/core-protocol';
import { CoreHelpBundle } from '@daclify/core-protocol/help';
import permissionDiagram from '@daclify/core-protocol/diagrams/contract-permissions.svg?url';
import { ModulesHelpBundle } from '@daclify/modules/help';
import type { ModuleState } from '@daclify/modules';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { documentationBundles, documentationStatus, searchGuides } from '../help/catalog';
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
      <p class="lead">The rules, responsibilities, and limits behind the interface.</p>
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
      <label for="guide-bundle">Documentation bundle</label
      ><select id="guide-bundle" v-model="producer">
        <option value="all">All bundled guides</option>
        <option v-for="bundle in bundles" :key="bundle.producer" :value="bundle.producer">
          {{ bundle.producer === 'core' ? 'Core' : 'Modules' }} v{{ bundle.packageVersion }}
        </option>
      </select>
      <p class="field-help">Guides come from the pinned producer packages.</p>
    </div>
  </div>
  <div class="docs-layout">
    <nav class="docs-nav" aria-label="Documentation topics">
      <RouterLink :to="{ path: '/docs', query: route.query }">Handbook overview</RouterLink
      ><RouterLink v-for="topic in topics" :key="topic.id" :to="guideLink(topic.id)">{{
        topic.title
      }}</RouterLink>
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
        <p class="notice">
          Core v{{ CoreHelpBundle.packageVersion }} · Modules v{{
            ModulesHelpBundle.packageVersion
          }}
          · Interface {{ CoreHelpBundle.interfaceVersion }}. Live provider verification is pending
          configuration.
        </p>
        <p v-if="!topics.length" role="status">
          No guides match your search. Try a shorter phrase.
        </p>
        <section v-for="topic in topics" :key="topic.id">
          <h2>{{ topic.title }}</h2>
          <p v-for="paragraph in topic.paragraphs" :key="paragraph">{{ paragraph }}</p>
          <RouterLink :to="guideLink(topic.id)">Link to this guide ↗</RouterLink>
        </section>
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
