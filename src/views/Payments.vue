<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  PaymentQuerySchema,
  daoPaymentKey,
  parseUnits,
  type PaymentStatus,
  type PaymentOrder,
  type PaymentCatalogueSchema,
  type PaymentProduct,
} from '@daclify/core-protocol';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import ActionSigner from '../components/ActionSigner.vue';
import { canSignMember } from '../auth/action-signer';
const route = useRoute(),
  router = useRouter(),
  state = useWorkspace();
const dao = computed(() => {
  const query = PaymentQuerySchema.safeParse({ dao: route.query.dao });
  return query.success ? query.data.dao : null;
});
const member = computed(() =>
  state.memberships.find(
    (m) => dao.value && daoPaymentKey(m.dao) === daoPaymentKey(dao.value) && m.active && m.admin,
  ),
);
const status = ref<PaymentStatus>(),
  catalogue = ref<z.infer<typeof PaymentCatalogueSchema>>(),
  order = ref<PaymentOrder>();
const title = ref(''),
  amount = ref(''),
  moduleId = ref('works'),
  productId = ref(''),
  active = ref(true),
  credential = ref(''),
  refundAmount = ref(''),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
let sequence = 0;
const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
async function load() {
  const current = ++sequence;
  busy.value = false;
  status.value = undefined;
  catalogue.value = undefined;
  order.value = undefined;
  error.value = '';
  credential.value = '';
  const d = dao.value;
  if (!d) return;
  try {
    const [products, settings] = await Promise.all([
      api.paymentCatalogue(d),
      member.value ? api.paymentStatus(d) : Promise.resolve(undefined),
    ]);
    if (current !== sequence) return;
    catalogue.value = products;
    status.value = settings;
    if (typeof route.query.order === 'string' && state.account) {
      const result = await api.paymentOrder(route.query.order);
      if (daoPaymentKey(result.dao) !== daoPaymentKey(d)) throw new Error('DAO_REFERENCE');
      if (current === sequence) order.value = result;
    }
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  }
}
watch(
  () => JSON.stringify([dao.value, state.account?.id, member.value?.memberId, route.query.order]),
  load,
  { immediate: true },
);
onBeforeUnmount(() => {
  sequence++;
  credential.value = '';
});
async function run(work: () => Promise<void>) {
  const current = sequence;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await work();
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  } finally {
    if (current === sequence) busy.value = false;
  }
}
function stripeRedirect(value: string, host: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== host ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('CHECKOUT_URL');
  window.location.assign(url.toString());
}
async function onboard(mode: 'existing' | 'new' | 'resume') {
  const d = dao.value;
  if (!d) return;
  await run(async () => {
    const current = sequence;
    const value = await api.paymentOnboard({ dao: d, mode });
    if (current === sequence) stripeRedirect(value.url, 'connect.stripe.com');
  });
}
function edit(product: PaymentProduct) {
  productId.value = product.id;
  title.value = product.title;
  amount.value = (product.amountMinor / 100).toFixed(2);
  moduleId.value = product.moduleId;
  active.value = product.active;
}
async function saveProduct() {
  const d = dao.value;
  if (!d) return;
  await run(async () => {
    const current = sequence;
    const cents = Number(parseUnits(amount.value, 2));
    const product = await api.paymentProduct({
      dao: d,
      id: productId.value || crypto.randomUUID(),
      moduleId: moduleId.value,
      title: title.value,
      amountMinor: cents,
      active: active.value,
    });
    if (current === sequence) {
      edit(product);
      notice.value = 'Product saved. Earlier orders retain their original price.';
      const [settings, products] = await Promise.all([
        api.paymentStatus(d),
        api.paymentCatalogue(d),
      ]);
      if (current === sequence) {
        status.value = settings;
        catalogue.value = products;
      }
    }
  });
}
async function buy(product: PaymentProduct) {
  const d = dao.value,
    accountId = state.account?.id;
  if (!d || !accountId) return;
  await run(async () => {
    const current = sequence,
      key = 'daclify.checkout.' + daoPaymentKey(d) + '.' + accountId + '.' + product.id;
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    const result = await api.paymentCheckout({ dao: d, productId: product.id, requestId: id });
    if (current !== sequence) return;
    await router.replace({
      path: '/payments',
      query: { dao: JSON.stringify(d), order: result.id },
    });
    if (result.checkoutUrl && result.state === 'open')
      stripeRedirect(result.checkoutUrl, 'checkout.stripe.com');
  });
}
async function refund() {
  const d = dao.value,
    value = order.value;
  if (!d || !value) return;
  await run(async () => {
    const current = sequence,
      cents = Number(parseUnits(refundAmount.value, 2)),
      key = 'daclify.refund.' + value.id + '.' + cents;
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    const result = await api.paymentRefund({
      dao: d,
      orderId: value.id,
      requestId: id,
      amountMinor: cents,
    });
    if (current === sequence) {
      order.value = result;
      notice.value = 'Refund request reconciled. Refresh for the current provider result.';
    }
  });
}
async function broker(revoke = false) {
  const d = dao.value;
  if (!d) return;
  await run(async () => {
    const current = sequence;
    if (revoke) {
      await api.paymentRevoke(d);
      if (current === sequence) credential.value = '';
    } else {
      const value = await api.paymentCredential(d);
      if (current === sequence) credential.value = value.token;
    }
    if (current === sequence) status.value = await api.paymentStatus(d);
  });
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">DAO PAYMENTS</p>
      <h1>Payments and merchant setup</h1>
      <p class="lead">
        Your DAO’s merchant account receives module payments. Daclify Connect applies the agreed
        platform commission.
      </p>
    </div>
    <RouterLink class="help-link" to="/docs/payments">Payment guide ↗</RouterLink>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="notice" class="notice" role="status">{{ notice }}</p>
  <section v-if="!dao" class="panel">
    <h2>Choose a DAO first</h2>
    <RouterLink to="/">DAO hub</RouterLink>
  </section>
  <template v-else>
    <section class="panel">
      <h2>Choose the payment arrangement</h2>
      <p>
        <strong>Daclify Connect:</strong> your own Stripe merchant account, hosted onboarding, and a
        governed commission on eligible module checkouts. Independent servers can connect through a
        scoped server credential; platform Stripe secrets stay with Daclify.
      </p>
      <p>
        <strong>Standalone Stripe:</strong> your own backend and frontend manage your merchant
        integration. The Hub links to your portal. Daclify cannot automatically collect a percentage
        from those outside payments.
      </p>
      <p>
        Hosting subscriptions are billed separately. Native treasury transfers and outside payments
        have no automatic Connect commission.
      </p>
    </section>
    <ActionSigner v-if="member" :member="member" />
    <section v-if="member && status" class="panel narrow">
      <h2>Merchant setup</h2>
      <p>
        Status: <strong>{{ status.state }}</strong> · Charges
        {{ status.chargesEnabled ? 'enabled' : 'disabled' }} · Payouts
        {{ status.payoutsEnabled ? 'enabled' : 'disabled' }}
      </p>
      <p v-if="status.policy">
        Current commission: {{ status.policy.basisPoints / 100 }}% · policy revision
        {{ status.policy.revision }}. Each order retains its agreed rate; Stripe processing fees are
        separate.
      </p>
      <p>
        Stripe collects business, identity and bank information. Returning here does not mean
        verification is complete. Creation of your DAO does not require merchant setup.
      </p>
      <a
        v-if="status.merchantSetupUrl"
        class="button secondary"
        :href="status.merchantSetupUrl"
        target="_blank"
        rel="noopener noreferrer"
        >Manage merchant setup on Daclify ↗</a
      ><template v-else-if="status.state === 'not-connected' || status.state === 'disconnected'"
        ><button :disabled="busy || !canSignMember(member)" @click="onboard('existing')">
          Connect an existing Stripe account</button
        ><button
          v-if="status.state === 'not-connected'"
          class="secondary"
          :disabled="busy || !canSignMember(member)"
          @click="onboard('new')"
        >
          Create a new Stripe merchant account
        </button></template
      ><button
        v-if="
          !status.merchantSetupUrl && status.accountKind === 'v2' && status.state !== 'disconnected'
        "
        :disabled="busy || !canSignMember(member)"
        @click="onboard('resume')"
      >
        Resume Stripe onboarding</button
      ><button class="secondary" :disabled="busy" @click="load">Refresh merchant readiness</button>
    </section>
    <section v-if="member && status && !status.merchantSetupUrl" class="panel narrow">
      <h2>Module products</h2>
      <p>
        Products create card payment receipts. They do not automatically install modules, grant
        membership or credit the native treasury.
      </p>
      <ul>
        <li v-for="product in status.products" :key="product.id">
          {{ product.title }} · {{ dollars(product.amountMinor) }} ·
          {{ product.active ? 'active' : 'hidden' }}
          <button class="secondary" :disabled="busy" @click="edit(product)">Edit product</button>
        </li>
      </ul>
      <form @submit.prevent="saveProduct">
        <label for="product-title">Product name</label
        ><input id="product-title" v-model="title" required maxlength="100" /><label
          for="product-module"
          >Module reference</label
        ><input
          id="product-module"
          v-model="moduleId"
          pattern="[a-z][a-z0-9-]{0,63}"
          required
        /><label for="product-price">Price in USD</label
        ><input
          id="product-price"
          v-model="amount"
          inputmode="decimal"
          required
          placeholder="10.00"
        /><label class="choice"
          ><input v-model="active" type="checkbox" /><span
            >Show this product in the payment catalogue</span
          ></label
        ><button :disabled="busy || !canSignMember(member)">Save product</button
        ><button
          class="secondary"
          type="button"
          :disabled="busy"
          @click="
            productId = '';
            title = '';
            amount = '';
          "
        >
          New product
        </button>
      </form>
    </section>
    <section v-if="catalogue" class="panel">
      <h2>Payment catalogue</h2>
      <p v-if="!catalogue.enabled" class="notice">
        Checkout is unavailable until merchant readiness and payment configuration are complete.
      </p>
      <p v-if="!catalogue.products.length">No active products.</p>
      <article v-for="product in catalogue.products" :key="product.id">
        <h3>{{ product.title }}</h3>
        <p>{{ dollars(product.amountMinor) }} USD · {{ product.moduleId }}</p>
        <button :disabled="busy || !catalogue.enabled || !state.account" @click="buy(product)">
          Pay {{ dollars(product.amountMinor) }} by card
        </button>
      </article>
      <RouterLink
        v-if="!state.account"
        :to="{ path: '/account', query: { returnTo: route.fullPath } }"
        >Sign in to pay and view your receipt</RouterLink
      >
    </section>
    <section v-if="order" class="panel narrow">
      <h2>Payment receipt</h2>
      <p class="break-word">Order {{ order.id }}</p>
      <dl class="fact-list">
        <dt>Product</dt>
        <dd>{{ order.title }}</dd>
        <dt>Total</dt>
        <dd>{{ dollars(order.amountMinor) }}</dd>
        <dt>Daclify commission</dt>
        <dd>{{ dollars(order.applicationFeeMinor) }} · {{ order.policy.basisPoints / 100 }}%</dd>
        <dt>Status</dt>
        <dd>{{ order.state }}</dd>
        <dt>Refunded</dt>
        <dd>{{ dollars(order.refundedMinor) }}</dd>
        <dt>Dispute</dt>
        <dd>{{ order.dispute }}</dd>
      </dl>
      <p>A checkout return does not prove payment. This status is reconciled from Stripe.</p>
      <button class="secondary" :disabled="busy" @click="load">Refresh receipt</button>
      <form
        v-if="
          member &&
          !status?.merchantSetupUrl &&
          order.state === 'paid' &&
          order.refundedMinor < order.amountMinor
        "
        @submit.prevent="refund"
      >
        <label for="refund-amount">Refund amount in USD</label
        ><input id="refund-amount" v-model="refundAmount" inputmode="decimal" required /><button
          :disabled="busy || !canSignMember(member)"
        >
          Request this refund
        </button>
        <p class="field-help">
          Refunds remain on the original merchant account. Retrying an unchanged amount uses the
          same request. Processing fees may be retained by Stripe.
        </p>
      </form>
    </section>
    <details v-if="member && status && !status.merchantSetupUrl" class="panel narrow">
      <summary>Independent server connection</summary>
      <p>
        Issue a DAO-scoped broker credential for your server. Copy it once into private server
        configuration. Never put it in frontend variables, the Hub registry or Git. Issuing a new
        credential replaces the previous one.
      </p>
      <p>
        {{
          status.brokerConfigured
            ? 'A broker credential is configured.'
            : 'No broker credential is configured.'
        }}
      </p>
      <button :disabled="busy || !canSignMember(member)" @click="broker()">
        Issue / replace server credential</button
      ><button
        v-if="status.brokerConfigured"
        class="secondary"
        :disabled="busy || !canSignMember(member)"
        @click="broker(true)"
      >
        Revoke server credential</button
      ><label v-if="credential" for="broker-credential">Copy now · shown once</label
      ><textarea
        v-if="credential"
        id="broker-credential"
        :value="credential"
        readonly
        spellcheck="false"
        rows="3"
      ></textarea
      ><RouterLink to="/docs/independent-operators">Operator setup guide ↗</RouterLink>
    </details>
  </template>
</template>
