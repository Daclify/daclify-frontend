<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { PrivateKey } from '@wharfkit/antelope';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import NamesManager from '../components/NamesManager.vue';
import { connectNative, nativeIdentity, nativeNamesTransaction } from '../auth/telos-zero';
import { namePurchaseActions, NamesCodeHash } from '@daclify/core-protocol/sdk';
import { AtSign, Sparkles, ArrowRight } from '@lucide/vue';
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
}
async function reloadService() {
  try {
    service.value = await api.names();
  } catch (cause) {
    loadError.value = friendlyError(cause);
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
    return 'The card payment was submitted. The Telos account appears after the chain records the sale.';
  }
  if (route.query.names === 'cancelled')
    return 'The card payment was cancelled. No account was created.';
  return '';
});

onMounted(async () => {
  try {
    service.value = await api.names();
  } catch (error) {
    loadError.value = friendlyError(error);
  }
});

onBeforeUnmount(() => {
  if (quoteTimer) clearTimeout(quoteTimer);
  requestId++;
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

async function payTlos() {
  const current = quote.value,
    pair = keys.value,
    config = service.value,
    context = JSON.stringify([
      state.network?.chainId,
      state.network?.runtime,
      state.account?.id,
      accountName.value,
    ]);
  if (!current || !pair || !savedKeys.value || !config?.contract || !config.tokenContract) return;
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
    <p class="lede">
      Find your community’s next name. Buy a new Telos account or offer names under a native account
      you control.
    </p>
    <p v-if="notice" class="alert" role="status">{{ notice }}</p>
    <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
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
      <p v-if="!service">Reading the chain…</p>
      <p v-else-if="!service.configured">{{ service.reason }}</p>
      <template v-else>
        <div class="names-discovery">
          <div>
            <p class="eyebrow"><Sparkles aria-hidden="true" />A NAME FOR YOUR NEXT CHAPTER</p>
            <h2>Make it yours</h2>
            <p>
              Native account names work across Telos. You can use them with Daclify, but you do not
              need one to join a DAO.
            </p>
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
            <p class="field-help">
              Suggestions are ideas; availability and prices are checked on-chain.
            </p>
          </div>
          <div class="names-art" aria-hidden="true"><AtSign /><span>your.name</span></div>
        </div>
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
        <ul v-else class="market-list names-grid">
          <li class="name-offer" v-for="listing in service.listings" :key="listing.accountName">
            <strong class="mono">{{ listing.accountName }}</strong>
            <span>{{ listing.seller }}</span>
            <span>{{ listing.price }}</span>
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
      </template>
      <p class="field-help">
        Want to offer names? Open
        <button type="button" class="text-button" @click="mode = 'manage'">Manage & sell</button> to
        connect your native account or prepare a DAO-controlled listing.
      </p>
    </div>
  </section>
</template>
