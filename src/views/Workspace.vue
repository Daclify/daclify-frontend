<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, ArrowUpRight, KeyRound, ShieldCheck } from '@lucide/vue';
import { DaoPresets, daoPaymentKey, type DaoRef } from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
import { api, friendlyError } from '../api/client';
import { canSignMember } from '../auth/action-signer';
import { useWorkspace } from '../state/workspace';
import ActionSigner from '../components/ActionSigner.vue';
import ContentPanel from '../components/ContentPanel.vue';
import ModulesPanel from '../components/ModulesPanel.vue';
import TreasuryPanel from '../components/TreasuryPanel.vue';
import WorkspaceOverview from '../components/WorkspaceOverview.vue';
import DaoSettings from '../components/DaoSettings.vue';
import PlatformDao from './PlatformDao.vue';
const route = useRoute(),
  state = useWorkspace();
const dao = computed(() =>
  state.daos.find(
    (d) =>
      d.reference.daoId === route.params.id &&
      d.reference.chainId === state.network?.chainId &&
      d.reference.contract === state.network.runtime,
  ),
);
const membership = computed(() =>
  state.memberships.find(
    (m) => dao.value && daoPaymentKey(m.dao) === daoPaymentKey(dao.value.reference),
  ),
);
const signerReady = computed(() => canSignMember(membership.value));
const role = computed(() =>
  !membership.value
    ? 'Visitor'
    : !membership.value.active
      ? 'Inactive member'
      : membership.value.admin
        ? 'Administrator'
        : membership.value.reviewer
          ? 'Reviewer'
          : 'Member',
);
const panelKey = computed(() =>
  JSON.stringify([
    dao.value?.reference,
    state.account?.id,
    membership.value?.memberId,
    membership.value?.active,
    membership.value?.admin,
    dao.value?.privacy,
  ]),
);
const preset = computed(() =>
  DaoPresets.find((preset) => preset.id === (dao.value?.purpose ?? 'custom')),
);
const platformDao = ref<DaoRef>();
let platformRequest = 0;
watch(
  () => JSON.stringify([state.network?.chainId, state.network?.runtime]),
  async () => {
    const request = ++platformRequest;
    platformDao.value = undefined;
    try {
      const status = await api.platformStatus();
      if (request === platformRequest && status.chain?.chainMatches)
        platformDao.value = status.chain.platformDao ?? undefined;
    } catch {
      /* Ordinary DAO work does not depend on platform administration availability. */
    }
  },
  { immediate: true },
);
const isPlatform = computed(
  () =>
    !!dao.value &&
    !!platformDao.value &&
    daoPaymentKey(dao.value.reference) === daoPaymentKey(platformDao.value),
);
const section = computed(() =>
  typeof route.params.section === 'string' ? route.params.section : 'overview',
);
const modules = ref<ModuleState['modules']>([]),
  modulesLoading = ref(false),
  modulesError = ref('');
