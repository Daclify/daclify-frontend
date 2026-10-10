<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { PrivateKey } from '@wharfkit/antelope';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import NamesManager from '../components/NamesManager.vue';
import { connectNative, nativeIdentity, nativeNamesTransaction } from '../auth/telos-zero';
import { namePurchaseActions, NamesCodeHash } from '@daclify/core-protocol/sdk';
import { AtSign, ArrowRight } from '@lucide/vue';
const mode = ref<'browse' | 'manage'>('browse');
const idea = ref('');
const suggestions = computed(() => {
  const base =
    idea.value
      .toLowerCase()
      .replace(/[^a-z1-5]/g, '')
      .slice(0, 7) || 'mydao';
  return [
    ...new Set([
      `${base}111111111111`.slice(0, 12),
      `${base}team11111`.slice(0, 12),
      ...(service.value?.suffixes ?? [])
        .slice(0, 4)
        .map((item) => `${base.slice(0, Math.max(1, 11 - item.suffix.length))}.${item.suffix}`)
        .filter((name) => name.length <= 12),
    ]),
  ];
});
function chooseName(name: string) {
  mode.value = 'browse';
  accountName.value = name;
  void nextTick(() => document.getElementById('name-input')?.focus());
}
let serviceSequence = 0;
const serviceBusy = ref(false);
async function reloadService() {
  const id = ++serviceSequence;
  serviceBusy.value = true;
  loadError.value = '';
  try {
    const result = await api.names();
    if (id === serviceSequence) service.value = result;
  } catch (cause) {
    if (id === serviceSequence) loadError.value = friendlyError(cause);
  } finally {
    if (id === serviceSequence) serviceBusy.value = false;
  }
}

