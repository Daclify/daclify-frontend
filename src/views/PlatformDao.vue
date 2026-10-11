<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Coins, Boxes, SlidersHorizontal, ShieldCheck, Search } from '@lucide/vue';
import {
  parseUnits,
  formatUnits,
  DEFAULT_RESOURCE_POLICY,
  ResourcePolicySchema,
  type PlatformStatus,
  type ModuleFeePricing,
  ModuleFeePriceSchema,
} from '@daclify/core-protocol';
import {
  encodeAction,
  makeInstruction,
  RuntimeActionSchemas,
  RuntimeCodeHash,
} from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
const signerReady = computed(() => canSignMember(member.value));
import { useWorkspace } from '../state/workspace';
const workspace = useWorkspace();
const tabs = [
  { id: 'pricing', label: 'Pricing', icon: Coins },
  { id: 'catalogue', label: 'Catalogue', icon: Boxes },
  { id: 'policies', label: 'Policies', icon: SlidersHorizontal },
] as const;
const tab = ref<(typeof tabs)[number]['id']>('pricing'),
  search = ref('');
function navigateTabs(event: KeyboardEvent) {
  const current = tabs.findIndex((item) => item.id === tab.value);
  const index =
    event.key === 'ArrowRight'
      ? (current + 1) % tabs.length
      : event.key === 'ArrowLeft'
        ? (current + tabs.length - 1) % tabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : undefined;
  const item = index === undefined ? undefined : tabs[index];
  if (!item) return;
  event.preventDefault();
  tab.value = item.id;
  void nextTick(() => document.getElementById('platform-tab-' + item.id)?.focus());
}
const status = ref<PlatformStatus>(),
  catalogue = ref<Awaited<ReturnType<typeof api.marketplace>>>();
const modulePricing = ref<ModuleFeePricing>(),
  monthlyRates = ref<Record<string, string>>({});
const filteredModules = computed(() => {
  const query = search.value.trim().toLowerCase();
  return (
    catalogue.value?.modules.filter((module) =>
      (module.title + ' ' + module.account).toLowerCase().includes(query),
    ) ?? []
  );
});
function editModule(module: NonNullable<typeof catalogue.value>['modules'][number]) {
  account.value = module.account;
  title.value = module.title;
  price.value = module.price;
  codeHash.value = module.codeHash;
  summary.value = module.summary;
  detail.value = module.detail;
  void nextTick(() => document.getElementById('module-account')?.focus());
}
const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const totalModulePrice = computed(() =>
  modulePricing.value
    ? money(modulePricing.value.plans.reduce((sum, plan) => sum + plan.pricing.monthlyUsdCents, 0))
    : '—',
);
const error = ref(''),
  success = ref(''),
  busy = ref(false);
const freeSlots = ref(10),
  settler = ref(''),
  connectPercent = ref(5),
  firstRate = ref('1.00'),
  nextRate = ref('0.50'),
  restRate = ref('0.20');
const nativeRamPercent = ref('5.00'),
  cardRamPercent = ref('20.00'),
  storageFreeMb = ref('100.000000'),
  storageUnitGb = ref('1.000000000'),
  storageUnitUsd = ref('1.00');
const thirdParty = ref(500),
  firstParty = ref(10000),
  bump = ref(2000),
  namePremium = ref(2000);
const account = ref(''),
  price = ref('0.0000 TLOS'),
  codeHash = ref(''),
  title = ref(''),
  summary = ref(''),
  detail = ref('');
