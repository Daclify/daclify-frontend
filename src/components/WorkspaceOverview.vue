<script setup lang="ts">
import { computed } from 'vue';
import {
  ArrowUpRight,
  BookOpen,
  CircleAlert,
  HandCoins,
  ListChecks,
  RefreshCw,
  Users,
  Vote,
  Wallet,
} from '@lucide/vue';
import { formatUnits, type DaoSummary, type UserMembership } from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  modules: ModuleState['modules'];
  loading: boolean;
  error: string;
}>();
defineEmits<{ retry: [] }>();
const tools = [
  {
    id: 'decide',
    name: 'Decide',
    description: 'Read proposals, follow ballots and take part in decisions.',
    icon: Vote,
  },
  {
    id: 'works',
    name: 'Works',
    description: 'Find projects, contribute work and review milestones.',
    icon: ListChecks,
  },
  {
    id: 'payroll',
    name: 'Payroll',
    description: 'Follow scheduled payments and their settlement status.',
    icon: Wallet,
  },
  {
    id: 'grants-rounds',
    name: 'Grants',
    description: 'Explore funding rounds, applications and awards.',
    icon: HandCoins,
  },
] as const;
const installedTools = computed(() =>
  tools.flatMap((tool) => {
    const status = props.modules.find(
      (m) => m.deployment.id === tool.id && (m.enabled || m.installed),
    );
    return status ? [{ ...tool, status }] : [];
  }),
);
function amount(units: string) {
  return formatUnits(BigInt(units), props.dao.token.precision);
}
const hasFunds = computed(
  () => props.member && (BigInt(props.member.claim) > 0n || BigInt(props.member.stake) > 0n),
);
</script>
<template>
  <section class="workspace-overview" aria-labelledby="overview-title">
    <div class="overview-title">
      <h2 id="overview-title">Workspace overview</h2>
      <p>People, shared resources and your next steps.</p>
    </div>
    <p v-if="dao.participantMode === 'agents-guarded'" class="notice">
      Agent members govern this DAO. Human guardians retain disclosed emergency pause and signing
      recovery powers.
    </p>
    <div class="overview-metrics">
      <RouterLink :to="`/dao/${dao.reference.daoId}/members`" class="overview-metric"
        ><span><Users aria-hidden="true" />Members</span
        ><strong>{{ dao.members.toLocaleString() }}</strong
        ><span class="metric-detail">Meet the community <ArrowUpRight aria-hidden="true" /></span
      ></RouterLink>
      <RouterLink :to="`/dao/${dao.reference.daoId}/treasury`" class="overview-metric"
        ><span><Wallet aria-hidden="true" />Available treasury</span
        ><strong
          >{{ amount(dao.available) }} <small>{{ dao.token.symbol }}</small></strong
        ><span class="metric-detail"
          >{{ amount(dao.reserved) }} {{ dao.token.symbol }} reserved for obligations</span
        ></RouterLink
      >
      <div v-if="member" class="overview-metric">
        <span>Your governance credits</span><strong>{{ member.credits }}</strong
        ><span class="metric-detail">Governance units, not withdrawable funds</span>
      </div>
    </div>
    <aside v-if="hasFunds && member?.active" class="overview-funds">
      <Wallet aria-hidden="true" />
      <div>
        <strong>Your funds</strong>
        <p>
          {{ amount(member.claim) }} {{ dao.token.symbol }} in claims · {{ amount(member.stake) }}
          {{ dao.token.symbol }} staked
        </p>
      </div>
      <RouterLink :to="`/dao/${dao.reference.daoId}/treasury`"
        >Your funds in Treasury <ArrowUpRight aria-hidden="true"
      /></RouterLink>
    </aside>
    <div class="overview-tools-heading">
      <h2>Get involved</h2>
      <RouterLink :to="`/dao/${dao.reference.daoId}/modules`"
        >View DAO modules <ArrowUpRight aria-hidden="true"
      /></RouterLink>
    </div>
    <div v-if="error" class="overview-module-notice" role="alert">
      <CircleAlert aria-hidden="true" />
      <div>
        <strong>DAO tools could not be loaded</strong>
        <p>You can still open Documents, Members and Treasury. {{ error }}</p>
      </div>
      <button class="secondary" :disabled="loading" @click="$emit('retry')">
        <RefreshCw aria-hidden="true" />{{ loading ? 'Retrying…' : 'Retry DAO tools' }}
      </button>
    </div>
    <p v-else-if="loading" class="muted" role="status">Checking available DAO tools…</p>
    <ul class="overview-actions" aria-label="Everyday DAO destinations">
      <li v-for="tool in installedTools" :key="tool.id">
        <RouterLink :to="`/dao/${dao.reference.daoId}/${tool.id}`" class="overview-action"
          ><span class="overview-action-icon"
            ><component :is="tool.icon" aria-hidden="true"
          /></span>
          <div>
            <h3>{{ tool.name }}</h3>
            <p>{{ tool.description }}</p>
            <p v-if="!tool.status.enabled" class="action-state">Paused · view existing work</p>
            <p
              v-else-if="!tool.status.compatible || !tool.status.codeVerified"
              class="action-state"
            >
              Deployment review needed before new actions
            </p>
            <span class="overview-action-link"
              >Open {{ tool.name }} <ArrowUpRight aria-hidden="true"
            /></span></div
        ></RouterLink>
      </li>
      <li>
        <RouterLink :to="`/dao/${dao.reference.daoId}/documents`" class="overview-action"
          ><span class="overview-action-icon"><BookOpen aria-hidden="true" /></span>
          <div>
            <h3>Documents</h3>
            <p>
              {{
                dao.privacy === 'public'
                  ? 'Read shared information and find the files your community uses.'
                  : 'Find encrypted documents. Reading protected content requires your granted decryption keys.'
              }}
            </p>
            <span class="overview-action-link"
              >Open Documents <ArrowUpRight aria-hidden="true"
            /></span></div
        ></RouterLink>
      </li>
      <li>
        <RouterLink :to="`/dao/${dao.reference.daoId}/members`" class="overview-action"
          ><span class="overview-action-icon"><Users aria-hidden="true" /></span>
          <div>
            <h3>Members</h3>
            <p>Meet the people here, explore their profiles and find membership instructions.</p>
            <span class="overview-action-link"
              >Open Members <ArrowUpRight aria-hidden="true"
            /></span></div
        ></RouterLink>
      </li>
    </ul>
    <p v-if="!loading && !error && !installedTools.length" class="overview-empty-tools">
      This DAO has no Decide, Works, Payroll or Grants tools installed. Its documents, members and
      treasury are available above.
    </p>
    <p class="overview-permissions">
      Your membership, voting eligibility and permissions determine which actions you can take. The
      DAO checks them when you submit.
    </p>
  </section>
