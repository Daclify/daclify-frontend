<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import {
  PaymentQuerySchema,
  hostedMonthlyPrice,
  hostedPricingHash,
  type HostingStatus,
  daoPaymentKey,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import ActionSigner from '../components/ActionSigner.vue';
import { canSignMember } from '../auth/action-signer';
const route = useRoute(),
  state = useWorkspace(),
  status = ref<HostingStatus>(),
  extra = ref(1),
  acceptCurrent = ref(false),
  consent = ref(false),
  busy = ref(false),
  error = ref('');
const dao = computed(() => {
  const value = PaymentQuerySchema.safeParse({ dao: route.query.dao });
  return value.success ? value.data.dao : null;
});
const member = computed(() =>
  state.memberships.find(
    (m) => dao.value && daoPaymentKey(m.dao) === daoPaymentKey(dao.value) && m.active && m.admin,
  ),
);
const pricing = computed(() =>
  acceptCurrent.value
    ? status.value?.pricing
    : (status.value?.subscription?.pricing ?? status.value?.pricing),
);
const quote = computed(() => {
  try {
    return pricing.value ? hostedMonthlyPrice(extra.value, pricing.value) : null;
  } catch {
    return null;
  }
});
const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
let sequence = 0;
async function load() {
  const current = ++sequence;
  busy.value = false;
  status.value = undefined;
  error.value = '';
  consent.value = false;
  acceptCurrent.value = false;
  if (!dao.value || !member.value) return;
  try {
    const value = await api.hostingStatus(dao.value);
    if (current === sequence) {
      status.value = value;
      extra.value =
        value.subscription?.pendingChange?.extraSlots ?? value.subscription?.extraSlots ?? 1;
    }
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  }
}
watch(() => JSON.stringify([dao.value, state.account?.id, member.value?.memberId]), load, {
  immediate: true,
});
watch([extra, acceptCurrent], () => {
  consent.value = false;
});
onBeforeUnmount(() => sequence++);
function retryKey(d: NonNullable<typeof dao.value>): string {
  return 'daclify.hosting.' + daoPaymentKey(d) + '.' + state.account?.id;
}
function requestId(
  d: NonNullable<typeof dao.value>,
  cancel: boolean,
  p: NonNullable<typeof pricing.value>,
  q: number,
): string {
  const subscription = status.value?.subscription;
  if (subscription?.state === 'pending') return subscription.requestId;
  const pending = subscription?.pendingChange;
  if (
    pending &&
    pending.extraSlots === (cancel ? 0 : extra.value) &&
    hostedPricingHash(pending.pricing) === hostedPricingHash(p)
  )
    return pending.requestId;
  const key = retryKey(d),
    body = JSON.stringify([
      subscription?.id ?? null,
      cancel ? 0 : extra.value,
      hostedPricingHash(p),
      q,
      acceptCurrent.value,
    ]);
  const saved = sessionStorage.getItem(key);
  if (saved) {
    const value: unknown = JSON.parse(saved);
    if (
      typeof value === 'object' &&
      value !== null &&
      'body' in value &&
      value.body === body &&
      'id' in value &&
      typeof value.id === 'string'
    )
      return value.id;
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, JSON.stringify({ id, body }));
  return id;
}
async function change(cancel = false) {
  const d = dao.value,
    p = cancel ? status.value?.subscription?.pricing : pricing.value,
    q = cancel ? 0 : quote.value;
  if (!d || !p || q === null || q === undefined || (!cancel && !consent.value)) return;
  const current = sequence;
  busy.value = true;
  error.value = '';
  try {
    const value = await api.hostingChange({
      dao: d,
      requestId: requestId(d, cancel, p, q),
      extraSlots: cancel ? 0 : extra.value,
      pricingHash: hostedPricingHash(p),
      monthlyUsdCents: q,
      acceptCurrentPricing: cancel ? false : acceptCurrent.value,
    });
    if (current === sequence) {
      sessionStorage.removeItem(retryKey(d));
      status.value = value;
      consent.value = false;
    }
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  } finally {
    if (current === sequence) busy.value = false;
  }
}
function checkout() {
  const value = status.value?.subscription?.checkoutUrl;
  if (!value) return;
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'checkout.stripe.com' ||
    url.username ||
    url.password ||
    url.port
  ) {
    error.value = 'The checkout address was not accepted.';
    return;
  }
  window.location.assign(url.toString());
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">SHARED HOSTING</p>
      <h1>Member capacity</h1>
      <p class="lead">
        Choose the capacity your DAO needs. Membership never triggers a charge automatically.
      </p>
    </div>
    <RouterLink to="/docs/shared-hosting" class="help-link">Pricing and billing guide ↗</RouterLink>
  </div>
  <p v-if="error" id="hosting-error" role="alert" class="alert">{{ error }}</p>
  <section v-if="!dao" class="panel">
    <h2>Choose a DAO first</h2>
    <RouterLink to="/">Open the DAO hub</RouterLink>
  </section>
  <section v-else-if="!member" class="panel">
    <h2>Administrator access required</h2>
    <p>Sign in as a current administrator of this DAO to manage its subscription.</p>
    <RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }">Sign in</RouterLink>
  </section>
  <template v-else>
    <ActionSigner :member="member" />
    <section v-if="status" class="panel narrow">
      <h2>Your current capacity</h2>
      <dl class="fact-list">
        <dt>Active members</dt>
        <dd>{{ status.activeMembers }}</dd>
        <dt>Included slots for new subscriptions</dt>
        <dd>{{ status.pricing.freeSlots }}</dd>
        <dt>Effective on-chain capacity</dt>
        <dd>{{ status.effectiveCapacity }}</dd>
        <dt>Paid capacity ends</dt>
        <dd>
          {{ status.expires ? new Date(status.expires * 1000).toLocaleString() : 'No paid period' }}
        </dd>
      </dl>
      <p v-if="status.activeMembers >= status.effectiveCapacity" class="notice">
        Your DAO has reached its allowance. Additional admissions and reactivations need more
        capacity. Existing members keep their rights.
      </p>
      <p v-if="status.exempt">
        The Daclify platform DAO is exempt from shared-hosting capacity billing.
      </p>
      <p v-else-if="!status.configured" class="notice">
        Card subscriptions are not configured on this operator. Free membership remains available.
      </p>
      <template v-if="status.subscription"
        ><h3>Accepted subscription</h3>
        <p>
          {{ status.subscription.pricing.freeSlots }} included +
          {{ status.subscription.extraSlots }} paid slots =
          {{ status.subscription.pricing.freeSlots + status.subscription.extraSlots }} total ·
          <strong>{{ dollars(status.subscription.monthlyUsdCents) }} / month</strong>
        </p>
        <p>Status: {{ status.subscription.state }}. Your accepted rates remain in force.</p>
        <p v-if="status.subscription.pendingChange" role="status">
          Pending: {{ status.subscription.pendingChange.extraSlots }} paid slots ·
          {{ dollars(status.subscription.pendingChange.monthlyUsdCents) }} / month. Additional
          capacity waits for payment settlement.
        </p>
        <button
          v-if="status.subscription.state === 'pending' && status.subscription.checkoutUrl"
          :disabled="busy"
          @click="checkout"
        >
          Continue secure Stripe checkout</button
        ><a
          v-if="status.subscription.invoiceUrl"
          :href="status.subscription.invoiceUrl"
          target="_blank"
          rel="noopener noreferrer"
          >Open latest Stripe invoice ↗</a
        ><button
          v-if="status.subscription.state === 'active' || status.subscription.state === 'past-due'"
          class="secondary"
          :disabled="busy || !!status.subscription?.pendingChange || !canSignMember(member)"
          @click="change(true)"
        >
          Stop renewal after this paid period
        </button></template
      >
      <form
        v-if="
          !status.exempt &&
          !status.subscription?.pendingChange &&
          (status.subscription?.state !== 'pending' || !status.subscription.checkoutUrl) &&
          status.subscription?.state !== 'canceling'
        "
        @submit.prevent="change()"
      >
        <h3>Approve paid capacity</h3>
        <label for="paid-slots">Additional paid slots</label
        ><input
          id="paid-slots"
          v-model.number="extra"
          type="number"
          min="1"
          :max="5000 - (pricing?.freeSlots ?? 10)"
          required
          :disabled="busy || status.subscription?.state === 'pending'"
        />
        <label
          v-if="
            status.subscription &&
            hostedPricingHash(status.subscription.pricing) !== hostedPricingHash(status.pricing)
          "
          class="choice"
          ><input v-model="acceptCurrent" type="checkbox" :disabled="busy" /><span
            >Explicitly switch to the current Daclify price schedule</span
          ></label
        >
        <p v-if="pricing">
          {{ pricing.freeSlots }} included + {{ extra }} paid =
          {{ pricing.freeSlots + extra }} total slots.
        </p>
        <p v-if="pricing">
          Paid slots 1–40: {{ dollars(pricing.rates.first_usd) }} each; 41–240:
          {{ dollars(pricing.rates.next_usd) }} each; above 240:
          {{ dollars(pricing.rates.rest_usd) }} each per month.
        </p>
        <p>
          <strong>{{
            quote === null ? 'Choose a valid capacity' : dollars(quote) + ' / month'
          }}</strong>
          · USD card billing. Storage, AI and blockchain resources are separate.
        </p>
        <p v-if="status.subscription">
          Increases are prorated and invoiced immediately; activation waits for payment. Decreases
          reduce future bills without unused-period credits and retain already-paid capacity until
          renewal.
        </p>
        <label class="choice"
          ><input v-model="consent" type="checkbox" required :disabled="busy" /><span
            >I approve this capacity and recurring monthly price.</span
          ></label
        >
        <button
          :disabled="
            busy || !consent || quote === null || !status.configured || !canSignMember(member)
          "
        >
          {{
            busy
              ? 'Submitting…'
              : status.subscription
                ? 'Approve subscription change'
                : 'Approve and prepare card checkout'
          }}
        </button>
      </form>
      <button class="secondary" :disabled="busy" @click="load">Refresh capacity and billing</button>
      <p class="field-help">
        Payment expiry blocks excess admissions and reactivations. It never removes existing
        members, votes, withdrawals, documents or recovery access. Payment settlement may take a
        short time to reach the blockchain.
      </p>
    </section>
  </template>
</template>
