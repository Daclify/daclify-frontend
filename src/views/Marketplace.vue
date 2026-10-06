<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { PrivateKey } from '@wharfkit/antelope';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';

const route = useRoute();
const state = useWorkspace();
const tab = ref<'modules' | 'names'>('modules');
const loadError = ref('');
const catalogue = ref<Awaited<ReturnType<typeof api.marketplace>>>();
const service = ref<Awaited<ReturnType<typeof api.names>>>();
const moduleQuery = ref('');
const partyFilter = ref<'all' | 'first-party' | 'third-party'>('all');
const selectedAccount = ref('');
const selectedOfferId = ref('');
const accountName = ref('');
const nameIssueText = ref('');
const quote = ref<Awaited<ReturnType<typeof api.nameQuote>>>();
const quoteError = ref('');
const quoting = ref(false);
const keys = ref<{
  ownerPrivate: string;
  ownerPublic: string;
  activePrivate: string;
  activePublic: string;
}>();
const savedKeys = ref(false);
const copied = ref('');
const paying = ref(false);
const payError = ref('');
let requestId = 0;
let quoteTimer: ReturnType<typeof setTimeout> | undefined;

function feeLabel(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2)}%`;
}
function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function usage(price: string): string {
  const amount = Number(price.split(' ')[0] ?? '');
  return amount === 0 ? 'No usage charge' : price;
}
function ramLabel(bytes: number): string {
  return bytes % 1024 === 0 ? `${bytes / 1024} KiB` : `${bytes} bytes`;
}
function partyName(party: 'first-party' | 'third-party'): string {
  return party === 'first-party' ? 'Daclify' : 'Third-party';
}
function nameIssue(value: string): string {
  if (!value) return '';
  if (value.length > 12) return 'A Telos name has at most 12 characters.';
  if (!/^[a-z1-5.]+$/.test(value)) return 'A Telos name uses a to z, 1 to 5, and dots.';
  if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) {
    return 'A Telos name cannot start or end with a dot, or contain two dots in a row.';
  }
  return '';
}
function observed(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
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
const nameFee = computed(() => {
  const fees = service.value;
  if (
    !fees?.configured ||
    fees.thirdPartyBps === null ||
    fees.firstPartyBps === null ||
    fees.bumpBps === null ||
    fees.quotePremiumBps === null
  ) {
    return '';
  }
  const first =
    fees.firstPartyBps === 10000
      ? 'A Daclify name keeps the full charge.'
      : `A Daclify name pays the platform ${feeLabel(fees.firstPartyBps)}.`;
  const governor = fees.daoId
    ? `DAO ${fees.daoId} admins change these rates with govfees.`
    : 'The runtime account can change these rates until a governing DAO is linked.';
  return `${first} A connected name pays the platform ${feeLabel(fees.thirdPartyBps)} and its price rises ${feeLabel(fees.bumpBps)} after each sale. A basic TLOS price adds ${feeLabel(fees.quotePremiumBps)} to the dollar conversion. ${governor}`;
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
const basicTier = computed(() => service.value?.tiers.find((tier) => tier.kind === 'basic'));
const notice = computed(() => {
  if (route.query.names === 'submitted') {
    return 'The card payment was submitted. The Telos account appears after the chain records the sale.';
  }
  if (route.query.names === 'cancelled')
    return 'The card payment was cancelled. No account was created.';
  return '';
});

onMounted(async () => {
  try {
    const [market, names] = await Promise.all([api.marketplace(), api.names()]);
    catalogue.value = market;
    service.value = names;
  } catch (error) {
    loadError.value = friendlyError(error);
  }
});

watch(accountName, (value) => {
  if (quoteTimer) clearTimeout(quoteTimer);
  const name = value.trim();
  quote.value = undefined;
  quoteError.value = '';
  nameIssueText.value = nameIssue(name);
  if (!name || nameIssueText.value) return;
  quoteTimer = setTimeout(() => void checkPrice(), 400);
});

async function checkPrice() {
  if (quoteTimer) clearTimeout(quoteTimer);
  const id = ++requestId;
  const name = accountName.value.trim();
  quote.value = undefined;
  quoteError.value = '';
  nameIssueText.value = nameIssue(name);
  if (!name || nameIssueText.value) return;
  quoting.value = true;
  try {
    const result = await api.nameQuote(name);
    if (id !== requestId) return;
    quote.value = result;
  } catch (error) {
    if (id !== requestId) return;
    quoteError.value = friendlyError(error);
  } finally {
    if (id === requestId) quoting.value = false;
  }
}

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

function generateKeys() {
  const owner = PrivateKey.generate('K1');
  const active = PrivateKey.generate('K1');
  keys.value = {
    ownerPrivate: owner.toString(),
    ownerPublic: owner.toPublic().toString(),
    activePrivate: active.toString(),
    activePublic: active.toPublic().toString(),
  };
  savedKeys.value = false;
  copied.value = '';
}

async function copyText(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = label;
  } catch {
    copied.value = '';
  }
}

async function pay() {
  const current = quote.value;
  const pair = keys.value;
  if (!current || !pair || current.accountName !== accountName.value.trim()) return;
  paying.value = true;
  payError.value = '';
  try {
    const session = await api.nameCheckout({
      accountName: current.accountName,
      ownerKey: pair.ownerPublic,
      activeKey: pair.activePublic,
    });
    window.location.assign(session.url);
  } catch (error) {
    payError.value = friendlyError(error);
    paying.value = false;
  }
}
</script>
<template>
  <section class="page">
    <p class="eyebrow">Marketplace</p>
    <h1>Modules and Telos names</h1>
    <p class="lede">
      Listings, prices, and fee rates are read from the chain. A module can be turned on only when
      its listing accepts the platform fee rule.
    </p>
    <p v-if="notice" class="alert" role="status">{{ notice }}</p>
    <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
    <div class="account-tabs" role="tablist" aria-label="Marketplace">
      <button type="button" role="tab" :aria-selected="tab === 'modules'" @click="tab = 'modules'">
        Modules
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'names'" @click="tab = 'names'">
        Names
      </button>
    </div>
    <div v-if="tab === 'modules'" class="panel" role="tabpanel">
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
    <div v-else class="panel" role="tabpanel">
      <p v-if="!service">Reading the chain…</p>
      <p v-else-if="!service.configured">{{ service.reason }}</p>
      <template v-else>
        <h2>Check a name</h2>
        <form class="name-check" @submit.prevent="checkPrice">
          <label>
            Telos account name
            <input
              v-model="accountName"
              name="account-name"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              required
            />
          </label>
          <button class="secondary" type="submit" :disabled="quoting">Check price</button>
        </form>
        <p class="name-status" role="status">
          <template v-if="nameIssueText">{{ nameIssueText }}</template>
          <template v-else-if="quoting">Checking this name on chain…</template>
          <template v-else-if="!accountName.trim()">
            Type a name. The price updates from the chain.
          </template>
        </p>
        <p v-if="quoteError" class="alert" role="alert">{{ quoteError }}</p>
        <article v-if="quote" class="quote-card">
          <p class="eyebrow">{{ quote.kind === 'basic' ? 'Basic' : 'Premium' }}</p>
          <p class="name-price">{{ quote.price }}</p>
          <p v-if="quote.usdCents > 0">{{ usd(quote.usdCents) }} by card</p>
          <p>Platform fee {{ feeLabel(quote.platformBps) }} · seller {{ quote.seller }}</p>
          <ul class="resource-row">
            <li class="pill">{{ quote.cpuStake }} CPU</li>
            <li class="pill">{{ quote.netStake }} NET</li>
            <li class="pill">{{ ramLabel(quote.ramBytes) }} of RAM</li>
          </ul>
          <p v-if="quote.suffix">
            Price comes from .{{ quote.suffix }}. This suffix has sold {{ quote.sales }}
            {{ quote.sales === 1 ? 'account' : 'accounts' }}.
            <template v-if="quote.nextPrice">The next sale costs {{ quote.nextPrice }}.</template>
          </p>
        </article>
        <div class="two-column">
          <article v-if="basicTier" class="offer-group">
            <h2>Basic name</h2>
            <p class="name-price">
              {{ basicTier.usdCents > 0 ? usd(basicTier.usdCents) : basicTier.price }}
            </p>
            <p v-if="basicTier.tlosQuote">
              {{ basicTier.tlosQuote }} in TLOS, including a
              {{ feeLabel(service.quotePremiumBps ?? 0) }} premium.
              <template v-if="service.oracleObservedAt">
                Rate observed {{ observed(service.oracleObservedAt) }}.
              </template>
            </p>
            <p v-else-if="basicTier.usdCents > 0">
              The TLOS conversion for this dollar price is not on this chain yet. The stored tier
              price is {{ basicTier.price }}.
            </p>
            <ul class="resource-row">
              <li class="pill">{{ basicTier.cpuStake }} CPU</li>
              <li class="pill">{{ basicTier.netStake }} NET</li>
              <li class="pill">{{ ramLabel(basicTier.ramBytes) }} of RAM</li>
            </ul>
            <p>A basic name is 12 characters and has no dot.</p>
          </article>
          <article class="offer-group">
            <h2>Premium name</h2>
            <p>
              Connect a Telos account you already own and set its price in TLOS or dollars. A new
              account that ends with that name, such as alice.dao, pays the current price. The price
              then rises {{ feeLabel(service.bumpBps ?? 0) }}. A dotted name cannot be sold until
              that suffix is connected.
            </p>
            <p v-if="service.suffixes.length === 0">No suffix is connected yet.</p>
            <ul v-else class="market-list">
              <li v-for="suffix in service.suffixes" :key="suffix.suffix">
                <strong class="mono">.{{ suffix.suffix }}</strong>
                <span>{{ suffix.seller }}</span>
                <span>{{ suffix.price }}</span>
                <span v-if="suffix.usdCents > 0">{{ usd(suffix.usdCents) }}</span>
                <span>{{ suffix.sales }} sales</span>
              </li>
            </ul>
          </article>
        </div>
        <h2>Listed names</h2>
        <p v-if="service.listings.length === 0">Nobody has listed one exact name yet.</p>
        <ul v-else class="market-list">
          <li v-for="listing in service.listings" :key="listing.accountName">
            <strong class="mono">{{ listing.accountName }}</strong>
            <span>{{ listing.seller }}</span>
            <span>{{ listing.price }}</span>
            <span v-if="listing.usdCents > 0">{{ usd(listing.usdCents) }}</span>
            <span>{{ listing.sold ? 'Sold' : 'For sale' }}</span>
          </li>
        </ul>
        <p class="field-help">{{ nameFee }}</p>
        <p v-if="service.cardPayments === false">
          Card payments are not configured on this service.
        </p>
        <div v-if="quote && quote.usdCents > 0 && service.cardPayments" class="key-once">
          <button type="button" class="secondary" @click="generateKeys">
            Generate account keys
          </button>
          <template v-if="keys">
            <p>
              Save both private keys now. They are not sent to the server and are not stored here.
            </p>
            <label>
              Owner private key
              <input class="mono" readonly :value="keys.ownerPrivate" />
            </label>
            <button type="button" class="text-button" @click="copyText('owner', keys.ownerPrivate)">
              {{ copied === 'owner' ? 'Copied' : 'Copy owner key' }}
            </button>
            <label>
              Active private key
              <input class="mono" readonly :value="keys.activePrivate" />
            </label>
            <button
              type="button"
              class="text-button"
              @click="copyText('active', keys.activePrivate)"
            >
              {{ copied === 'active' ? 'Copied' : 'Copy active key' }}
            </button>
            <label class="check-line">
              <input v-model="savedKeys" type="checkbox" />
              I have saved both private keys
            </label>
            <p v-if="!state.account">
              <RouterLink to="/account">Sign in</RouterLink> to pay by card.
            </p>
            <button
              v-else
              type="button"
              :disabled="!savedKeys || paying || quote.accountName !== accountName.trim()"
              @click="pay"
            >
              Pay by card
            </button>
            <p v-if="payError" class="alert" role="alert">{{ payError }}</p>
          </template>
        </div>
      </template>
      <p>
        Connecting a name you already own is the Telos action regsuffix on the names contract. You
        sign it with that account, accept the fee rule, and set a price in TLOS, dollars, or both.
        The browser vault cannot sign that action. regname still lists one exact name that is not an
        account yet.
      </p>
    </div>
  </section>
</template>
