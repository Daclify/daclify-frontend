<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  HostedPricingSchema,
  hostedMonthlyPrice,
  type PlatformStatus,
  type ModuleFeePricing,
} from '@daclify/core-protocol';
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';

const workspace = useWorkspace();
const status = ref<PlatformStatus>();
const modulePricing = ref<ModuleFeePricing>(),
  moduleError = ref('');
const verifiedModules = computed(
  () =>
    modulePricing.value?.chainId === workspace.network?.chainId &&
    modulePricing.value?.runtime === workspace.network?.runtime,
);
const busy = ref(false),
  error = ref('');
const chain = computed(() => status.value?.chain);
const memberPricing = computed(() => {
  const value = HostedPricingSchema.safeParse({
    freeSlots: chain.value?.hosting?.free_members,
    rates: chain.value?.seatPricing,
  });
  return value.success ? value.data : null;
});
const monthlyExamples = computed(() => {
  const pricing = memberPricing.value;
  return pricing
    ? [0, 40, 90, 290]
        .filter((extra) => pricing.freeSlots + extra <= 5000)
        .map((extra) => ({
          members: pricing.freeSlots + extra,
          cents: hostedMonthlyPrice(extra, pricing),
        }))
    : [];
});
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
  modulePricing.value = undefined;
  moduleError.value = '';
  busy.value = true;
  error.value = '';
  try {
    const [platform, modules] = await Promise.allSettled([
      api.platformStatus(),
      api.moduleFeePricing(),
    ]);
    if (current !== sequence) return;
    if (platform.status === 'rejected') throw platform.reason;
    status.value = platform.value;
    if (modules.status === 'fulfilled') modulePricing.value = modules.value;
    else moduleError.value = friendlyError(modules.reason);
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
        <h2 id="member-pricing">Monthly membership pricing</h2>
        <template v-if="memberPricing">
          <p class="price-highlight">Up to {{ memberPricing.freeSlots }} members free</p>
          <dl v-if="memberPricing.freeSlots < 5000" class="fact-list">
            <template v-if="memberPricing.freeSlots < 5000">
              <dt>
                Members {{ memberPricing.freeSlots + 1 }}–{{
                  Math.min(memberPricing.freeSlots + 40, 5000)
                }}
              </dt>
              <dd>{{ money(memberPricing.rates.first_usd) }} each / month</dd>
            </template>
            <template v-if="memberPricing.freeSlots + 40 < 5000">
              <dt>
                Members {{ memberPricing.freeSlots + 41 }}–{{
                  Math.min(memberPricing.freeSlots + 240, 5000)
                }}
              </dt>
              <dd>{{ money(memberPricing.rates.next_usd) }} each / month</dd>
            </template>
            <template v-if="memberPricing.freeSlots + 240 < 5000">
              <dt>Members {{ memberPricing.freeSlots + 241 }}+</dt>
              <dd>{{ money(memberPricing.rates.rest_usd) }} each / month</dd>
            </template>
          </dl>
          <p class="field-help">
            Only places above the free allowance are charged. Add the cost of each range together to
            get your monthly total.
          </p>
          <table class="membership-examples">
            <caption>
              Example monthly totals
            </caption>
            <thead>
              <tr>
                <th scope="col">Member places</th>
                <th scope="col">Total / month</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="example in monthlyExamples" :key="example.members">
                <td>{{ example.members }}</td>
                <td>{{ example.cents === 0 ? 'Free' : money(example.cents) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="field-help">
            These totals cover membership only. Your DAO pays for approved member places, including
            empty places.
          </p>
        </template>
        <p v-else>Member pricing is not reported for this network.</p>
        <RouterLink to="/hosting">Manage member places ↗</RouterLink>
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
        <template v-if="verifiedModules && modulePricing">
          <p class="price-highlight">
            All existing modules free through {{ modulePricing.freeMembers }} active members
          </p>
          <p>
            Above {{ modulePricing.freeMembers }} members, each enabled module has its own monthly
            fee per DAO.
          </p>
          <dl v-if="modulePricing.plans.length" class="fact-list">
            <template v-for="plan in modulePricing.plans" :key="plan.pricing.account">
              <dt>{{ plan.title }}</dt>
              <dd>
                {{
                  plan.pricing.monthlyUsdCents === 0
                    ? 'Free'
                    : money(plan.pricing.monthlyUsdCents) + ' / DAO / month'
                }}
              </dd>
            </template>
          </dl>
          <p v-else>Monthly module fees have not been configured on this network.</p>
          <p v-if="modulePricing.plans.length">
            All listed modules:
            {{
              money(
                modulePricing.plans.reduce((sum, plan) => sum + plan.pricing.monthlyUsdCents, 0),
              )
            }}
            / DAO / month above {{ modulePricing.freeMembers }} members.
          </p>
          <p class="field-help">
            An administrator buys one calendar month; renewal is manual. Existing votes, completion
            and payouts remain available after expiry. Member capacity and storage are separate.
          </p>
        </template>
        <p v-else role="status">Monthly module pricing is unavailable. {{ moduleError }}</p>
        <RouterLink to="/module-access">Manage a DAO’s module access ↗</RouterLink>
        <p class="field-help">Work, payroll and grant funding are separate from module access.</p>
        <details v-if="chain.catalogue.length">
          <summary>Catalogue usage prices</summary>
          <dl class="fact-list">
            <template v-for="module in chain.catalogue" :key="module.account"
              ><dt>{{ module.title || module.account }}</dt>
              <dd>{{ module.price }}</dd></template
            >
          </dl>
          <p>Native token usage prices apply separately where configured.</p>
        </details>
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
.membership-examples {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.membership-examples caption {
  text-align: left;
  font-weight: 700;
  margin-bottom: 8px;
}
.membership-examples th,
.membership-examples td {
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
@media (max-width: 55rem) {
  .pricing-grid {
    grid-template-columns: 1fr;
  }
}
</style>
