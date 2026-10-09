<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component } from 'vue';
import {
  Blocks,
  Vote,
  Handshake,
  WalletCards,
  Sprout,
  ShieldCheck,
  Search,
  ArrowUpRight,
  Plus,
  X,
  Check,
  Users,
} from '@lucide/vue';
import { ModuleCodeHashes } from '@daclify/modules/sdk';
import { daoPaymentKey } from '@daclify/core-protocol';
import ModulesPanel from '../components/ModulesPanel.vue';
import ActionSigner from '../components/ActionSigner.vue';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError } from '../api/client';

const workspace = useWorkspace();
const loadError = ref('');
const activationDialog = ref<HTMLDialogElement>();
const activationAccount = ref('');
const activationDaoId = ref('');
const activationBusy = ref(false);
const catalogue = ref<Awaited<ReturnType<typeof api.marketplace>>>();
const moduleQuery = ref('');
const partyFilter = ref<'all' | 'first-party' | 'third-party'>('all');
const selectedAccount = ref('');
const selectedOfferId = ref('');

function feeLabel(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2)}%`;
}
function usage(price: string): string {
  const amount = Number(price.split(' ')[0] ?? '');
  return amount === 0 ? 'No usage charge' : price;
}
function partyName(party: 'first-party' | 'third-party'): string {
  return party === 'first-party' ? 'Daclify' : 'Third-party';
}

interface Offering {
  id: string;
  title: string;
  summary: string;
}

const OFFERINGS: Record<string, readonly Offering[]> = {
  decide: [
    {
      id: 'member-vote',
      title: 'Member vote',
      summary: 'One vote for each active member. Weights freeze until the ballot closes.',
    },
    {
      id: 'credit-vote',
      title: 'Credit vote',
      summary:
        'Votes follow internal governance credits. Credits stay in the DAO and are not a token.',
    },
    {
      id: 'stake-vote',
      title: 'Stake vote',
      summary:
        'Votes follow native tokens deposited with the DAO. Stake changes freeze while a ballot is open.',
    },
    {
      id: 'advisory-poll',
      title: 'Advisory poll',
      summary: 'The same ballot, with no treasury payment. A passed poll does not move funds.',
    },
  ],
  works: [
    {
      id: 'milestone-work',
      title: 'Milestone work',
      summary:
        'Reserve funds for up to sixteen milestones. Someone other than the contributor reviews the work before payment.',
    },
  ],
  'grants-rounds': [
    {
      id: 'grant-round',
      title: 'Grant round',
      summary: 'Collect applications, review eligibility, and fund awards through a DAO vote.',
    },
  ],
  'endorsement-admission': [
    {
      id: 'member-endorsement',
      title: 'Member endorsement',
      summary: 'Let current members endorse applications under your DAO’s admission policy.',
    },
  ],
  payroll: [
    {
      id: 'salary',
      title: 'Salary',
      summary:
        'A funded term of up to twelve installments. Due installments stay payable after the module is turned off.',
    },
    {
      id: 'one-time',
      title: 'One-time payment',
      summary: 'One funded installment on the same schedule. It does not renew.',
    },
  ],
};

type Listing = NonNullable<typeof catalogue.value>['modules'][number];
const PRESENTATION: Record<
  string,
  { title: string; icon: Component; category: string; summary: string }
> = {
  decide: {
    title: 'Decide',
    icon: Vote,
    category: 'Governance',
    summary:
      'Turn ideas into decisions. Give your community a voice with member, credit, or stake voting.',
  },
  works: {
    title: 'Works',
    icon: Handshake,
    category: 'Collaboration',
    summary:
      'Turn decisions into delivery. Fund milestones, review contributions, and pay for accepted work.',
  },
  payroll: {
    title: 'Payroll',
    icon: WalletCards,
    category: 'Payments',
    summary:
      'Keep your team paid. Set up funded salaries and one-time payments with clear schedules.',
  },
  'grants-rounds': {
    title: 'Grants rounds',
    icon: Sprout,
    category: 'Funding',
    summary:
      'Back the next good idea. Run grant rounds from applications and review to funded awards.',
  },
  'endorsement-admission': {
    title: 'Endorsement admission',
    icon: ShieldCheck,
    category: 'Membership',
    summary:
      'Grow your community with care. Let members endorse applicants under a shared admission policy.',
  },
};
const DEFAULT_PRESENTATION = {
  icon: Blocks,
  category: 'Extension',
  summary: 'Add new capabilities to your community.',
};
function presentationId(module: Listing): string {
  const pinned = Object.entries(ModuleCodeHashes).find(([, hash]) => hash === module.codeHash)?.[0];
  // shortcut: older first-party artwork uses listing titles, replace when the catalogue publishes stable module IDs.
  return (
    pinned ??
    (module.party === 'first-party'
      ? (Object.entries(PRESENTATION).find(([, item]) => item.title === module.title)?.[0] ?? '')
      : '')
  );
}
function presentation(module: Listing) {
  return (
    PRESENTATION[presentationId(module)] ?? {
      ...DEFAULT_PRESENTATION,
      summary: module.summary || DEFAULT_PRESENTATION.summary,
    }
  );
}
const administratorDaos = computed(() =>
  workspace.account
    ? workspace.daos.filter(
        (dao) =>
          dao.reference.chainId === workspace.network?.chainId &&
          dao.reference.contract === workspace.network.runtime &&
          workspace.memberships.some(
            (member) =>
              member.active &&
              member.admin &&
              daoPaymentKey(member.dao) === daoPaymentKey(dao.reference),
          ),
      )
    : [],
);
const activationModule = computed(() =>
  catalogue.value?.modules.find((module) => module.account === activationAccount.value),
);
const activationDao = computed(() =>
  administratorDaos.value.find((dao) => dao.reference.daoId === activationDaoId.value),
);
const activationMember = computed(() =>
  workspace.memberships.find(
    (member) =>
      activationDao.value &&
      member.active &&
      member.admin &&
      daoPaymentKey(member.dao) === daoPaymentKey(activationDao.value.reference),
  ),
);
async function openActivation(account: string) {
  activationAccount.value = account;
  activationDaoId.value = administratorDaos.value[0]?.reference.daoId ?? '';
  await nextTick();
  activationDialog.value?.showModal();
}
watch(
  [() => workspace.account?.id, () => workspace.network?.chainId, () => workspace.network?.runtime],
  () => activationDialog.value?.close(),
);

const moduleFee = computed(() => {
  const fees = catalogue.value;
  if (!fees?.configured || fees.thirdPartyBps === null || fees.firstPartyBps === null) return '';
  const first =
    fees.firstPartyBps === 10000
      ? 'First-party modules keep the full usage charge.'
      : `First-party usage charges pay the platform ${feeLabel(fees.firstPartyBps)}.`;
  return `${first} Third-party usage charges pay the platform ${feeLabel(fees.thirdPartyBps)}.`;
});
const groups = computed(() => {
  const query = moduleQuery.value.trim().toLowerCase();
  return (catalogue.value?.modules ?? [])
    .filter((module) => partyFilter.value === 'all' || module.party === partyFilter.value)
    .map((module) => {
      const offerings = OFFERINGS[presentationId(module)] ?? [];
      const moduleText = [
        module.title,
        module.summary,
        module.detail,
        module.account,
        module.publisher,
        presentation(module).category,
      ]
        .join(' ')
        .toLowerCase();
      const moduleMatches = query.length === 0 || moduleText.includes(query);
      const visible = offerings.filter(
        (offer) => moduleMatches || `${offer.title} ${offer.summary}`.toLowerCase().includes(query),
      );
      return {
        module,
        visible,
        shown: offerings.length === 0 ? moduleMatches : visible.length > 0,
      };
    })
    .filter((group) => group.shown);
});
const toolCount = computed(() =>
  (catalogue.value?.modules ?? []).reduce((sum, module) => {
    const tools = OFFERINGS[presentationId(module)];
    return sum + (tools && tools.length > 0 ? tools.length : 1);
  }, 0),
);
const selected = computed(() =>
  catalogue.value?.modules.find((module) => module.account === selectedAccount.value),
);
const selectedTools = computed(() =>
  selected.value ? (OFFERINGS[presentationId(selected.value)] ?? []) : [],
);
const selectedOffering = computed(() =>
  selectedTools.value.find((offer) => offer.id === selectedOfferId.value),
);

async function load() {
  loadError.value = '';
  try {
    catalogue.value = await api.marketplace();
  } catch (error) {
    loadError.value = friendlyError(error);
  }
}
onMounted(load);

function openModule(account: string, offerId = '') {
  selectedAccount.value = account;
  selectedOfferId.value = offerId;
}

function moduleCharge(party: 'first-party' | 'third-party'): string {
  const fees = catalogue.value;
  if (!fees?.configured || fees.thirdPartyBps === null || fees.firstPartyBps === null) return '';
  const bps = party === 'first-party' ? fees.firstPartyBps : fees.thirdPartyBps;
  return bps === 10000
    ? 'Keeps the full usage charge.'
    : `Pays the platform ${feeLabel(bps)} of a usage charge.`;
}
</script>
<template>
  <section class="page modules-page">
    <header class="catalogue-heading">
      <div>
        <p class="eyebrow">Built for your community</p>
        <h1>Modules</h1>
        <p class="lede">A few good tools. A lot more you can do together.</p>
      </div>
      <RouterLink class="button secondary" to="/docs/modules"
        >Explore the guide <ArrowUpRight aria-hidden="true"
      /></RouterLink>
    </header>
    <p v-if="loadError" class="alert" role="alert">
      {{ loadError }} <button class="text-button" @click="load">Try again</button>
    </p>
    <p v-else-if="!catalogue" class="notice" role="status">Loading the module library…</p>
    <p v-else-if="!catalogue.configured" class="notice">{{ catalogue.reason }}</p>
    <template v-else>
      <article v-if="selected" class="panel module-detail">
        <div class="section-toolbar">
          <button
            type="button"
            class="text-button"
            @click="
              selectedAccount = '';
              selectedOfferId = '';
            "
          >
            Back to modules
          </button>
          <button
            type="button"
            :disabled="workspace.loading"
            :aria-label="`Activate ${selected.title}`"
            @click="openActivation(selected.account)"
          >
            <Plus aria-hidden="true" /> Activate on a DAO
          </button>
        </div>
        <p class="eyebrow">
          {{ presentation(selected).category }} · {{ partyName(selected.party) }}
        </p>
        <h2>{{ selectedOffering?.title ?? selected.title }}</h2>
        <p>{{ selectedOffering?.summary ?? presentation(selected).summary }}</p>
        <p v-if="selected.summary">{{ selected.summary }}</p>
        <p v-if="selected.detail" class="module-detail-copy">{{ selected.detail }}</p>
        <h3 v-if="selectedTools.length">Tools in this module</h3>
        <div v-if="selectedTools.length" class="module-grid">
          <button
            v-for="offer in selectedTools"
            :key="offer.id"
            type="button"
            class="module-card"
            :aria-current="offer.id === selectedOfferId ? 'true' : undefined"
            @click="selectedOfferId = offer.id"
          >
            <strong>{{ offer.title }}</strong
            ><small>{{ offer.summary }}</small>
          </button>
        </div>
        <dl class="detail-list">
          <dt>Account</dt>
          <dd class="mono">{{ selected.account }}</dd>
          <dt>Publisher</dt>
          <dd class="mono">{{ selected.publisher }}</dd>
          <dt>Party</dt>
          <dd>{{ partyName(selected.party) }}</dd>
          <dt>Usage price</dt>
          <dd>{{ usage(selected.price) }}</dd>
          <dt>Platform fee</dt>
          <dd>{{ moduleCharge(selected.party) }}</dd>
          <dt>Fee rule</dt>
          <dd>Accepted. A DAO activates this contract once, and every tool above comes with it.</dd>
          <dt>Code hash</dt>
          <dd class="mono">{{ selected.codeHash }}</dd>
        </dl>
      </article>
      <template v-else>
        <div class="catalogue-toolbar">
          <label class="catalogue-search"
            >Find a module
            <span
              ><Search aria-hidden="true" /><input
                v-model="moduleQuery"
                type="search"
                name="module-query"
                placeholder="Search tools, ideas, possibilities…"
            /></span>
          </label>
          <div class="catalogue-publisher">
            <label for="module-party">Publisher</label>
            <select id="module-party" v-model="partyFilter" name="module-party">
              <option value="all">All modules</option>
              <option value="first-party">Daclify</option>
              <option value="third-party">Third-party</option>
            </select>
          </div>
          <p class="catalogue-count">
            {{ catalogue.modules.length }} modules <span aria-hidden="true">/</span>
            {{ toolCount }} tools
          </p>
        </div>
        <p v-if="!groups.length" class="notice">
          No modules match this filter. Try a different search.
        </p>
        <div class="catalogue-grid">
          <article
            v-for="group in groups"
            :key="group.module.account"
            class="catalogue-card"
            :data-module="presentationId(group.module)"
          >
            <div class="module-artwork" aria-hidden="true">
              <svg viewBox="0 0 280 100" fill="none">
                <path d="M22 80L90 18L162 80L246 18M22 18L90 80L162 18L246 80" />
                <circle cx="90" cy="50" r="36" />
                <circle cx="90" cy="50" r="49" />
                <rect x="183" y="24" width="62" height="48" rx="12" />
                <path d="M197 39h28M197 49h20M197 59h24" />
              </svg>
              <span class="artwork-icon"><component :is="presentation(group.module).icon" /></span>
              <span class="artwork-check"><Check /></span
              ><span class="artwork-people"><Users /></span>
            </div>
            <div class="catalogue-card-body">
              <p class="module-category">{{ presentation(group.module).category }}</p>
              <h2>
                <button type="button" class="text-button" @click="openModule(group.module.account)">
                  {{ group.module.title }}
                </button>
              </h2>
              <p class="module-summary">{{ presentation(group.module).summary }}</p>
            </div>
            <footer class="catalogue-card-footer">
              <span class="module-price">{{ usage(group.module.price) }}</span>
              <div class="module-actions">
                <button
                  type="button"
                  class="secondary"
                  :aria-label="`View ${group.module.title} details`"
                  @click="openModule(group.module.account)"
                >
                  Details <ArrowUpRight aria-hidden="true" />
                </button>
                <button
                  type="button"
                  :disabled="workspace.loading"
                  :aria-label="`Activate ${group.module.title}`"
                  @click="openActivation(group.module.account)"
                >
                  <Plus aria-hidden="true" /> Activate
                </button>
              </div>
            </footer>
          </article>
        </div>
        <div class="catalogue-note">
          <ShieldCheck aria-hidden="true" />
          <p>
            Choose a DAO, review permissions, then sign to activate. Your existing governance stays
            in place.
          </p>
        </div>
      </template>
      <details class="catalogue-fees">
        <summary>Usage fees &amp; what’s included</summary>
        <p>{{ moduleFee }}</p>
        <p>
          Treasury, members, and documents belong to every DAO. Module prices and fee rates are read
          from the chain.
        </p>
      </details>
    </template>
  </section>
  <dialog
    ref="activationDialog"
    class="panel activation-dialog"
    aria-labelledby="activation-title"
    @close="
      activationAccount = '';
      activationBusy = false;
    "
    @cancel="activationBusy && $event.preventDefault()"
  >
    <div class="activation-heading">
      <div>
        <p class="eyebrow">Make it part of your DAO</p>
        <h2 id="activation-title">Activate {{ activationModule?.title }}</h2>
      </div>
      <button
        type="button"
        class="secondary icon-button"
        aria-label="Close activation"
        :disabled="activationBusy"
        @click="activationDialog?.close()"
      >
        <X aria-hidden="true" />
      </button>
    </div>
    <p v-if="workspace.loading && !workspace.account" role="status">Loading your account…</p>
    <template v-else-if="!workspace.account"
      ><p>Sign in to choose a DAO you administer.</p>
      <RouterLink class="button" :to="{ path: '/account', query: { returnTo: '/modules' } }"
        >Sign in</RouterLink
      ></template
    >
    <template v-else-if="!administratorDaos.length"
      ><p>
        Activation needs an active administrator membership. You don’t currently administer a DAO on
        this deployment.
      </p>
      <RouterLink class="button secondary" to="/create"
        >Create a DAO <Plus aria-hidden="true" /></RouterLink
    ></template>
    <template v-else>
      <div class="activation-picker">
        <label for="activation-dao">Choose a DAO</label>
        <select id="activation-dao" v-model="activationDaoId" :disabled="activationBusy">
          <option
            v-for="dao in administratorDaos"
            :key="daoPaymentKey(dao.reference)"
            :value="dao.reference.daoId"
          >
            {{ dao.title }}
          </option>
        </select>
      </div>
      <template v-if="activationDao && activationModule">
        <ActionSigner :key="daoPaymentKey(activationDao.reference)" :member="activationMember" />
        <ModulesPanel
          :key="daoPaymentKey(activationDao.reference) + ':' + activationModule.account"
          :dao="activationDao"
          :member="activationMember"
          section="modules"
          :focus-account="activationModule.account"
          @busy="activationBusy = $event"
        />
        <RouterLink class="help-link" :to="`/dao/${activationDao.reference.daoId}/modules`"
          >Open DAO module settings <ArrowUpRight aria-hidden="true"
        /></RouterLink>
      </template>
    </template>
  </dialog>
</template>
<style scoped>
.catalogue-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  margin-bottom: 28px;
}
.catalogue-heading h1 {
  font-size: clamp(36px, 4vw, 52px);
  letter-spacing: -2px;
  margin-bottom: 10px;
}
.catalogue-heading .lede {
  margin-bottom: 0;
  color: var(--text-muted);
}
.catalogue-toolbar {
  display: flex;
  align-items: end;
  gap: 16px;
  margin: 0 0 24px;
}
.catalogue-search {
  flex: 1;
}
.catalogue-search > span {
  position: relative;
  display: block;
}
.catalogue-search svg {
  position: absolute;
  width: 18px;
  height: 18px;
  left: 15px;
  top: 15px;
  color: var(--text-muted);
}
.catalogue-search input {
  padding-left: 44px;
}
.catalogue-publisher {
  width: 170px;
}
.catalogue-count {
  white-space: nowrap;
  font-size: 13px;
  margin: 0 0 15px;
  color: var(--text-muted);
}
.catalogue-count span {
  margin: 0 6px;
  opacity: 0.5;
}
.catalogue-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr));
  gap: 20px;
}
.catalogue-card {
  --module-accent: var(--accent-amber);
  --module-tint: var(--accent-soft);
  position: relative;
  display: flex;
  flex-direction: column;
  aspect-ratio: 1;
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--border-default);
  border-radius: 22px;
  background: linear-gradient(155deg, var(--surface-soft), transparent 60%), var(--surface-panel);
  box-shadow: var(--elevation-panel);
  overflow: hidden;
  transition:
    border-color var(--motion-fast),
    transform var(--motion-fast);
}
.catalogue-card[data-module='works'] {
  --module-accent: var(--state-success);
  --module-tint: var(--state-success-bg);
}
.catalogue-card[data-module='payroll'] {
  --module-accent: var(--accent-amber-strong);
}
.catalogue-card[data-module='grants-rounds'] {
  --module-accent: var(--state-danger);
  --module-tint: var(--state-danger-bg);
}
.catalogue-card[data-module='endorsement-admission'] {
  --module-accent: var(--text-secondary);
  --module-tint: var(--surface-soft);
}
.catalogue-card:hover {
  border-color: var(--module-accent);
  transform: translateY(-3px);
}
.module-artwork {
  position: relative;
  height: 92px;
  min-height: 60px;
  flex: 1;
  margin: -8px -6px 10px;
  color: var(--module-accent);
  background: radial-gradient(ellipse at 35% 50%, var(--module-tint), transparent 70%);
}
.module-artwork > svg {
  width: 100%;
  height: 100%;
  opacity: 0.24;
  stroke: currentColor;
  stroke-width: 1;
}
.artwork-icon {
  position: absolute;
  width: 62px;
  height: 62px;
  top: 50%;
  left: 18%;
  transform: translateY(-50%) rotate(-8deg);
  display: grid;
  place-items: center;
  border: 1px solid var(--module-accent);
  border-radius: 18px;
  background: var(--surface-raised);
  box-shadow:
    0 8px 20px var(--module-tint),
    inset 0 1px 0 var(--surface-soft);
}
.artwork-icon svg {
  width: 29px;
  height: 29px;
  stroke-width: 1.5;
}
.artwork-check,
.artwork-people {
  position: absolute;
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 9px;
  background: var(--surface-raised);
  border: 1px solid var(--border-default);
}
.artwork-check {
  left: 46%;
  top: 6%;
  transform: rotate(10deg);
}
.artwork-people {
  right: 15%;
  bottom: 0;
  transform: rotate(-8deg);
}
.artwork-check svg,
.artwork-people svg {
  width: 15px;
  height: 15px;
}
.module-category {
  margin: 0 0 3px;
  color: var(--module-accent);
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.8px;
}
.catalogue-card h2 {
  margin: 0 0 8px;
}
.catalogue-card h2 button {
  color: var(--text-primary);
  font-size: 23px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.7px;
  min-height: 0;
  padding: 0;
}
.module-summary {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.catalogue-card-footer {
  margin-top: 16px;
}
.module-price {
  font-size: 11px;
  color: var(--text-secondary);
  display: block;
  margin-bottom: 10px;
}
.module-actions {
  display: flex;
  gap: 8px;
}
.module-actions button {
  flex: 1;
  padding: 9px 10px;
  font-size: 12px;
}
.module-actions .secondary {
  border-color: var(--border-default);
  background: var(--surface-soft);
}
.module-actions button svg {
  width: 15px;
  height: 15px;
}
.catalogue-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 26px 0 12px;
  color: var(--text-muted);
}
.catalogue-note svg {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--state-success);
}
.catalogue-note p {
  margin: 0;
  font-size: 12px;
}
.catalogue-fees {
  color: var(--text-muted);
  font-size: 13px;
}
.catalogue-fees summary {
  min-height: 44px;
  display: list-item;
  align-content: center;
  cursor: pointer;
  width: fit-content;
}
.activation-dialog {
  width: min(620px, calc(100% - 32px));
  max-height: calc(100dvh - 48px);
  padding: 28px;
  border: 1px solid var(--border-warm);
  background: var(--color-bg-base);
  border-radius: 22px;
}
.activation-dialog::backdrop {
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
}
.activation-heading {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
  margin-bottom: 20px;
}
.activation-heading h2 {
  margin: 0;
}
.activation-heading .eyebrow {
  margin-bottom: 8px;
}
.icon-button {
  width: 44px;
  height: 44px;
  padding: 10px;
  flex: none;
}
.activation-picker {
  display: block;
  margin: 0 0 16px;
}
.activation-dialog :deep(.dao-grid) {
  display: block;
}
.activation-dialog :deep(.module-card) {
  margin: 12px 0;
}
.activation-dialog :deep(.module-card > p) {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
}
.activation-dialog :deep(.module-card dl) {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 6px 10px;
  margin: 6px 0;
  font-size: 12px;
}
.activation-dialog :deep(.section-toolbar) {
  margin-bottom: 8px;
}
@media (max-width: 700px) {
  .catalogue-heading {
    align-items: start;
    flex-direction: column;
    gap: 14px;
  }
  .catalogue-toolbar {
    flex-wrap: wrap;
  }
  .catalogue-search {
    flex-basis: 100%;
  }
  .catalogue-publisher {
    flex: 1;
  }
  .catalogue-count {
    margin-bottom: 15px;
  }
  .catalogue-card {
    padding: 22px;
  }
  .activation-dialog {
    padding: 20px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .catalogue-card {
    transition: none;
  }
  .catalogue-card:hover {
    transform: none;
  }
}
</style>
