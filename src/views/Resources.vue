<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { z } from 'zod';
import {
  PaymentQuerySchema,
  StorageBillingStatusSchema,
  StorageUnitsSchema,
  monthlyStorageUsdCents,
  storageCapacity,
  storagePricingHash,
  daoPaymentKey,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { canSignMember } from '../auth/action-signer';
import ActionSigner from '../components/ActionSigner.vue';
import StorageUsagePanel from '../components/StorageUsagePanel.vue';
import ArchivePanel from '../components/ArchivePanel.vue';
import RamUsagePanel from '../components/RamUsagePanel.vue';
const route = useRoute(),
  state = useWorkspace();
const status = ref<z.infer<typeof StorageBillingStatusSchema>>(),
  extra = ref('1'),
  consent = ref(false),
  acceptCurrent = ref(false),
  busy = ref(false),
  error = ref(''),
  revision = ref(0);
const dao = computed(() => {
  const parsed = PaymentQuerySchema.safeParse({ dao: route.query.dao });
  return parsed.success ? parsed.data.dao : null;
});
const member = computed(() =>
  state.memberships.find(
    (m) => dao.value && daoPaymentKey(m.dao) === daoPaymentKey(dao.value) && m.active,
  ),
);
const pricing = computed(() =>
  acceptCurrent.value
    ? status.value?.currentPricing
    : (status.value?.subscription?.pricing ?? status.value?.currentPricing),
);
const units = computed(() => {
  if (!/^[1-9][0-9]{0,5}$/.test(extra.value)) return null;
  const result = StorageUnitsSchema.safeParse(Number(extra.value));
  return result.success ? result.data : null;
});
const quote = computed(() => {
  try {
    return units.value !== null && pricing.value
      ? {
          cents: monthlyStorageUsdCents(units.value, pricing.value),
          bytes: storageCapacity(units.value, pricing.value),
        }
      : null;
  } catch {
    return null;
  }
});
const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const bytes = (value: string | bigint) => `${BigInt(value).toLocaleString()} bytes`;
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'No paid period';
let sequence = 0;
async function load() {
  const request = ++sequence;
  status.value = undefined;
  error.value = '';
  busy.value = false;
  consent.value = false;
  acceptCurrent.value = false;
  revision.value++;
  if (!dao.value || !member.value?.admin) return;
  try {
    const result = await api.storageBilling(dao.value);
    if (request === sequence) {
      status.value = result;
      extra.value = String(result.subscription?.pending?.units || result.subscription?.units || 1);
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  }
}
watch(
  () => JSON.stringify([dao.value, state.account?.id, member.value?.memberId, member.value?.admin]),
  load,
  { immediate: true },
);
watch([extra, acceptCurrent], () => {
  consent.value = false;
});
onBeforeUnmount(() => sequence++);
function requestId(cancel: boolean, hash: string, count: number, cents: number) {
  const subscription = status.value?.subscription;
  if (subscription?.state === 'pending') return subscription.requestId;
  if (
    subscription?.pending?.units === count &&
    storagePricingHash(subscription.pending.pricing) === hash
  )
    return subscription.pending.requestId;
  const key = `daclify.storage.${dao.value ? daoPaymentKey(dao.value) : ''}.${state.account?.id}`;
  const body = JSON.stringify([
    subscription?.id ?? null,
    count,
    hash,
    cents,
    cancel ? false : acceptCurrent.value,
  ]);
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    const parsed = z.strictObject({ id: z.uuid(), body: z.string() }).safeParse(saved);
    if (parsed.success && parsed.data.body === body) return parsed.data.id;
  } catch {
    /* A damaged retry record does not grant consent. */
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, JSON.stringify({ id, body }));
  return id;
}
async function approve(cancel = false) {
  const d = dao.value,
    p = cancel ? status.value?.subscription?.pricing : pricing.value,
    q = cancel ? 0 : quote.value?.cents,
    count = cancel ? 0 : units.value;
  if (
    !d ||
    !p ||
    q === undefined ||
    count === null ||
    (!cancel && !consent.value) ||
    !member.value?.admin ||
    !canSignMember(member.value)
  )
    return;
  const request = sequence;
  busy.value = true;
  error.value = '';
  try {
    const hash = storagePricingHash(p);
    const result = await api.storageApprove({
      schemaVersion: 1,
      requestId: requestId(cancel, hash, count, q),
      dao: d,
      units: count,
      pricingHash: hash,
      monthlyUsdCents: q,
      recurringConsent: !cancel && consent.value,
      acceptCurrentPricing: !cancel && acceptCurrent.value,
    });
    if (request === sequence) {
      status.value = result;
      consent.value = false;
      revision.value++;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
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
      <p class="eyebrow">DAO RESOURCES</p>
      <h1>Storage and blockchain resources</h1>
      <p class="lead">Membership, pinned storage and blockchain RAM have separate allowances.</p>
    </div>
    <RouterLink to="/docs/resources-and-retention" class="help-link"
      >Storage and retention guide ↗</RouterLink
    >
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <section v-if="!dao" class="panel">
    <h2>Choose a DAO first</h2>
    <RouterLink to="/">Open the DAO hub</RouterLink>
  </section>
  <section v-else-if="!member" class="panel">
    <h2>Member access required</h2>
    <p>Sign in with an active membership to view this DAO’s resources.</p>
    <RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }">Sign in</RouterLink>
  </section>
  <template v-else>
    <StorageUsagePanel
      :dao="dao"
      :member="member"
      :revision="String(revision)"
      :heading-level="2"
    />
    <section v-if="!member.admin" class="panel">
      <h2>Administrator approval</h2>
      <p>
        Your DAO’s administrators approve paid capacity. Uploading a file never starts a
        subscription.
      </p>
    </section>
    <template v-else>
      <ActionSigner :member="member" />
      <section v-if="status" class="panel narrow">
        <h2>Pinned storage</h2>
        <dl class="fact-list">
          <dt>Funding</dt>
          <dd>{{ status.funding.state }}</dd>
          <dt>Upload allowance</dt>
          <dd>{{ bytes(status.funding.uploadCapacityBytes) }}</dd>
          <dt>Retained allowance</dt>
          <dd>{{ bytes(status.funding.retainedCapacityBytes) }}</dd>
          <dt>Paid through</dt>
          <dd>{{ date(status.funding.paidThrough) }}</dd>
          <dt>Grace deadline</dt>
          <dd>{{ date(status.funding.graceEndsAt) }}</dd>
        </dl>
        <p>
          Current documents, encrypted files, previous versions and archives share the same
          pinned-storage allowance. Repeated CIDs count once per DAO. 1 MB = 1,000,000 bytes; 1 GB =
          1,000,000,000 bytes.
        </p>
        <p v-if="!status.configured" class="notice">
          Paid storage is not configured on this operator.
        </p>
        <template v-if="status.subscription">
          <h3>Accepted agreement</h3>
          <p>
            {{ status.subscription.units }} paid units ·
            <strong>{{ dollars(status.subscription.monthlyUsdCents) }} / month</strong> ·
            {{ status.subscription.state }}. Your accepted pricing remains in force.
          </p>
          <p v-if="status.subscription.pending" role="status">
            Pending change: {{ status.subscription.pending.units }} paid units ·
            {{ dollars(status.subscription.pending.monthlyUsdCents) }} / month.
            {{
              status.subscription.pending.effectiveAt
                ? 'Scheduled for ' + date(status.subscription.pending.effectiveAt)
                : 'Additional capacity awaits verified payment.'
            }}
          </p>
          <button
            v-if="status.subscription.state === 'pending' && status.subscription.checkoutUrl"
            :disabled="busy"
            @click="checkout"
          >
            Continue secure Stripe checkout
          </button>
          <a
            v-if="status.subscription.invoiceUrl"
            :href="status.subscription.invoiceUrl"
            target="_blank"
            rel="noopener noreferrer"
            >Open latest Stripe invoice ↗</a
          >
          <button
            v-if="['active', 'past-due'].includes(status.subscription.state)"
            class="secondary"
            :disabled="busy || !!status.subscription.pending || !canSignMember(member)"
            @click="approve(true)"
          >
            Stop renewal after this paid period
          </button>
        </template>
        <form
          v-if="
            status.configured &&
            !status.subscription?.pending &&
            !['canceling', 'review'].includes(status.subscription?.state ?? '') &&
            (status.subscription?.state !== 'pending' || !status.subscription.checkoutUrl)
          "
          @submit.prevent="approve()"
        >
          <h3>Approve monthly storage</h3>
          <label for="storage-units">Additional paid storage units</label
          ><input
            id="storage-units"
            v-model="extra"
            type="text"
            inputmode="numeric"
            pattern="[1-9][0-9]{0,5}"
            required
            :disabled="busy || status.subscription?.state === 'pending'"
          />
          <label
            v-if="
              status.subscription &&
              status.currentPricing &&
              storagePricingHash(status.subscription.pricing) !==
                storagePricingHash(status.currentPricing)
            "
            class="choice"
            ><input v-model="acceptCurrent" type="checkbox" :disabled="busy" /><span
              >Explicitly accept the current Daclify storage pricing</span
            ></label
          >
          <p v-if="pricing">
            {{ bytes(pricing.freeBytes) }} included + {{ bytes(pricing.unitBytes) }} per paid unit
            at {{ dollars(pricing.monthlyUnitUsdCents) }} / month.
          </p>
          <p v-if="quote">
            <strong>{{ dollars(quote.cents) }} / month</strong> for {{ bytes(quote.bytes) }} total
            capacity. Calendar months are prepaid. Increases are prorated and need verified payment;
            reductions and newly accepted prices start at the next period.
          </p>
          <label class="choice"
            ><input v-model="consent" type="checkbox" required :disabled="busy" /><span
              >I approve these units and this recurring monthly price.</span
            ></label
          >
          <button :disabled="busy || !consent || !quote || !canSignMember(member)">
            {{
              busy
                ? 'Submitting…'
                : status.subscription
                  ? 'Approve storage change'
                  : 'Approve and prepare card checkout'
            }}
          </button>
        </form>
        <button class="secondary" :disabled="busy" @click="load">Refresh storage billing</button>
        <p class="field-help">
          Unpaid storage stops unfunded growth. Existing files retain their original 30-day grace
          deadline. Automatic deletion is currently disabled; no payment retry resets that deadline.
          Membership billing does not cancel a funded storage agreement.
        </p>
      </section>
    </template>
    <RamUsagePanel :dao="dao" :member="member" />
    <ArchivePanel :dao="dao" :member="member" />
  </template>
</template>