const route = useRoute();
const state = useWorkspace();
const loadError = ref('');
const service = ref<Awaited<ReturnType<typeof api.names>>>();
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
const copyError = ref('');
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
function ramLabel(bytes: number): string {
  return bytes % 1024 === 0 ? `${bytes / 1024} KiB` : `${bytes} bytes`;
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
const basicTier = computed(() => service.value?.tiers.find((tier) => tier.kind === 'basic'));
const notice = computed(() => {
  if (route.query.names === 'submitted') {
    return 'Payment submitted. Your account is created after payment verification. Keep your receipt; contact support if creation is delayed.';
  }
  if (route.query.names === 'cancelled')
    return 'The card payment was cancelled. No account was created.';
  return '';
});

onMounted(reloadService);
watch(
  () => state.network && [state.network.chainId, state.network.runtime].join('/'),
  (_value, previous) => {
    if (previous === undefined) return;
    requestId++;
    if (quoteTimer) clearTimeout(quoteTimer);
    quoting.value = false;
    quote.value = undefined;
    keys.value = undefined;
    savedKeys.value = false;
    service.value = undefined;
    void reloadService();
  },
);

onBeforeUnmount(() => {
  if (quoteTimer) clearTimeout(quoteTimer);
  requestId++;
  serviceSequence++;
});

watch(accountName, (value) => {
  requestId++;
  quoting.value = false;
  payError.value = '';
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
  if (!name || nameIssueText.value) {
    quoting.value = false;
    return;
  }
  quoting.value = true;
  try {
    const result = await api.nameQuote(name);
    if (id !== requestId) return;
    if (result.accountName !== name) throw new Error('CHAIN_RESPONSE_INVALID');
    quote.value = result;
  } catch (error) {
    if (id !== requestId) return;
    quoteError.value = friendlyError(error);
  } finally {
    if (id === requestId) quoting.value = false;
  }
}

function generateKeys() {
  copyError.value = '';
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
  const pair = keys.value;
  try {
    await navigator.clipboard.writeText(value);
    if (pair !== keys.value) return;
    copied.value = label;
    copyError.value = '';
  } catch {
    if (pair !== keys.value) return;
    copied.value = '';
    copyError.value = 'Copy was blocked. Select the key and copy it manually before continuing.';
  }
}

async function payTlos() {
  if (paying.value) return;
  const current = quote.value,
    pair = keys.value,
    config = service.value,
    context = JSON.stringify([
      state.network?.chainId,
      state.network?.runtime,
      state.account?.id,
      accountName.value,
    ]);
  if (
    !current ||
    current.accountName !== accountName.value.trim() ||
    !pair ||
    !savedKeys.value ||
    !config?.contract ||
    !config.tokenContract
  )
    return;
  paying.value = true;
  payError.value = '';
  try {
    await connectNative();
    if (
      context !==
        JSON.stringify([
          state.network?.chainId,
          state.network?.runtime,
          state.account?.id,
          accountName.value,
        ]) ||
      pair !== keys.value
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    const fresh = await api.nameQuote(current.accountName);
    if (JSON.stringify(fresh) !== JSON.stringify(current)) throw new Error('PRICE_CHANGED');
    if (
      context !==
        JSON.stringify([
          state.network?.chainId,
          state.network?.runtime,
          state.account?.id,
          accountName.value,
        ]) ||
      pair !== keys.value
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    const actions = namePurchaseActions(
      config.contract,
      config.tokenContract,
      nativeIdentity().account,
      fresh,
      pair.ownerPublic,
      pair.activePublic,
    );
    await nativeNamesTransaction(actions, NamesCodeHash, () => {
      if (
        context !==
          JSON.stringify([
            state.network?.chainId,
            state.network?.runtime,
            state.account?.id,
            accountName.value,
          ]) ||
        pair !== keys.value ||
        !savedKeys.value ||
        quote.value !== current
      )
        throw new Error('WALLET_CONTEXT_CHANGED');
    });
    payError.value = '';
    quote.value = undefined;
    keys.value = undefined;
    savedKeys.value = false;
    await reloadService();
  } catch (cause) {
    payError.value = friendlyError(cause);
  } finally {
    paying.value = false;
  }
}

async function pay() {
  if (paying.value || !savedKeys.value) return;
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
    if (pair !== keys.value || quote.value !== current || !savedKeys.value)
      throw new Error('WALLET_CONTEXT_CHANGED');
    window.location.assign(session.url);
  } catch (error) {
    payError.value = friendlyError(error);
    paying.value = false;
  }
}
</script>
<template>
  <section class="page">
    <p class="eyebrow">Telos accounts</p>
    <h1>Names</h1>
    <p class="lead">
      Find your community’s next name. Buy a new Telos account or offer names under a native account
      you control.
    </p>
    <p v-if="notice" class="alert" role="status">{{ notice }}</p>
    <div v-if="loadError" class="alert" role="alert">
      <p>Could not read the name service. {{ loadError }}</p>
      <button type="button" class="secondary" :disabled="serviceBusy" @click="reloadService">
        Retry name service
      </button>
    </div>
    <div class="workspace-tabs" role="group" aria-label="Names views">
      <button type="button" :aria-pressed="mode === 'browse'" @click="mode = 'browse'">
        Find a name</button
      ><button type="button" :aria-pressed="mode === 'manage'" @click="mode = 'manage'">
        Manage & sell
      </button>
    </div>
    <NamesManager
      v-if="mode === 'manage' && service?.configured"
      :service="service"
      @updated="reloadService"
    />
    <div v-else class="panel names-browser">
      <p v-if="serviceBusy && !service" role="status">Reading the chain…</p>
      <p v-else-if="service && !service.configured">
        {{ service.reason }} <RouterLink to="/status">Check service status</RouterLink>
      </p>
      <template v-else-if="service?.configured">
        <p class="eyebrow">1 · Find your name</p>
        <h2>Check a name</h2>
        <p>Native names work across Telos. You do not need one to join a DAO.</p>
        <form class="name-check" @submit.prevent="checkPrice">
          <label>
            Telos account name
            <input
              id="name-input"
              v-model="accountName"
              :aria-invalid="!!nameIssueText"
              aria-describedby="name-syntax"
              :disabled="paying"
              name="account-name"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              required
            />
          </label>
          <button class="secondary" type="submit" :disabled="quoting">Check price</button>
        </form>
        <p id="name-syntax" class="field-help">
          Up to 12 characters: a–z, 1–5 and dots. Availability and prices come from the chain.
        </p>
        <p class="name-status" role="status">
          <template v-if="nameIssueText">{{ nameIssueText }}</template>
          <template v-else-if="quoting">Checking this name on chain…</template>
          <template v-else-if="!accountName.trim()">
            Type a name. The price updates from the chain.
          </template>
        </p>
        <p v-if="quoteError" class="alert" role="alert">{{ quoteError }}</p>
        <article v-if="quote" class="quote-card">
          <h2 class="mono">{{ quote.accountName }}</h2>
          <p class="eyebrow">{{ quote.kind === 'basic' ? 'Basic' : 'Premium' }}</p>
          <p class="name-price">{{ quote.price }}</p>
          <p v-if="quote.usdCents > 0">
            {{ usd(quote.usdCents) }}
            {{
              service.cardPayments && quote.kind === 'basic' && quote.party === 'first-party'
                ? 'by card'
                : 'reference price'
            }}
          </p>
          <p v-if="quote.kind === 'basic' && quote.party === 'first-party'" class="field-help">
            Prices include the RAM, CPU and NET shown below. Card and TLOS totals reflect their
            payment costs and update with current resource and TLOS prices.
          </p>
          <p
            v-if="
              service.cardPayments &&
              quote.kind === 'basic' &&
              quote.party === 'first-party' &&
              quote.usdCents === 0
            "
            class="field-help"
          >
            A card price is temporarily unavailable. Native wallet checkout is available below.
          </p>
          <p v-if="!service.cardPayments" class="field-help">
            Card checkout is not enabled on this deployment. Use the native wallet option after
            saving your keys.
          </p>
          <p v-if="quote.party === 'third-party'" class="notice">
            Third-party names currently use TLOS. Card checkout awaits seller payment routing.
          </p>
          <p v-if="quote.kind === 'premium'" class="field-help">
            Premium names use native TLOS checkout. A short name still needs its seller’s closed
            native auction claim.
          </p>
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
        <div
          v-if="
            quote &&
            (service.contract ||
              (quote.party === 'first-party' &&
                quote.kind === 'basic' &&
                quote.usdCents > 0 &&
                service.cardPayments))
          "
          class="key-once"
        >
          <p class="eyebrow">2 · Save your keys</p>
          <h2>Secure your new account</h2>
          <p>Generate owner and active keys, save both privately, then choose how to pay.</p>
          <button type="button" class="secondary" :disabled="paying" @click="generateKeys">
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
            <p v-if="copyError" class="alert" role="alert">{{ copyError }}</p>
            <label class="check-line">
              <input v-model="savedKeys" type="checkbox" />
              I have saved both private keys
            </label>
            <p class="eyebrow">3 · Choose payment</p>
            <button
              v-if="service.contract && service.tokenContract && quote.price !== '0.0000 TLOS'"
              type="button"
              class="secondary"
              :disabled="!savedKeys || paying"
              @click="payTlos"
            >
              Pay {{ quote.price }} with native wallet
            </button>
            <p
              v-if="
                quote.party === 'first-party' &&
                quote.kind === 'basic' &&
                quote.usdCents > 0 &&
                service.cardPayments &&
                !state.account
              "
            >
              <RouterLink to="/account">Sign in</RouterLink> to pay by card.
            </p>
            <button
              v-else-if="
                quote.party === 'first-party' &&
                quote.kind === 'basic' &&
                quote.usdCents > 0 &&
                service.cardPayments &&
                state.account
              "
              type="button"
              :disabled="!savedKeys || paying || quote.accountName !== accountName.trim()"
              @click="pay"
            >
              Pay by card
            </button>
            <p v-if="payError" class="alert" role="alert">{{ payError }}</p>
          </template>
        </div>
        <details class="name-inspiration">
          <summary>Need name ideas?</summary>
          <label for="name-idea">Start with an idea</label
          ><input
            id="name-idea"
            v-model="idea"
            maxlength="40"
            placeholder="Your name, project or community"
          />
          <div class="name-suggestions">
            <button
              v-for="name in suggestions"
              :key="name"
              type="button"
              class="secondary"
              @click="chooseName(name)"
            >
              <AtSign aria-hidden="true" />{{ name }}
            </button>
          </div>
          <p class="field-help">Suggestions are ideas; use Check price to verify availability.</p>
        </details>
        <details class="name-catalogue">
          <summary>Browse prices and listed names</summary>
          <div class="two-column">
            <article v-if="basicTier" class="offer-group">
              <h2>Basic name</h2>
              <p class="name-price">
                {{
                  basicTier.usdCents > 0
                    ? usd(basicTier.usdCents) +
                      (service.cardPayments ? ' by card' : ' reference price')
                    : basicTier.price
                }}
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
              <p>
                A basic name is 12 characters and has no dot. Totals include account resources and
                adjust with current resource and TLOS prices.
              </p>
            </article>
            <article class="offer-group">
              <h2>Premium name</h2>
              <p>
                Connect a Telos account you already own and set its price in TLOS or dollars. A new
                account that ends with that name, such as alice.dao, pays the current price. The
                price then rises {{ feeLabel(service.bumpBps ?? 0) }}. A dotted name cannot be sold
                until that suffix is connected.
              </p>
              <p class="field-help">
                Suffix accounts cost at least the current basic-account price. The prices below are
                seller references; check a name for its current payable price.
              </p>
              <p v-if="service.suffixes.length === 0">No suffix is connected yet.</p>
              <ul v-else class="market-list">
                <li v-for="suffix in service.suffixes" :key="suffix.suffix">
                  <strong class="mono">.{{ suffix.suffix }}</strong>
                  <span>{{ suffix.seller }}</span>
                  <span>Seller reference: {{ suffix.price }}</span>
                  <span v-if="suffix.usdCents > 0">{{ usd(suffix.usdCents) }}</span>
                  <span>{{ suffix.sales }} sales</span>
                </li>
              </ul>
            </article>
          </div>
          <h2>Listed names</h2>
          <p v-if="service.listings.length === 0">Nobody has listed one exact name yet.</p>
          <ul v-else class="market-list names-grid">
            <li class="name-offer" v-for="listing in service.listings" :key="listing.accountName">
              <strong class="mono">{{ listing.accountName }}</strong>
              <span>{{ listing.seller }}</span>
              <span>Seller reference: {{ listing.price }}</span>
              <span v-if="listing.usdCents > 0">{{ usd(listing.usdCents) }}</span>
              <span>{{ listing.sold ? 'Sold' : 'For sale' }}</span
              ><button
                v-if="!listing.sold"
                type="button"
                class="secondary"
                @click="chooseName(listing.accountName)"
              >
                Check this name <ArrowRight aria-hidden="true" />
              </button>
            </li>
          </ul>
          <p class="field-help">{{ nameFee }}</p>
          <p v-if="service.cardPayments === false">
            Card payments are not configured on this service.
          </p>
        </details>
      </template>
      <p class="field-help">
        Want to offer names? Open
        <button type="button" class="text-button" @click="mode = 'manage'">Manage & sell</button> to
        connect your native account or prepare a DAO-controlled listing.
      </p>
    </div>
  </section>
</template>

<style scoped>
.name-inspiration,
.name-catalogue {
  margin-top: 1.5rem;
  border-top: 1px solid var(--border-default);
  padding-top: 1rem;
}
.name-inspiration summary,
.name-catalogue summary {
  min-height: 44px;
}
.name-check {
  margin-top: 1rem;
}
.quote-card {
  margin-top: 1rem;
}
.quote-card h2 {
  overflow-wrap: anywhere;
}
.key-once {
  padding: 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 1rem;
  margin-top: 1rem;
}
.name-suggestions button {
  min-height: 44px;
}
</style>