</template>
<style scoped>
.workspace-overview {
  display: grid;
  gap: 24px;
}
.overview-title h2,
.overview-tools-heading h2 {
  font-size: 1.25rem;
  margin: 0;
}
.overview-title p {
  margin: 6px 0 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}
.overview-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  gap: 16px;
}
.overview-metric {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  padding: 20px;
  min-width: 0;
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
a.overview-metric:hover {
  text-decoration: none;
  border-color: var(--border-warm);
}
.overview-metric > span {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.overview-metric svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.overview-metric strong {
  font-size: 1.75rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.overview-metric strong small {
  font-size: 0.875rem;
}
.overview-metric > .metric-detail {
  font-size: 0.8125rem;
  color: var(--text-muted);
}
.overview-tools-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.overview-tools-heading a,
.overview-funds a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
}
.overview-tools-heading svg,
.overview-funds a svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.overview-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
  gap: 16px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.overview-actions li {
  display: flex;
  min-width: 0;
}
.overview-action {
  display: flex;
  width: 100%;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  color: var(--text-primary);
}
.overview-action:hover {
  text-decoration: none;
  border-color: var(--border-warm);
  background: var(--surface-soft);
}
.overview-action > div {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.overview-action-icon {
  width: 40px;
  height: 40px;
  flex: none;
  display: grid;
  place-items: center;
  color: var(--accent-amber);
  background: var(--accent-soft);
  border-radius: var(--radius-md);
}
.overview-action-icon svg {
  width: 22px;
  height: 22px;
}
.overview-action h3 {
  font-size: 1rem;
  margin: 0 0 8px;
}
.overview-action p {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 16px;
}
.overview-action .action-state {
  font-size: 0.8125rem;
  color: var(--accent-amber);
}
.overview-action-link {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: auto;
  font-size: 0.875rem;
  font-weight: 650;
  color: var(--accent-amber);
}
.overview-action-link svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.overview-funds,
.overview-module-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-warm);
  background: var(--accent-soft);
  border-radius: var(--radius-md);
}
.overview-funds > svg,
.overview-module-notice > svg {
  width: 20px;
  height: 20px;
  flex: none;
  color: var(--accent-amber);
}
.overview-funds > div,
.overview-module-notice > div {
  flex: 1;
  min-width: min(100%, 12rem);
}
.overview-funds strong,
.overview-module-notice strong {
  font-size: 0.875rem;
}
.overview-funds p,
.overview-module-notice p {
  margin: 4px 0 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.overview-empty-tools,
.overview-permissions {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}
</style>