let tabRequest = 0;
async function loadModules() {
  const request = ++tabRequest,
    d = dao.value;
  if (!d) return;
  modulesLoading.value = true;
  modulesError.value = '';
  try {
    const result = await api.moduleState(d.reference.daoId, {
      ballots: 'done',
      projects: 'done',
      schedules: 'done',
      rounds: 'done',
      applications: 'done',
      joinApplications: 'done',
      elections: 'done',
      terms: 'done',
    });
    if (request !== tabRequest) return;
    if (daoPaymentKey(result.dao) !== daoPaymentKey(d.reference)) throw new Error('DAO_REFERENCE');
    modules.value = result.modules;
  } catch (cause) {
    if (request === tabRequest) modulesError.value = friendlyError(cause);
  } finally {
    if (request === tabRequest) modulesLoading.value = false;
  }
}
watch(
  [panelKey, dao],
  () => {
    tabRequest++;
    modules.value = [];
    modulesError.value = '';
    modulesLoading.value = false;
    void loadModules();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  tabRequest++;
  platformRequest++;
});
const workTabs: ReadonlyArray<readonly [string, string]> = [
  ['overview', 'Overview'],
  ['decide', 'Decide'],
  ['works', 'Works'],
  ['payroll', 'Payroll'],
  ['grants-rounds', 'Grants'],
  ['treasury', 'Treasury'],
  ['documents', 'Documents'],
  ['members', 'Members'],
];
const tabs = computed(() =>
  workTabs.filter(
    ([id]) =>
      !['decide', 'works', 'payroll', 'grants-rounds'].includes(id) ||
      modules.value.some(
        (module) => module.deployment.id === id && (module.enabled || module.installed),
      ),
  ),
);
const setupTabs = computed<ReadonlyArray<readonly [string, string]>>(() => [
  ['modules', 'Modules'],
  ['settings', 'Settings'],
  ...(isPlatform.value ? ([['platform', 'Platform controls']] as const) : []),
]);
</script>
<template>
  <div v-if="!dao" class="empty-state">
    <h1>{{ state.loading ? 'Loading workspace…' : 'DAO unavailable' }}</h1>
    <p>Refresh the Hub or check this deployment’s connection.</p>
    <RouterLink class="button secondary" to="/hub">Back to hub</RouterLink>
  </div>
  <div v-else class="workspace-page">
    <header class="workspace-heading">
      <RouterLink class="workspace-back" to="/hub"
        ><ArrowLeft aria-hidden="true" /> All DAOs</RouterLink
      >
      <div class="workspace-identity">
        <div>
          <p class="eyebrow">{{ preset?.title }} WORKSPACE</p>
          <h1>{{ dao.title }}</h1>
          <p class="lead">
            {{ dao.description || 'A shared place for decisions and contributions.' }}
          </p>
        </div>
        <div class="workspace-badges">
          <span class="pill">{{
            dao.privacy === 'public' ? 'Public documents' : 'Encrypted documents'
          }}</span
          ><span class="pill">{{ role }}</span>
        </div>
      </div>
    </header>
    <div class="workspace-navigation">
      <nav class="workspace-destinations" aria-label="DAO sections">
        <div>
          <span class="workspace-nav-label">Workspace</span>
          <div class="workspace-links">
            <RouterLink
              v-for="[id, label] in tabs"
              :key="id"
              :to="`/dao/${dao.reference.daoId}/${id}`"
              :class="{ active: section === id }"
              :aria-current="section === id ? 'page' : undefined"
              >{{ label }}</RouterLink
            >
          </div>
        </div>
        <div>
          <span class="workspace-nav-label">DAO setup</span>
          <div class="workspace-links workspace-setup-links">
            <RouterLink
              v-for="[id, label] in setupTabs"
              :key="id"
              :to="`/dao/${dao.reference.daoId}/${id}`"
              :class="{ active: section === id }"
              :aria-current="section === id ? 'page' : undefined"
              >{{ label }}</RouterLink
            >
          </div>
        </div>
      </nav>
    </div>
    <aside
      v-if="!membership?.active || !signerReady"
      class="workspace-access"
      aria-label="Account access"
    >
      <ShieldCheck aria-hidden="true" />
      <div>
        <p v-if="!state.account">
          You’re visiting this DAO. Sign in to request membership or use your existing permissions.
        </p>
        <p v-else-if="!membership">
          You’re signed in, but you’re not a member of this DAO. The Members section explains how to
          join.
        </p>
        <p v-else-if="!membership.active">
          Your membership is inactive. Your existing claim and stake exits remain available in
          Treasury.
        </p>
        <p v-else>
          Choose an authorized signer before taking action. Unlock Daclify keys separately to read
          encrypted documents.
        </p>
      </div>
      <RouterLink
        v-if="!state.account"
        class="button secondary"
        :to="{ path: '/account', query: { returnTo: route.fullPath } }"
        >Sign in</RouterLink
      >
      <RouterLink
        v-else-if="!membership"
        class="button secondary"
        :to="`/dao/${dao.reference.daoId}/members`"
        >Join instructions</RouterLink
      >
      <RouterLink
        v-else-if="!membership.active"
        class="button secondary"
        :to="`/dao/${dao.reference.daoId}/treasury`"
        >Your funds in Treasury</RouterLink
      >
    </aside>
    <details v-if="membership" class="workspace-signing" :open="membership.active && !signerReady">
      <summary>
        <KeyRound aria-hidden="true" /><span>Signing &amp; wallets</span
        ><span class="workspace-signing-state">{{
          signerReady ? 'Signer ready' : 'Choose a signer'
        }}</span>
      </summary>
      <ActionSigner :key="panelKey" :member="membership" />
    </details>
    <WorkspaceOverview
      v-if="section === 'overview'"
      :dao="dao"
      :member="membership"
      :modules="modules"
      :loading="modulesLoading"
      :error="modulesError"
      @retry="loadModules"
    />
    <TreasuryPanel
      v-else-if="section === 'treasury'"
      :key="panelKey"
      :dao="dao"
      :member="membership"
    />
    <DaoSettings
      v-else-if="section === 'settings'"
      :key="panelKey"
      :dao="dao"
      :member="membership"
      @updated="state.refresh"
    />
    <PlatformDao v-else-if="section === 'platform' && isPlatform" :key="panelKey" />
    <ContentPanel
      v-else-if="['documents', 'members'].includes(section)"
      :key="panelKey"
      :dao="dao"
      :member="membership"
      :section="section"
    />
    <ModulesPanel
      v-else-if="['modules', 'decide', 'works', 'payroll', 'grants-rounds'].includes(section)"
      :key="panelKey"
      :dao="dao"
      :member="membership"
      :section="section"
    />
    <section v-else class="empty-state">
      <h2>Section unavailable</h2>
      <p>
        This section isn’t available for this DAO. Return to its overview or review its configured
        modules.
      </p>
      <div class="button-row">
        <RouterLink class="button secondary" :to="`/dao/${dao.reference.daoId}/overview`"
          >Workspace overview</RouterLink
        ><RouterLink class="button secondary" :to="`/dao/${dao.reference.daoId}/modules`"
          >View DAO modules</RouterLink
        >
      </div>
    </section>
    <details class="workspace-reference">
      <summary>
        Network &amp; DAO reference<span
          >{{ state.network?.environment }} · {{ dao.reference.contract }} /
          {{ dao.reference.daoId }}</span
        >
      </summary>
      <dl>
        <dt>Runtime contract</dt>
        <dd class="mono">{{ dao.reference.contract }}</dd>
        <dt>DAO ID</dt>
        <dd>{{ dao.reference.daoId }}</dd>
        <dt>Core interface</dt>
        <dd>{{ dao.reference.interfaceVersion }}</dd>
        <dt>Encryption epoch</dt>
        <dd>{{ dao.keyEpoch }}</dd>
        <dt>Chain ID</dt>
        <dd class="mono wrap">{{ dao.reference.chainId }}</dd>
        <dt>Document privacy</dt>
        <dd>
          {{
            dao.privacy === 'public'
              ? 'Public documents'
              : 'Encrypted contents; memberships, balances and transaction metadata remain public.'
          }}
        </dd>
      </dl>
      <RouterLink :to="{ path: '/docs/deployments', query: { dao: dao.reference.daoId } }"
        >Deployment guide <ArrowUpRight aria-hidden="true"
      /></RouterLink>
    </details>
  </div>
