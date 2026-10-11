<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { PlatformStatus } from '@daclify/core-protocol';
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';

const workspace = useWorkspace();
const status = ref<PlatformStatus>();
const busy = ref(false),
  error = ref('');
const chain = computed(() => status.value?.chain);
const verified = computed(
  () =>
    status.value?.rpc === 'reachable' &&
    chain.value?.chainMatches === true &&
    chain.value.network.chainId === workspace.network?.chainId &&
    chain.value.network.runtime === workspace.network?.runtime &&
    chain.value.contracts.some(
      (contract) => contract.account === chain.value?.network.runtime && contract.verified,
    ),
);
const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const percent = (bps: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(bps / 100) + '%';
function bytes(value: string) {
  const amount = BigInt(value);
  for (const [unit, scale] of [
    ['GB', 1000000000n],
    ['MB', 1000000n],
    ['KB', 1000n],
  ] as const)
    if (amount >= scale && amount % scale === 0n)
      return (amount / scale).toLocaleString() + ' ' + unit;
  return amount.toLocaleString() + ' bytes';
}
let sequence = 0;
async function load() {
  const current = ++sequence;
  status.value = undefined;
  busy.value = true;
  error.value = '';
  try {
    const value = await api.platformStatus();
    if (current === sequence) status.value = value;
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  } finally {
    if (current === sequence) busy.value = false;
  }
}
onMounted(load);
watch(
  () =>
    workspace.network &&
    [
      workspace.network.chainId,
      workspace.network.runtime,
      workspace.network.rpcUrl,
      workspace.network.environment,
    ].join('/'),
  (_network, previous) => {
    if (previous !== undefined) void load();
  },
);
onUnmounted(() => {
  sequence++;
});
</script>

<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">PLAN YOUR COMMUNITY</p>
      <h1>DAO pricing</h1>
      <p class="lead">
        Current setup, member capacity, storage and service prices for this network.
      </p>
    </div>
    <button type="button" class="secondary" :disabled="busy" @click="load">
      <RefreshCw :size="18" aria-hidden="true" />{{ busy ? 'Checking prices…' : 'Refresh prices' }}
    </button>
  </div>
  <RouterLink class="help-link" to="/create"
    ><ArrowLeft :size="16" aria-hidden="true" />Create a DAO</RouterLink
  >
  <p v-if="busy" role="status">Loading current pricing…</p>
  <div v-else-if="error" class="alert" role="alert">
    <strong>Could not load DAO pricing.</strong>
    <p>{{ error }} Use Refresh prices to try again.</p>
  </div>
  <div v-else-if="status && !verified" class="alert" role="alert">
    <strong>Pricing could not be verified for this network.</strong>
    <p>The chain or deployed contracts could not be verified. Refresh prices to check again.</p>
  </div>
  <div v-if="verified && chain && status" class="pricing-page">
    <p class="pricing-meta">
      Checked
      <time :datetime="status.checkedAt">{{ new Date(status.checkedAt).toLocaleString() }}</time> ·
      {{ chain.network.environment }}
    </p>
    <p class="notice">
      These are current rates for new approvals. Existing DAO subscriptions can retain a previously
      approved schedule. Review the exact quote before approving a payment.
    </p>

    <div class="pricing-grid">
      <section class="panel" aria-labelledby="setup-pricing">
        <h2 id="setup-pricing">DAO setup</h2>
        <dl class="fact-list">
          <dt>Shared contracts and hosting</dt>
          <dd>
            {{
              chain.creation
                ? money(chain.creation.shared_usd) + ' setup'
                : 'Setup pricing is not reported'
            }}
          </dd>
          <dt>Your contracts and server</dt>
          <dd>Contact for pricing</dd>
          <dt>Your complete DAO portal</dt>
          <dd>Contact for pricing</dd>
        </dl>
        <p v-if="!chain.sharedAvailable" class="field-help">
          Shared creation is currently unavailable on this network.
        </p>
        <p class="field-help">
          Independent deployments are quoted individually; you operate their contracts, resources
          and hosting.
        </p>
        <a href="https://t.me/daclify" target="_blank" rel="noopener noreferrer"
          >Ask about independent deployment ↗</a
        >
      </section>

      <section class="panel" aria-labelledby="member-pricing">
        <h2 id="member-pricing">Monthly member capacity</h2>
        <template v-if="chain.hosting && chain.seatPricing">
          <p class="price-highlight">{{ chain.hosting.free_members }} included member slots</p>
          <dl class="fact-list">
            <dt>Paid slots 1–40</dt>
            <dd>{{ money(chain.seatPricing.first_usd) }} / slot / month</dd>
            <dt>Paid slots 41–240</dt>
            <dd>{{ money(chain.seatPricing.next_usd) }} / slot / month</dd>
            <dt>Paid slots above 240</dt>
            <dd>{{ money(chain.seatPricing.rest_usd) }} / slot / month</dd>
          </dl>
          <p class="field-help">
            Paid slots start after the included slots. Tiers are graduated: each rate applies only
            to the slots in that tier. Billing covers approved capacity, including unused slots.
          </p>
        </template>
        <p v-else>Member pricing is not reported for this network.</p>
        <RouterLink to="/hosting">Manage a DAO's member capacity ↗</RouterLink>
      </section>

      <section class="panel" aria-labelledby="storage-pricing">
        <h2 id="storage-pricing">Hosted storage</h2>
        <dl v-if="chain.resourcePolicy" class="fact-list">
          <dt>Included storage</dt>
          <dd>{{ bytes(chain.resourcePolicy.storage.freeBytes) }} / DAO</dd>
          <dt>Additional storage</dt>
          <dd>
            {{ money(chain.resourcePolicy.storage.monthlyUnitUsdCents) }} /
            {{ bytes(chain.resourcePolicy.storage.unitBytes) }} / month
          </dd>
        </dl>
        <p v-else>Storage pricing is not configured for this network.</p>
        <p class="field-help">
          Storage is billed separately from member capacity. Additional units require an approved
          subscription.
        </p>
        <RouterLink to="/resources">Manage storage and resources ↗</RouterLink>
      </section>

      <section class="panel" aria-labelledby="ram-pricing">
        <h2 id="ram-pricing">Blockchain resources</h2>
        <dl v-if="chain.resourcePolicy" class="fact-list">
          <dt>RAM purchase with TLOS</dt>
          <dd>Market cost + {{ percent(chain.resourcePolicy.nativeRamBps) }}</dd>
          <dt>RAM purchase by card</dt>
          <dd>Market cost + {{ percent(chain.resourcePolicy.cardRamBps) }}</dd>
          <dt>Included activity RAM</dt>
          <dd>{{ bytes(chain.resourcePolicy.includedActivityBytes) }} / DAO</dd>
          <dt>Identity RAM per member slot</dt>
          <dd>{{ bytes(chain.resourcePolicy.identityBytesPerSlot) }}</dd>
        </dl>
        <p v-else>RAM top-up pricing is not configured for this network.</p>
        <p class="field-help">
          RAM has a variable market price. CPU and NET costs depend on the resources funded for the
          deployment; a purchase quote shows the actual amount.
        </p>
      </section>

      <section class="panel" aria-labelledby="payment-pricing">
        <h2 id="payment-pricing">Payments and conversion</h2>
        <dl class="fact-list">
          <dt>Daclify Connect commission</dt>
          <dd>
            {{
              chain.paymentPolicy ? percent(chain.paymentPolicy.bps) : 'Commission is not reported'
            }}
          </dd>
          <dt>TLOS conversion premium</dt>
          <dd>
            {{ chain.creation ? percent(chain.creation.premium_bps) : 'Premium is not reported' }}
          </dd>
          <dt>TLOS conversion rate</dt>
          <dd>
            {{
              chain.rateFresh
                ? 'Current · final amount shown in the quote'
                : 'Unavailable or stale · refresh before requesting a TLOS quote'
            }}
          </dd>
        </dl>
        <p class="field-help">
          Payment-provider charges can apply separately. Each product's quote uses its applicable
          conversion policy.
        </p>
      </section>

      <section class="panel" aria-labelledby="module-pricing">
        <h2 id="module-pricing">Module prices</h2>
        <dl v-if="chain.catalogue.length" class="fact-list">
          <template v-for="module in chain.catalogue" :key="module.account">
            <dt>{{ module.title || module.account }}</dt>
            <dd>{{ module.price }}</dd>
          </template>
        </dl>
        <p v-else>No module prices are published on this network.</p>
        <p class="field-help">
          Listed prices are in the module's payment token. Funding work, payroll or grants is
          separate from the module price.
        </p>
        <RouterLink to="/modules">Explore modules ↗</RouterLink>
      </section>
    </div>

    <details class="panel">
      <summary>Other configured prices and fee shares</summary>
      <dl class="fact-list">
        <dt>Legacy independent setup value</dt>
        <dd>
          {{ chain.creation ? money(chain.creation.independent_usd) : 'Not reported' }} ·
          independent deployments require a separate quote.
        </dd>
        <dt>Daclify share of third-party module payments</dt>
        <dd>{{ chain.fees ? percent(chain.fees.third_party_bps) : 'Not reported' }}</dd>
        <dt>Daclify share of its own module payments</dt>
        <dd>{{ chain.fees ? percent(chain.fees.first_party_bps) : 'Not reported' }}</dd>
        <template v-if="chain.market">
          <dt>Name resale increase</dt>
          <dd>{{ percent(chain.market.bump_bps) }}</dd>
          <dt>Name resale conversion premium</dt>
          <dd>{{ percent(chain.market.quote_premium_bps) }}</dd>
        </template>
      </dl>
      <p class="field-help">
        Module fee shares divide the listed payment; they are not an extra charge on top. Name
        purchases use a separate live quote. AI and other optional services are quoted by their
        provider.
      </p>
    </details>
  </div>
</template>

<style scoped>
.pricing-page {
  margin-top: 24px;
}
.pricing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  margin-block: 24px;
}
.pricing-grid .panel {
  margin: 0;
}
.pricing-meta {
  color: var(--text-muted);
  font-size: 0.875rem;
}
.price-highlight {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent-amber);
}
@media (max-width: 55rem) {
  .pricing-grid {
    grid-template-columns: 1fr;
  }
}
</style>
