<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, friendlyError } from '../api/client';

const loadError = ref('');
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
      const offerings = OFFERINGS[module.account] ?? [];
      const moduleText = [
        module.title,
        module.summary,
        module.detail,
        module.account,
        module.publisher,
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
    const tools = OFFERINGS[module.account];
    return sum + (tools && tools.length > 0 ? tools.length : 1);
  }, 0),
);
const selected = computed(() =>
  catalogue.value?.modules.find((module) => module.account === selectedAccount.value),
);
const selectedTools = computed(() =>
  selected.value ? (OFFERINGS[selected.value.account] ?? []) : [],
);
const selectedOffering = computed(() =>
  selectedTools.value.find((offer) => offer.id === selectedOfferId.value),
);

onMounted(async () => {
  try {
    catalogue.value = await api.marketplace();
  } catch (error) {
    loadError.value = friendlyError(error);
  }
});

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
  <section class="page">
    <p class="eyebrow">Catalogue</p>
    <h1>Modules</h1>
    <p class="lede">
      Listings, prices, and fee rates are read from the chain. A module can be turned on only when
      its listing accepts the platform fee rule.
    </p>
    <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
    <div class="panel">
      <p v-if="!catalogue">Reading the chain…</p>
      <p v-else-if="!catalogue.configured">{{ catalogue.reason }}</p>
      <template v-else>
        <p>{{ moduleFee }}</p>
        <p class="field-help">
          {{ catalogue.modules.length }}
          {{ catalogue.modules.length === 1 ? 'contract is' : 'contracts are' }} listed, with
          {{ toolCount }}
          {{ toolCount === 1 ? 'tool' : 'tools' }}. Treasury, members, and documents belong to every
          DAO and are not separate listings.
        </p>
        <article v-if="selected" class="module-detail">
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
          <p class="eyebrow">{{ selected.title }} · {{ partyName(selected.party) }}</p>
          <h2>{{ selectedOffering?.title ?? selected.title }}</h2>
          <p>
            {{
              selectedOffering?.summary ??
              (selected.summary || 'No short description is stored on chain yet.')
            }}
          </p>
          <p v-if="selectedOffering && selected.summary">{{ selected.summary }}</p>
          <p v-if="selected.detail" class="module-detail-copy">{{ selected.detail }}</p>
          <h3 v-if="selectedTools.length">Tools in this contract</h3>
          <div v-if="selectedTools.length" class="module-grid">
            <button
              v-for="offer in selectedTools"
              :key="offer.id"
              type="button"
              class="module-card"
              :aria-current="offer.id === selectedOfferId ? 'true' : undefined"
              @click="selectedOfferId = offer.id"
            >
              <strong>{{ offer.title }}</strong>
              <small>{{ offer.summary }}</small>
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
            <dd>
              Accepted. A DAO turns this contract on once, and every tool above comes with it.
            </dd>
            <dt>Code hash</dt>
            <dd class="mono">{{ selected.codeHash }}</dd>
          </dl>
        </article>
        <template v-else>
          <div class="module-toolbar">
            <label>
              Find a module
              <input v-model="moduleQuery" type="search" name="module-query" />
            </label>
            <label>
              Publisher
              <select v-model="partyFilter" name="module-party">
                <option value="all">All modules</option>
                <option value="first-party">Daclify</option>
                <option value="third-party">Third-party</option>
              </select>
            </label>
          </div>
          <p v-if="groups.length === 0">No modules match this filter.</p>
          <article v-for="group in groups" :key="group.module.account" class="offer-group">
            <header class="offer-head">
              <div>
                <h2>
                  <button
                    type="button"
                    class="text-button offer-title"
                    @click="openModule(group.module.account)"
                  >
                    {{ group.module.title }}
                  </button>
                </h2>
                <p>
                  {{ group.module.summary || 'No short description is stored on chain yet.' }}
                </p>
              </div>
              <span class="pill"
                >{{ partyName(group.module.party) }} · {{ usage(group.module.price) }}</span
              >
            </header>
            <div v-if="group.visible.length" class="module-grid">
              <button
                v-for="offer in group.visible"
                :key="offer.id"
                type="button"
                class="module-card"
                @click="openModule(group.module.account, offer.id)"
              >
                <strong>{{ offer.title }}</strong>
                <small>{{ offer.summary }}</small>
              </button>
            </div>
          </article>
        </template>
      </template>
    </div>
  </section>
</template>