</template>
<style scoped>
.workspace-page {
  display: grid;
  gap: 24px;
}
.workspace-heading {
  min-width: 0;
}
.workspace-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-bottom: 12px;
  font-size: 0.875rem;
}
.workspace-back svg {
  width: 16px;
  height: 16px;
}
.workspace-identity {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 24px;
  justify-content: space-between;
}
.workspace-identity > div:first-child {
  flex: 1;
  min-width: min(100%, 24rem);
}
.workspace-identity h1 {
  font-size: clamp(2rem, 3vw, 2.5rem);
  overflow-wrap: anywhere;
}
.workspace-identity .lead {
  max-width: 65ch;
  font-size: 1rem;
  margin-bottom: 0;
}
.workspace-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}
.workspace-badges .pill {
  font-size: 0.8125rem;
  white-space: normal;
  overflow-wrap: anywhere;
}
.workspace-navigation {
  border-block: 1px solid var(--border-default);
  padding: 16px 0;
}
.workspace-destinations {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 32px;
}
.workspace-destinations > div {
  min-width: 0;
}
.workspace-nav-label {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 650;
  margin-bottom: 8px;
}
.workspace-links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.workspace-links a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 650;
}
.workspace-links a:hover {
  background: var(--surface-soft);
  text-decoration: none;
}
.workspace-links a.active {
  color: var(--accent-amber);
  background: var(--accent-soft);
}
.workspace-setup-links a {
  border: 1px solid var(--border-default);
}
.workspace-access {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-warm);
  background: var(--accent-soft);
  border-radius: var(--radius-md);
}
.workspace-access > svg {
  width: 20px;
  height: 20px;
  flex: none;
  color: var(--accent-amber);
}
.workspace-access > div {
  flex: 1;
  min-width: 0;
}
.workspace-access p {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.workspace-access > .button {
  flex: none;
}
.workspace-signing {
  background: var(--surface-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 0 16px;
  margin: 0;
}
.workspace-signing summary {
  min-height: 52px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 0.875rem;
}
.workspace-signing summary::before {
  content: '+';
  color: var(--accent-amber);
}
.workspace-signing[open] summary::before {
  content: '−';
}
.workspace-signing summary > svg {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--accent-amber);
}
.workspace-signing-state {
  margin-left: auto;
  font-weight: 400;
  color: var(--text-muted);
}
.workspace-signing :deep(.panel) {
  max-width: 100%;
  margin: 0 0 16px;
}
.workspace-reference {
  border-top: 1px solid var(--border-default);
  margin: 8px 0 0;
  padding-top: 12px;
}
.workspace-reference summary {
  min-height: 44px;
  font-size: 0.875rem;
}
.workspace-reference summary span {
  display: inline;
  margin-left: 16px;
  font-size: 0.8125rem;
  font-weight: 400;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.workspace-reference dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px 24px;
  font-size: 0.875rem;
  padding: 16px;
  background: var(--surface-panel);
  border-radius: var(--radius-md);
}
.workspace-reference dt {
  color: var(--text-muted);
}
.workspace-reference dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.workspace-reference a {
  display: inline-flex;
  gap: 6px;
  min-height: 44px;
  align-items: center;
  font-size: 0.875rem;
}
.workspace-reference a svg {
  width: 16px;
  height: 16px;
}
@media (max-width: 700px) {
  .workspace-identity {
    flex-direction: column;
    gap: 16px;
  }
  .workspace-access {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .workspace-access > .button {
    margin-left: 36px;
  }
  .workspace-reference summary span {
    display: block;
    margin: 8px 0 0;
  }
  .workspace-reference dl {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .workspace-reference dd + dt {
    margin-top: 12px;
  }
}
</style>
