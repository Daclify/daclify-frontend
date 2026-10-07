<script setup lang="ts">
import DaoBrandingPanel from '../components/DaoBrandingPanel.vue';
import ContentPanel from '../components/ContentPanel.vue';
import ModulesPanel from '../components/ModulesPanel.vue';
import TreasuryPanel from '../components/TreasuryPanel.vue';
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { formatUnits, DaoPresets } from '@daclify/core-protocol';
import GovernancePanel from '../components/GovernancePanel.vue';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { useWorkspace } from '../state/workspace';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import ActionSigner from '../components/ActionSigner.vue';
const signerReady = computed(() => canSignMember(membership.value));
import { api, friendlyError } from '../api/client';
const route = useRoute();
const state = useWorkspace();
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
    (m) => dao.value && JSON.stringify(m.dao) === JSON.stringify(dao.value.reference),
  ),
);
const panelKey = computed(() =>
  JSON.stringify([
    dao.value?.reference,
    state.account?.id,
    membership.value?.memberId,
    dao.value?.privacy,
  ]),
);
const preset = computed(() =>
  DaoPresets.find((preset) => preset.id === (dao.value?.purpose ?? 'custom')),
);
const section = computed(() =>
  typeof route.params.section === 'string' ? route.params.section : 'overview',
);
const enabledModules = ref<string[]>([]);
let tabRequest = 0;
watch(
  [panelKey, dao],
  async () => {
    const request = ++tabRequest;
    enabledModules.value = [];
    const d = dao.value;
    if (!d) return;
    try {
      const modules = await api.moduleState(d.reference.daoId, {
        ballots: 'done',
        projects: 'done',
        schedules: 'done',
        rounds: 'done',
        applications: 'done',
        joinApplications: 'done',
        elections: 'done',
        terms: 'done',
      });
      if (request === tabRequest)
        enabledModules.value = modules.modules
          .filter((module) => module.enabled || module.installed)
          .map((module) => module.deployment.id);
    } catch {
      /* The module panel explains unavailable deployments. */
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  tabRequest++;
});
const allTabs: ReadonlyArray<readonly [string, string]> = [
  ['overview', 'Overview'],
  ['decide', 'Decide'],
  ['works', 'Works'],
  ['payroll', 'Payroll'],
  ['grants-rounds', 'Grants'],
  ['treasury', 'Treasury'],
  ['documents', 'Documents'],
  ['members', 'Members'],
  ['modules', 'Modules'],
  ['settings', 'Settings'],
];
const tabs = computed(() =>
  allTabs.filter(
    ([id]) =>
      !['decide', 'works', 'payroll', 'grants-rounds'].includes(id) ||
      enabledModules.value.includes(id),
  ),
);
const error = ref('');
const busy = ref(false);
const newTitle = ref('');
watch(panelKey, () => {
  newTitle.value = '';
  error.value = '';
});
function amount(units: string) {
  return dao.value ? formatUnits(BigInt(units), dao.value.token.precision) : '0';
}
async function rename() {
  const d = dao.value;
  const m = membership.value;
  if (!d || !m) return;
  busy.value = true;
  error.value = '';
  try {
    const request = makeInstruction(
      d.reference,
      m.memberId,
      m.nonce,
      Math.floor(Date.now() / 1000) + 300,
      d.reference.contract,
      'setmeta',
      encodeAction('setmeta', {
        runtime: d.reference.contract,
        dao_id: d.reference.daoId,
        member_id: m.memberId,
        metadata: JSON.stringify({
          schemaVersion: d.branding ? 3 : d.setup ? 2 : 1,
          title: newTitle.value,
          description: d.description,
          ...(d.setup || d.branding
            ? { purpose: d.purpose ?? 'custom', setup: d.setup ?? null }
            : {}),
          ...(d.branding ? { branding: d.branding } : {}),
        }),
      }),
    );
    await relayInstruction(request);
    await state.refresh();
    newTitle.value = '';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div v-if="!dao" class="empty-state">
    <h1>{{ state.loading ? 'Loading workspace…' : 'DAO unavailable' }}</h1>
    <p>Refresh the hub or check this deployment’s connection.</p>
    <RouterLink class="button secondary" to="/">Back to hub</RouterLink>
  </div>
  <template v-else
    ><div class="page-heading">
      <div>
        <p class="eyebrow">{{ preset?.title }} WORKSPACE</p>
        <h1>{{ dao.title }}</h1>
        <p class="lead">
          {{ dao.description || 'A shared place for decisions and contributions.' }}
        </p>
      </div>
      <span class="pill">{{
        dao.privacy === 'public' ? 'Public content' : 'Encrypted content'
      }}</span>
    </div>
    <nav class="workspace-tabs" aria-label="DAO sections">
      <RouterLink
        v-for="[id, label] in tabs"
        :key="id"
        :to="`/dao/${dao.reference.daoId}/${id}`"
        :class="{ active: section === id }"
        >{{ label }}</RouterLink
      >
    </nav>
    <ActionSigner :member="membership" />
    <aside v-if="!membership?.active || !signerReady" class="notice" aria-label="Account access">
      <template v-if="!state.account"
        >Sign in to request membership or use your DAO permissions.</template
      >
      <template v-else-if="!membership"
        >You can browse this DAO. Share your public join identity with an administrator to become a
        member.
        <RouterLink :to="`/dao/${dao.reference.daoId}/members`">Join instructions</RouterLink
        >.</template
      >
      <template v-else-if="!membership.active"
        >Your membership is inactive. Existing claim and stake exits remain available in
        Treasury.</template
      >
      <template v-else
        >Choose an authorized signer for actions. Unlock your Daclify keys separately to decrypt
        private documents.</template
      >
      <RouterLink
        v-if="!state.account || (membership?.active && !signerReady)"
        :to="{ path: '/account', query: { returnTo: route.fullPath } }"
        >{{ state.account ? 'Account and keys' : 'Sign in' }}</RouterLink
      >
    </aside>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <template v-if="section === 'overview'"
      ><h2>Workspace overview</h2>
      <p v-if="dao.setup" class="lead">{{ preset?.description }}</p>
      <p v-if="dao.participantMode === 'agents-guarded'" class="notice">
        Agent members govern this DAO. Human guardians retain disclosed emergency pause and signing
        recovery powers.
      </p>
      <div class="stats-grid">
        <article class="stat-card">
          <span>Members</span><strong>{{ dao.members }}</strong
          ><small>{{
            membership && !membership.active
              ? 'Inactive member'
              : membership?.admin
                ? 'Administrator'
                : membership
                  ? 'Member'
                  : 'Visitor'
          }}</small>
        </article>
        <article class="stat-card">
          <span>Available treasury</span
          ><strong
            >{{ amount(dao.available) }} <span>{{ dao.token.symbol }}</span></strong
          ><small>{{ amount(dao.reserved) }} reserved for obligations</small>
        </article>
        <article class="stat-card">
          <span>Your governance credits</span><strong>{{ membership?.credits ?? '—' }}</strong
          ><small>Internal, nontransferable governance units</small>
        </article>
      </div>
      <div class="two-column">
        <section class="panel">
          <h3>Make decisions together</h3>
          <p>
            Decide supports member, credit, and native stake voting. Active ballots freeze eligible
            weights until closing.
          </p>
          <RouterLink class="help-link" :to="`/dao/${dao.reference.daoId}/decide`"
            >Open Decide →</RouterLink
          >
        </section>
        <section class="panel">
          <h3>Turn proposals into contributions</h3>
          <p>
            Works ties milestones to reserved funds and review. Accepted liabilities remain payable
            when modules change.
          </p>
          <RouterLink class="help-link" :to="`/dao/${dao.reference.daoId}/works`"
            >Open Works →</RouterLink
          >
        </section>
      </div></template
    >
    <TreasuryPanel
      v-else-if="section === 'treasury'"
      :key="panelKey"
      :dao="dao"
      :member="membership"
    />
    <template v-else-if="section === 'settings'"
      ><h2>DAO settings</h2>
      <DaoBrandingPanel :key="panelKey" :dao="dao" :member="membership" @updated="state.refresh" />
      <section class="panel narrow">
        <h3>Public identity</h3>
        <form v-if="membership?.active && membership.admin" @submit.prevent="rename">
          <label for="rename">New DAO name</label
          ><input id="rename" v-model="newTitle" maxlength="160" required /><button
            :disabled="busy || !signerReady"
          >
            {{ busy ? 'Submitting…' : 'Sign and update name' }}
          </button>
          <p v-if="!signerReady" class="field-help">
            Choose an authorized signer to sign this update.
          </p>
        </form>
        <p v-else>Administrator permission is required to update this DAO.</p>
        <dl>
          <dt>Runtime</dt>
          <dd class="mono">{{ dao.reference.contract }}</dd>
          <dt>DAO ID</dt>
          <dd class="mono wrap">{{ dao.reference.daoId }}</dd>
          <dt>Interface</dt>
          <dd>{{ dao.reference.interfaceVersion }}</dd>
          <dt>Encryption epoch</dt>
          <dd>{{ dao.keyEpoch }}</dd>
        </dl>
      </section>
      <GovernancePanel :key="panelKey" :dao="dao" :member="membership" />
    </template>
    <ContentPanel
      v-else-if="['documents', 'members'].includes(section)"
      :key="panelKey"
      :dao="dao"
      :member="membership"
      :section="section"
    /><ModulesPanel
      v-else-if="['modules', 'decide', 'works', 'payroll', 'grants-rounds'].includes(section)"
      :key="panelKey"
      :dao="dao"
      :member="membership"
      :section="section"
    /><template v-else
      ><div class="section-toolbar">
        <h2>{{ tabs.find((t) => t[0] === section)?.[1] ?? 'Workspace' }}</h2>
        <RouterLink class="help-link" :to="`/docs/${section}`"
          >How {{ section }} works ↗</RouterLink
        >
      </div>
      <section class="panel">
        <h3>
          {{
            section === 'documents'
              ? 'Versioned content'
              : section === 'members'
                ? 'Members and permissions'
                : section === 'modules'
                  ? 'Configure only what you need'
                  : 'Module workspace'
          }}
        </h3>
        <p v-if="section === 'documents'">
          Small public JSON lives in contract tables. Larger content uses verified IPFS references.
          Private documents are encrypted before upload.
        </p>
        <p v-else-if="section === 'members'">
          Internal, native, and managed identities use one member record per DAO. Admission and role
          changes require DAO authorization.
        </p>
        <p v-else-if="section === 'modules'">
          Core governance stays free. Optional Operations features can add integrations, automation,
          and resource capacity.
        </p>
        <p v-else>
          Connect the DAO’s version-compatible module to open its actions and configuration.
        </p>
        <p class="notice">
          This view is being connected to the module API. Check the documentation for contract
          actions and supported capabilities.
        </p>
        <RouterLink class="button secondary" :to="`/docs/${section}`">Open the guide</RouterLink>
      </section></template
    >
    <aside class="deployment-note" aria-label="DAO deployment">
      <span class="mono">{{ dao.reference.contract }} / {{ dao.reference.daoId }}</span
      ><span
        >Core interface {{ dao.reference.interfaceVersion }} ·
        {{ state.network?.environment }} network</span
      >
    </aside></template
  >
</template>
