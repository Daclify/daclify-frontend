<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import { ApiRoutes, daoPaymentKey, type DaoRef, type UserMembership } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { hostedCheckoutUrl } from '../api/billing';
import { useWorkspace } from '../state/workspace';
import { canSignMember } from '../auth/action-signer';
const props = defineProps<{ dao: DaoRef; member: UserMembership; payers: string[] }>(),
  state = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const receiver = ref(''),
  minimum = ref('1048576'),
  consent = ref(false),
  busy = ref(false),
  error = ref(''),
  terms = ref<z.infer<typeof ApiRoutes.ramCardQuote.response>>(),
  order = ref<z.infer<typeof ApiRoutes.ramCardStatus.response>>();
let sequence = 0,
  requestId = crypto.randomUUID();
const checkout = computed(() =>
  order.value?.checkoutUrl ? hostedCheckoutUrl(order.value.checkoutUrl) : null,
);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
function reset() {
  sequence++;
  terms.value = undefined;
  consent.value = false;
  busy.value = false;
  error.value = '';
  requestId = crypto.randomUUID();
}
async function price() {
  const request = ++sequence;
  terms.value = undefined;
  consent.value = false;
  busy.value = true;
  error.value = '';
  requestId = crypto.randomUUID();
  try {
    const result = await api.cardRamQuote({
      dao: props.dao,
      allocations: [{ receiver: receiver.value, minimumBytes: minimum.value }],
    });
    if (request === sequence) terms.value = result;
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function approve() {
  const selected = terms.value,
    request = sequence;
  if (!selected || !consent.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.cardRamCheckout({ ...selected, requestId, consent: true });
    if (request === sequence) {
      order.value = result;
      terms.value = undefined;
      consent.value = false;
      await router.replace({ query: { ...route.query, ramOrder: result.id } });
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function load(id: string) {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.cardRamStatus(id);
    if (daoPaymentKey(result.dao) !== daoPaymentKey(props.dao)) throw new Error('DAO_REFERENCE');
    if (request === sequence) order.value = result;
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function reconcile() {
  const saved = order.value,
    request = sequence;
  if (!saved) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.cardRamReconcile(saved.id);
    if (request === sequence && daoPaymentKey(result.dao) === daoPaymentKey(props.dao))
      order.value = result;
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      props.dao,
      props.member.memberId,
      props.member.active,
      props.member.admin,
      state.account?.id,
      route.query.ramOrder,
    ]),
  () => {
    reset();
    order.value = undefined;
    const id = z.uuid().safeParse(route.query.ramOrder);
    if (props.member.active && props.member.admin && id.success) void load(id.data);
  },
  { immediate: true },
);
watch([receiver, minimum], reset);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section class="panel narrow" aria-labelledby="card-ram-heading">
    <h3 id="card-ram-heading">Buy RAM with a card</h3>
    <p>
      One-time payment, minimum $5. The native acquisition cost includes the blockchain system fee.
      The card rail adds one operational markup, 20% at launch. No additional 5% TLOS fee or Connect
      commission applies.
    </p>
    <p>
      Confirmed payment queues an operator-funded purchase. Capacity is credited only after the
      blockchain receipt verifies the actual RAM increase. A browser return does not prove payment.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">Working on your RAM order…</p>
    <div v-if="order" class="notice">
      <p>
        Order {{ order.id }} · {{ order.state }}. Approved one-time total
        {{ usd(order.approval.totalUsdCents) }}.
      </p>
      <p v-if="order.acquiredBytes !== null">
        {{ BigInt(order.acquiredBytes).toLocaleString() }} permanent RAM bytes acquired. Settlement
        {{ new Date(order.settledAt ?? '').toLocaleString() }}.
      </p>
      <p v-if="order.state === 'review'">
        Payment or provisioning needs operator review. Existing records and purchased capacity are
        retained.
      </p>
      <a
        v-if="checkout && order.state === 'pending'"
        :href="checkout"
        target="_blank"
        rel="noopener noreferrer"
        >Continue secure Stripe checkout ↗</a
      >
      <button
        v-if="order.state !== 'settled'"
        class="secondary"
        :disabled="busy"
        @click="reconcile"
      >
        Reconcile payment and provisioning
      </button>
      <button
        v-if="order.state === 'settled'"
        class="secondary"
        :disabled="busy"
        @click="
          order = undefined;
          reset();
        "
      >
        Prepare another RAM order
      </button>
      <button class="secondary" :disabled="busy" @click="load(order.id)">
        Refresh card RAM order
      </button>
    </div>
    <form v-if="!order" @submit.prevent="price">
      <label for="card-ram-payer">Contract receiving RAM</label>
      <select id="card-ram-payer" v-model="receiver" required :disabled="busy">
        <option disabled value="">Select a contract</option>
        <option v-for="payer in payers" :key="payer" :value="payer">{{ payer }}</option>
      </select>
      <label for="card-ram-minimum">Minimum additional RAM, in bytes</label>
      <input
        id="card-ram-minimum"
        v-model="minimum"
        inputmode="numeric"
        pattern="[1-9][0-9]*"
        required
        :disabled="busy"
      />
      <button :disabled="busy || !receiver">Get card quote</button>
    </form>
    <div v-if="terms" class="notice">
      <p>
        Native acquisition: {{ usd(terms.baseUsdCents) }}. Operational markup
        {{ terms.policy.cardRamBps / 100 }}%: {{ usd(terms.feeUsdCents) }}.
        <strong>One-time total {{ usd(terms.totalUsdCents) }}.</strong>
      </p>
      <p>
        Minimum
        {{ BigInt(terms.quote.order.purchases[0]?.minimum_bytes ?? '0').toLocaleString() }} bytes
        for {{ terms.quote.order.purchases[0]?.receiver }}. Rate observation
        {{ new Date(terms.oracle.observed_at * 1000).toLocaleString() }}. Quote expires
        {{ new Date(terms.quote.order.expires * 1000).toLocaleTimeString() }}.
      </p>
      <label class="choice"
        ><input v-model="consent" type="checkbox" :disabled="busy" /><span
          >I approve this exact one-time price and byte minimum. This does not create a monthly
          subscription.</span
        ></label
      >
      <button :disabled="busy || !consent || !canSignMember(member)" @click="approve">
        Approve and prepare card checkout
      </button>
    </div>
    <p class="field-help">
      Card purchases require the operator’s Stripe setup and funded native reserve. An unavailable
      reserve or changed policy pauses provisioning for reconciliation. Refunds and disputes need
      review; RAM is not sold automatically.
    </p>
  </section>
</template>