const dao = computed(() => status.value?.chain?.platformDao);
const member = computed(() =>
  workspace.memberships.find(
    (m) =>
      dao.value &&
      m.dao.chainId === dao.value.chainId &&
      m.dao.contract === dao.value.contract &&
      m.dao.daoId === dao.value.daoId &&
      m.active &&
      m.admin,
  ),
);
const canSign = computed(
  () => !!member.value && signerReady.value && !busy.value && status.value?.chain?.chainMatches,
);
const newPoliciesReady = computed(() =>
  status.value?.chain?.contracts.some(
    (c) => c.account === workspace.network?.runtime && c.codeHash === RuntimeCodeHash,
  ),
);
let sequence = 0;
async function load() {
  const current = ++sequence;
  error.value = '';
  status.value = undefined;
  catalogue.value = undefined;
  modulePricing.value = undefined;
  try {
    const [s, c, fees] = await Promise.all([
      api.platformStatus(),
      api.marketplace(),
      api.moduleFeePricing().catch(() => undefined),
    ]);
    if (current !== sequence) return;
    status.value = s;
    catalogue.value = c;
    if (
      fees &&
      fees.chainId === workspace.network?.chainId &&
      fees?.runtime === workspace.network?.runtime
    ) {
      modulePricing.value = fees;
      monthlyRates.value = Object.fromEntries(
        fees.plans.map((plan) => [
          plan.pricing.account,
          formatUnits(BigInt(plan.pricing.monthlyUsdCents), 2),
        ]),
      );
    }
    const cfg = s.chain?.creation;
    freeSlots.value = s.chain?.hosting?.free_members ?? 10;
    settler.value = cfg?.settler ?? '';
    connectPercent.value = (s.chain?.paymentPolicy?.bps ?? 500) / 100;
    firstRate.value = ((s.chain?.seatPricing?.first_usd ?? 100) / 100).toFixed(2);
    nextRate.value = ((s.chain?.seatPricing?.next_usd ?? 50) / 100).toFixed(2);
    restRate.value = ((s.chain?.seatPricing?.rest_usd ?? 20) / 100).toFixed(2);
    const resources = s.chain?.resourcePolicy ?? DEFAULT_RESOURCE_POLICY;
    nativeRamPercent.value = formatUnits(BigInt(resources.nativeRamBps), 2);
    cardRamPercent.value = formatUnits(BigInt(resources.cardRamBps), 2);
    storageFreeMb.value = formatUnits(BigInt(resources.storage.freeBytes), 6);
    storageUnitGb.value = formatUnits(BigInt(resources.storage.unitBytes), 9);
    storageUnitUsd.value = formatUnits(BigInt(resources.storage.monthlyUnitUsdCents), 2);
    thirdParty.value = s.chain?.fees?.third_party_bps ?? 500;
    firstParty.value = s.chain?.fees?.first_party_bps ?? 10000;
    bump.value = s.chain?.market?.bump_bps ?? 2000;
    namePremium.value = s.chain?.market?.quote_premium_bps ?? 2000;
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  }
}
onMounted(load);
watch(() => workspace.network?.chainId, load);
function actor() {
  if (!dao.value || !member.value) throw new Error('AUTH_REQUIRED');
  return { runtime: dao.value.contract, dao_id: dao.value.daoId, member_id: member.value.memberId };
}
async function sign(action: string, data: Uint8Array) {
  if (!dao.value || !member.value) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        dao.value,
        member.value.memberId,
        member.value.nonce,
        Math.floor(Date.now() / 1000) + 300,
        dao.value.contract,
        action,
        data,
      ),
    );
    await workspace.refresh();
    await load();
    success.value = 'Platform configuration updated on chain.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function fees() {
  try {
    await sign(
      'govhosted',
      encodeAction('govhosted', {
        ...actor(),
        free_members: freeSlots.value,
        settler: settler.value,
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function monthlyFee(plan: NonNullable<typeof modulePricing.value>['plans'][number]) {
  try {
    if (
      modulePricing.value?.chainId !== workspace.network?.chainId ||
      modulePricing.value?.runtime !== workspace.network?.runtime
    )
      throw new Error('DAO_REFERENCE');
    const price = ModuleFeePriceSchema.parse({
      ...plan.pricing,
      monthlyUsdCents: Number(parseUnits(monthlyRates.value[plan.pricing.account] ?? '', 2)),
    });
    await sign(
      'govmodfee',
      encodeAction('govmodfee', {
        ...actor(),
        account: price.account,
        expected_revision: price.revision,
        monthly_usd: price.monthlyUsdCents,
        actions: price.actions,
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function resources() {
  success.value = '';
  error.value = '';
  try {
    const current = status.value?.chain?.resourcePolicy ?? DEFAULT_RESOURCE_POLICY;
    const validated = ResourcePolicySchema.safeParse({
      ...current,
      nativeRamBps: Number(parseUnits(nativeRamPercent.value, 2)),
      cardRamBps: Number(parseUnits(cardRamPercent.value, 2)),
      storage: {
        ...current.storage,
        freeBytes: parseUnits(storageFreeMb.value, 6).toString(),
        unitBytes: parseUnits(storageUnitGb.value, 9).toString(),
        monthlyUnitUsdCents: Number(parseUnits(storageUnitUsd.value, 2)),
      },
    });
    if (!validated.success) {
      error.value =
        'Choose fees between 0% and 100%, valid storage units and a positive monthly price.';
      return;
    }
    const policy = validated.data;
    await sign(
      'govresources',
      encodeAction('govresources', {
        ...actor(),
        expected_revision: current.revision,
        native_ram_bps: policy.nativeRamBps,
        card_ram_bps: policy.cardRamBps,
        included_activity_bytes: policy.includedActivityBytes,
        identity_bytes_per_slot: policy.identityBytesPerSlot,
        quote_lifetime_seconds: policy.quoteLifetimeSeconds,
        storage_free_bytes: policy.storage.freeBytes,
        storage_unit_bytes: policy.storage.unitBytes,
        storage_monthly_usd: policy.storage.monthlyUnitUsdCents,
      }),
    );
  } catch (cause) {
    error.value =
      cause instanceof TypeError || cause instanceof RangeError
        ? 'Enter valid decimal resource fees, storage units and a positive monthly price.'
        : friendlyError(cause);
  }
}
async function hostingPrices() {
  try {
    await sign(
      'govseatfee',
      encodeAction('govseatfee', {
        ...actor(),
        first_usd: Number(parseUnits(firstRate.value, 2)),
        next_usd: Number(parseUnits(nextRate.value, 2)),
        rest_usd: Number(parseUnits(restRate.value, 2)),
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function connectFees() {
  try {
    await sign(
      'govpayfees',
      encodeAction('govpayfees', {
        ...actor(),
        bps: Number(parseUnits(String(connectPercent.value), 2)),
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function commissions() {
  try {
    await sign(
      'govfees',
      encodeAction(
        'govfees',
        RuntimeActionSchemas.govfees.parse({
          ...actor(),
          third_party_bps: thirdParty.value,
          first_party_bps: firstParty.value,
          bump_bps: bump.value,
          quote_premium_bps: namePremium.value,
        }),
      ),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function register() {
  try {
    await sign(
      'govlist',
      encodeAction(
        'govlist',
        RuntimeActionSchemas.govlist.parse({
          ...actor(),
          account: account.value,
          price: price.value,
          code_hash: codeHash.value,
          title: title.value,
        }),
      ),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function remove(account: string) {
  try {
    await sign(
      'govunlist',
      encodeAction('govunlist', RuntimeActionSchemas.govunlist.parse({ ...actor(), account })),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function describe() {
  try {
    await sign(
      'govmodcopy',
      encodeAction(
        'govmodcopy',
        RuntimeActionSchemas.govmodcopy.parse({
          ...actor(),
          account: account.value,
          summary: summary.value,
          detail: detail.value,
        }),
      ),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
</script>
<template>
  <div class="platform-manager">
    <div class="page-heading platform-heading">
      <div>
        <p class="eyebrow">PLATFORM GOVERNANCE</p>
        <h2>Platform controls</h2>
        <p class="lead">Pricing, modules and platform policies in one place.</p>
      </div>
      <div class="button-row">
        <RouterLink to="/pricing" class="button secondary">View pricing</RouterLink>
        <RouterLink to="/status" class="help-link">Platform status ↗</RouterLink>
      </div>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="success" class="notice" role="status">{{ success }}</p>
    <div class="platform-access">
      <ShieldCheck :size="18" aria-hidden="true" />
      <template v-if="dao">
        <strong>{{ member ? 'Platform administrator' : 'Read-only access' }}</strong>
        <span v-if="!member">An active platform administrator can sign changes.</span>
        <span v-else-if="!signerReady">Unlock or choose an authorized signer.</span>
        <span v-else>Changes require your signature.</span>
        <span class="platform-reference">DAO {{ dao.daoId }} · {{ dao.contract }}</span>
      </template>
      <span v-else-if="!status && !error">Checking platform settings…</span>
      <span v-else
        >No linked platform DAO. A native operator must create, enroll and link it before
        administration is available.</span
      >
    </div>
    <dl class="platform-summary" aria-label="Configured platform pricing">
      <div>
        <dt>Included members</dt>
        <dd>{{ status?.chain?.hosting?.free_members ?? '—' }}<small>Per hosted DAO</small></dd>
      </div>
      <div>
        <dt>Included storage</dt>
        <dd>
          {{
            status?.chain?.resourcePolicy
              ? formatUnits(BigInt(status.chain.resourcePolicy.storage.freeBytes), 6).replace(
                  /\.0+$/,
                  '',
                ) + ' MB'
              : '—'
          }}
          <small>Per hosted DAO</small>
        </dd>
      </div>
      <div>
        <dt>Monthly modules</dt>
        <dd>{{ totalModulePrice }}<small>All listed modules above 10 members</small></dd>
      </div>
      <div>
        <dt>Registered modules</dt>
        <dd>{{ catalogue?.modules.length ?? '—' }}<small>Available in the catalogue</small></dd>
      </div>
    </dl>
    <p v-if="status && !newPoliciesReady" class="notice">
      New hosting, resource and Connect controls require the matching reviewed runtime deployment.
    </p>
    <div
      class="account-tabs platform-tabs"
      role="tablist"
      aria-label="Platform sections"
      @keydown="navigateTabs"
    >
      <button
        v-for="item in tabs"
        :id="'platform-tab-' + item.id"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="tab === item.id"
        :aria-controls="'platform-panel-' + item.id"
        :tabindex="tab === item.id ? 0 : -1"
        @click="tab = item.id"
      >
        <component :is="item.icon" :size="16" aria-hidden="true" />{{ item.label }}
      </button>
    </div>
    <div
      v-show="tab === 'pricing'"
      id="platform-panel-pricing"
      role="tabpanel"
      aria-labelledby="platform-tab-pricing"
      tabindex="0"
    >
      <section class="panel settings-card" aria-labelledby="monthly-module-fees">
        <div class="panel-heading">
          <h2 id="monthly-module-fees">Monthly module access prices</h2>
          <span class="platform-tag">Free through 10 members</span>
        </div>
        <p>Separate monthly prices per DAO above ten active members, including managers.</p>
        <p v-if="!modulePricing" role="status">Monthly module pricing is unavailable.</p>
        <p v-else-if="!modulePricing.plans.length">Monthly module fees have not been configured.</p>
        <div class="module-price-list">
          <form
            v-for="plan in modulePricing?.plans"
            :key="plan.pricing.account"
            class="module-price-form"
            @submit.prevent="monthlyFee(plan)"
          >
            <fieldset :disabled="!canSign || !newPoliciesReady">
              <label :for="'monthly-module-' + plan.pricing.account"
                ><span>{{ plan.title }}<span class="sr-only"> (USD / DAO / month)</span></span
                ><small>{{ plan.pricing.account }}</small></label
              >
              <div class="module-price-input">
                <span aria-hidden="true">$</span
                ><input
                  :id="'monthly-module-' + plan.pricing.account"
                  :aria-label="plan.title + ' (USD / DAO / month)'"
                  v-model="monthlyRates[plan.pricing.account]"
                  inputmode="decimal"
                  required
                  pattern="[0-9]+(\.[0-9]{1,2})?"
                />
              </div>
              <button :aria-label="'Sign ' + plan.title + ' monthly price'">Sign price</button>
            </fieldset>
          </form>
        </div>
        <p class="field-help">
          USD / DAO / month. Set zero for free access, or at least $0.50. Existing paid intervals
          keep their expiry; completion and payouts remain available.
        </p>
      </section>
      <div class="platform-grid">
        <form
          class="panel settings-card"
          aria-labelledby="platform-hostingPrices"
          @submit.prevent="hostingPrices"
        >
          <h2 id="platform-hostingPrices">Graduated monthly capacity prices</h2>
          <p>
            Rates apply to new subscriptions or an explicit administrator-approved switch. Existing
            agreements retain their accepted schedule. Each lower rate applies only to slots in that
            band.
          </p>
          <fieldset :disabled="!canSign || !newPoliciesReady">
            <div class="setting-fields">
              <div class="setting-field">
                <label for="rate-first">First 40 paid slots · USD per slot/month</label
                ><input id="rate-first" v-model="firstRate" inputmode="decimal" required />
              </div>
              <div class="setting-field">
                <label for="rate-next">Next 200 paid slots · USD per slot/month</label
                ><input id="rate-next" v-model="nextRate" inputmode="decimal" required />
              </div>
              <div class="setting-field">
                <label for="rate-rest">Further paid slots · USD per slot/month</label
                ><input id="rate-rest" v-model="restRate" inputmode="decimal" required />
              </div>
            </div>
            <button>Sign new subscription pricing</button>
          </fieldset>
        </form>
        <form
          class="panel settings-card"
          aria-labelledby="platform-resources"
          @submit.prevent="resources"
        >
          <h2 id="platform-resources">RAM fees and pinned storage policy</h2>
          <p>
            Set prices for new agreements. Existing subscriptions keep their accepted pricing. RAM
            purchases use one rail-specific markup; the two percentages are not added together.
          </p>
          <fieldset :disabled="!canSign || !newPoliciesReady">
            <div class="setting-fields">
              <div class="setting-field">
                <label for="ram-native-fee">TLOS RAM purchase fee (%)</label>
                <input
                  id="ram-native-fee"
                  v-model="nativeRamPercent"
                  type="text"
                  inputmode="decimal"
                  required
                />
              </div>
              <div class="setting-field">
                <label for="ram-card-fee">Card RAM operational markup (%)</label>
                <input
                  id="ram-card-fee"
                  v-model="cardRamPercent"
                  type="text"
                  inputmode="decimal"
                  required
                />
              </div>
              <div class="setting-field">
                <label for="storage-free">Free pinned storage per DAO (MB)</label>
                <input
                  id="storage-free"
                  v-model="storageFreeMb"
                  type="text"
                  inputmode="decimal"
                  required
                />
              </div>
              <div class="setting-field">
                <label for="storage-unit">Additional storage unit (GB)</label>
                <input
                  id="storage-unit"
                  v-model="storageUnitGb"
                  type="text"
                  inputmode="decimal"
                  required
                />
              </div>
              <div class="setting-field">
                <label for="storage-price">Monthly price per additional unit (USD)</label>
                <input
                  id="storage-price"
                  v-model="storageUnitUsd"
                  type="text"
                  inputmode="decimal"
                  required
                />
              </div>
            </div>
            <button>Sign resource policy update</button>
          </fieldset>
          <p class="field-help">
            1 MB = 1,000,000 bytes; 1 GB = 1,000,000,000 bytes. Archives and old versions use the
            same storage rate. Pricing changes do not buy provider capacity or allocate RAM. Storage
            purchases and subscriptions are managed separately.
          </p>
          <RouterLink to="/docs/platform">Resource policy and authority guide ↗</RouterLink>
        </form>
      </div>
    </div>
    <div
      v-show="tab === 'catalogue'"
      id="platform-panel-catalogue"
      role="tabpanel"
      aria-labelledby="platform-tab-catalogue"
      tabindex="0"
    >
      <section class="panel settings-card" aria-labelledby="registered-modules">
        <div class="panel-heading">
          <h2 id="registered-modules">Registered modules</h2>
          <span class="platform-tag">{{ catalogue?.modules.length ?? 0 }} entries</span>
        </div>
        <label for="catalogue-search" class="sr-only">Search registered modules</label>
        <div class="catalogue-search">
          <Search :size="18" aria-hidden="true" /><input
            id="catalogue-search"
            v-model="search"
            type="search"
            placeholder="Search by module name or account"
          />
        </div>
        <p v-if="!catalogue?.modules.length">No catalogue entries are available.</p>
        <p v-else-if="!filteredModules.length">No modules match your search.</p>
        <ul v-else class="catalogue-list">
          <li v-for="module in filteredModules" :key="module.account">
            <div class="catalogue-name">
              <strong>{{ module.title }}</strong
              ><small>{{ module.account }} · {{ module.party }}</small>
            </div>
            <span class="catalogue-price">{{ module.price }}<small>Native usage price</small></span>
            <div class="catalogue-actions">
              <button
                type="button"
                class="button secondary"
                :aria-label="'Edit ' + module.title"
                @click="editModule(module)"
              >
                Edit</button
              ><button
                type="button"
                class="text-button"
                :aria-label="'Remove ' + module.account + ' from catalogue'"
                :disabled="!canSign"
                @click="remove(module.account)"
              >
                Remove
              </button>
            </div>
          </li>
        </ul>
        <p class="field-help">
          Removal blocks new installations. Existing installations, obligations and withdrawals
          remain intact. Publishers control third-party prices.
        </p>
      </section>
      <div class="platform-grid">
        <form
          class="panel settings-card"
          aria-labelledby="platform-register"
          @submit.prevent="register"
        >
          <h2 id="platform-register">Register or update a Daclify module</h2>
          <fieldset :disabled="!canSign">
            <div class="setting-fields">
              <div class="setting-field">
                <label for="module-account">Native module account</label
                ><input id="module-account" v-model="account" required maxlength="13" />
              </div>
              <div class="setting-field">
                <label for="module-title">Title</label
                ><input id="module-title" v-model="title" required maxlength="64" />
              </div>
              <div class="setting-field">
                <label for="module-price">Usage price (native asset)</label
                ><input id="module-price" v-model="price" required maxlength="64" />
              </div>
              <div class="setting-field">
                <label for="module-hash">Verified deployed WASM hash</label
                ><input id="module-hash" v-model="codeHash" required pattern="[0-9a-f]{64}" />
              </div>
              <p class="field-help">
                The contract verifies this hash and the platform fee rule. First-party publisher is
                the configured fee treasury. Registration does not install it in every DAO.
              </p>
            </div>
            <button>Sign module registration</button>
          </fieldset>
        </form>
        <form
          class="panel settings-card"
          aria-labelledby="platform-describe"
          @submit.prevent="describe"
        >
          <h2 id="platform-describe">Daclify module description</h2>
          <fieldset :disabled="!canSign">
            <div class="setting-fields">
              <div class="setting-field">
                <label for="copy-account">Native module account</label
                ><input id="copy-account" v-model="account" required maxlength="13" />
              </div>
              <div class="setting-field">
                <label for="module-summary">Summary</label
                ><textarea id="module-summary" v-model="summary" required maxlength="160" />
              </div>
              <div class="setting-field">
                <label for="module-detail">Details</label
                ><textarea id="module-detail" v-model="detail" required maxlength="2000" />
              </div>
            </div>
            <button>Sign description update</button>
          </fieldset>
        </form>
      </div>
    </div>
    <div
      v-show="tab === 'policies'"
      id="platform-panel-policies"
      role="tabpanel"
      aria-labelledby="platform-tab-policies"
      tabindex="0"
    >
      <div class="platform-grid">
        <form class="panel settings-card" aria-labelledby="platform-fees" @submit.prevent="fees">
          <h2 id="platform-fees">Shared hosting policy</h2>
          <p>
            DAO creation is free. Existing members retain their rights when paid capacity expires.
            Changing the settler requires matching server configuration.
          </p>
          <fieldset :disabled="!canSign || !newPoliciesReady">
            <div class="setting-fields">
              <div class="setting-field">
                <label for="free-slots">Included active member slots</label
                ><input
                  id="free-slots"
                  v-model.number="freeSlots"
                  type="number"
                  min="1"
                  max="5000"
                  required
                />
              </div>
              <div class="setting-field">
                <label for="hosting-settler">Trusted payment settler account</label
                ><input id="hosting-settler" v-model="settler" required maxlength="13" />
              </div>
            </div>
            <button>Sign hosting policy update</button>
          </fieldset>
          <RouterLink to="/docs/shared-hosting">Hosting guide ↗</RouterLink>
        </form>
        <form
          class="panel settings-card"
          aria-labelledby="platform-connectFees"
          @submit.prevent="connectFees"
        >
          <h2 id="platform-connectFees">Daclify Connect commission</h2>
          <p>
            Default 5%. Applies only to eligible DAO module card checkouts processed through
            Connect. Existing orders retain their captured fee; Stripe processing fees are separate.
          </p>
          <fieldset :disabled="!canSign || !newPoliciesReady">
            <div class="setting-fields">
              <div class="setting-field">
                <label for="connect-percent">Connect commission (%)</label
                ><input
                  id="connect-percent"
                  v-model.number="connectPercent"
                  type="number"
                  min="0"
                  max="99.99"
                  step="0.01"
                  required
                />
              </div>
            </div>
            <button>Sign Connect commission update</button>
          </fieldset>
          <RouterLink to="/docs/payments">Payment guide ↗</RouterLink>
        </form>
        <form
          class="panel settings-card"
          aria-labelledby="platform-commissions"
          @submit.prevent="commissions"
        >
          <h2 id="platform-commissions">Module commissions and names</h2>
          <fieldset :disabled="!canSign">
            <div class="setting-fields">
              <div class="setting-field">
                <label for="fee-third">Third-party platform cut (basis points)</label
                ><input
                  id="fee-third"
                  v-model.number="thirdParty"
                  type="number"
                  min="0"
                  max="10000"
                  required
                />
              </div>
              <div class="setting-field">
                <label for="fee-first">Daclify module platform cut (basis points)</label
                ><input
                  id="fee-first"
                  v-model.number="firstParty"
                  type="number"
                  min="0"
                  max="10000"
                  required
                />
              </div>
              <div class="setting-field">
                <label for="fee-bump">Name resale price increase (basis points)</label
                ><input
                  id="fee-bump"
                  v-model.number="bump"
                  type="number"
                  min="0"
                  max="10000"
                  required
                />
              </div>
              <div class="setting-field">
                <label for="name-premium">Name TLOS conversion premium (basis points)</label
                ><input
                  id="name-premium"
                  v-model.number="namePremium"
                  type="number"
                  min="0"
                  max="10000"
                  required
                />
              </div>
            </div>
            <button>Sign commission policy</button>
          </fieldset>
          <RouterLink to="/modules">View modules ↗</RouterLink>
          <RouterLink to="/names">View name offerings ↗</RouterLink>
        </form>
      </div>
      <details class="platform-authority">
        <summary>Authority and operator controls</summary>
        <p>
          These controls use administrator authority. They do not automatically execute member
          ballots. Native contract upgrades, fee treasury and conversion observations remain
          operator-controlled. <RouterLink to="/docs/platform">Authority guide ↗</RouterLink>
        </p>
      </details>
    </div>
  </div>
</template>
<style scoped>
.platform-manager {
  min-width: 0;
}
.platform-heading {
  margin-bottom: 20px;
  gap: 16px;
}
.platform-heading h2 {
  margin-bottom: 6px;
  font-size: 24px;
}
.platform-access {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 12px;
  margin-bottom: 16px;
}
.platform-access svg {
  color: var(--accent-amber);
  flex: none;
}
.platform-access strong {
  color: var(--text-primary);
}
.platform-reference {
  margin-left: auto;
  overflow-wrap: anywhere;
}
.platform-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin: 0 0 24px;
}
.platform-summary > div {
  border-left: 2px solid var(--line);
  padding-left: 14px;
  min-width: 0;
}
.platform-summary dt {
  color: var(--muted);
  font-size: 11px;
}
.platform-summary dd {
  margin: 4px 0;
  font-size: 22px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.platform-summary small {
  display: block;
  color: var(--text-secondary);
  font-size: 11px;
}
.platform-tabs {
  border-bottom: 1px solid var(--line);
  padding-bottom: 14px;
  margin-bottom: 18px;
}
.platform-tabs button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 44px;
}
.platform-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.settings-card {
  max-width: none;
  padding: 20px;
  margin-bottom: 16px;
  min-width: 0;
}
.platform-grid > .settings-card {
  margin-bottom: 0;
}
.settings-card h2 {
  font-size: 16px;
  margin-bottom: 8px;
}
.settings-card .panel-heading h2 {
  margin: 0;
}
.settings-card p {
  font-size: 12px;
  line-height: 1.6;
}
.settings-card fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.settings-card button {
  font-size: 12px;
  min-height: 44px;
  padding: 9px 14px;
}
.settings-card > a {
  display: inline-block;
  font-size: 12px;
  margin: 12px 12px 0 0;
}
.platform-tag {
  font-size: 11px;
  color: var(--accent-amber);
  background: var(--accent-soft);
  padding: 5px 9px;
  border-radius: var(--radius-pill);
}
.setting-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.setting-field {
  min-width: 0;
}
.setting-field label {
  margin: 0 0 6px;
  font-size: 12px;
}
.setting-field input,
.setting-field textarea {
  font-size: 13px;
  padding: 10px;
}
.setting-field:has(textarea),
.setting-field:has(#module-hash),
.setting-field:has(#hosting-settler) {
  grid-column: 1/-1;
}
.setting-fields > p {
  grid-column: 1/-1;
  margin: 0;
}
.module-price-form + .module-price-form {
  border-top: 1px solid var(--line);
}
.module-price-form fieldset {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 100px;
  gap: 16px;
  align-items: center;
  padding: 10px 0;
}
.module-price-form label {
  font-size: 13px;
  margin: 0;
}
.module-price-form small,
.catalogue-list small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  font-weight: 400;
  overflow-wrap: anywhere;
  margin-top: 3px;
}
.module-price-form button {
  white-space: nowrap;
}
.module-price-input {
  position: relative;
}
.module-price-input > span {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  color: var(--muted);
  pointer-events: none;
}
.module-price-input input {
  padding: 10px 10px 10px 26px;
  font-size: 13px;
}
.catalogue-search {
  position: relative;
  margin: 16px 0;
}
.catalogue-search svg {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
}
.catalogue-search input {
  padding-left: 38px;
  font-size: 13px;
}
.catalogue-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.catalogue-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(120px, auto) auto;
  gap: 16px;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.catalogue-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.catalogue-price {
  font-size: 12px;
}
.catalogue-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.catalogue-actions .text-button {
  padding: 8px;
  color: var(--text-secondary);
}
.platform-authority {
  margin-top: 20px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  font-size: 12px;
}
.platform-authority p {
  color: var(--text-secondary);
  margin: 12px 0 0;
  line-height: 1.6;
}
@media (max-width: 900px) {
  .platform-grid {
    grid-template-columns: 1fr;
  }
  .platform-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .platform-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .platform-heading .button-row {
    flex-wrap: wrap;
  }
  .platform-reference {
    margin-left: 0;
    width: 100%;
  }
  .platform-summary {
    gap: 16px 10px;
  }
  .platform-summary dd {
    font-size: 19px;
  }
  .platform-tabs {
    gap: 6px;
  }
  .platform-tabs button {
    padding: 8px 12px;
    flex: 1;
  }
  .settings-card {
    padding: 16px;
  }
  .settings-card .panel-heading {
    flex-wrap: wrap;
  }
  .setting-fields {
    grid-template-columns: 1fr;
  }
  .module-price-form fieldset {
    grid-template-columns: minmax(0, 1fr) 86px;
    gap: 10px;
  }
  .module-price-form button {
    grid-column: 1/-1;
    justify-self: end;
  }
  .catalogue-list li {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
  }
  .catalogue-price {
    grid-column: 1;
  }
  .catalogue-actions {
    grid-column: 2;
    grid-row: 1/3;
    flex-direction: column;
    gap: 2px;
  }
}
</style>
