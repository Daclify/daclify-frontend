<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import {
  PaymentQuerySchema,
  daoPaymentKey,
  moduleFeePricingHash,
  type ModuleFeeStatus,
  type ModuleFeeOrder,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { hostedCheckoutUrl } from '../api/billing';
import { useWorkspace } from '../state/workspace';
const route = useRoute(),
  router = useRouter(),
  workspace = useWorkspace();
const status = ref<ModuleFeeStatus>(),
  order = ref<ModuleFeeOrder>(),
  error = ref(''),
  busy = ref(false);
const dao = computed(() => {
  const value = PaymentQuerySchema.safeParse({ dao: route.query.dao });
  return value.success ? value.data.dao : null;
});
const admins = computed(() => workspace.memberships.filter((m) => m.active && m.admin));
const member = computed(() =>
  admins.value.find((m) => dao.value && daoPaymentKey(m.dao) === daoPaymentKey(dao.value)),
);
const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const free = computed(() => status.value && status.value.activeMembers <= status.value.freeMembers);
let sequence = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
function choose(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) return;
  const value = event.target.value;
  const choice = admins.value.find((m) => daoPaymentKey(m.dao) === value);
  if (choice)
    void router.push({ path: '/module-access', query: { dao: JSON.stringify(choice.dao) } });
}
function retryKey(module: string) {
  return (
    'daclify.module-access.' +
    workspace.account?.id +
    '.' +
    (dao.value ? daoPaymentKey(dao.value) : '') +
    '.' +
    module
  );
}
function canBuy(plan: ModuleFeeStatus['modules'][number]) {
  return (
    !free.value &&
    plan.installed &&
    plan.pricing.monthlyUsdCents > 0 &&
    (!plan.term || plan.term.revoked || plan.term.expires <= Date.now() / 1000 + 7 * 86400)
  );
}
async function load() {
  const current = ++sequence,
    d = dao.value;
  if (timer) clearTimeout(timer);
  error.value = '';
  status.value = undefined;
  order.value = undefined;
  busy.value = true;
  if (!d || !member.value) {
    busy.value = false;
    return;
  }
  try {
    const id = z.uuid().safeParse(route.query.order);
    const receipt = id.success ? await api.moduleFeeOrder(id.data, d) : undefined;
    const value = await api.moduleFeeStatus(d);
    if (current !== sequence) return;
    status.value = value;
    order.value = receipt;
    if (receipt && !['pending', 'paid', 'refunding', 'review'].includes(receipt.state))
      sessionStorage.removeItem(retryKey(receipt.approval.account));
    if (receipt && ['pending', 'paid', 'refunding'].includes(receipt.state))
      timer = setTimeout(() => void load(), 10000);
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  } finally {
    if (current === sequence) busy.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      dao.value,
      route.query.order,
      workspace.account?.id,
      member.value?.memberId,
      workspace.network?.chainId,
      workspace.network?.runtime,
      workspace.network?.rpcUrl,
    ]),
  load,
  { immediate: true },
);
onBeforeUnmount(() => {
  sequence++;
  if (timer) clearTimeout(timer);
});
async function buy(plan: ModuleFeeStatus['modules'][number]) {
  const d = dao.value,
    current = sequence;
  if (!d || !canBuy(plan) || busy.value || !status.value?.configured) return;
  busy.value = true;
  error.value = '';
  try {
    const body = JSON.stringify([
      moduleFeePricingHash(plan.pricing),
      plan.codeHash,
      plan.term?.receipt ?? null,
    ]);
    const saved = z
      .strictObject({ id: z.uuid(), body: z.string() })
      .safeParse(JSON.parse(sessionStorage.getItem(retryKey(plan.pricing.account)) ?? 'null'));
    const id = saved.success && saved.data.body === body ? saved.data.id : crypto.randomUUID();
    sessionStorage.setItem(retryKey(plan.pricing.account), JSON.stringify({ id, body }));
    const value = await api.moduleFeeCheckout({
      schemaVersion: 1,
      requestId: id,
      dao: d,
      account: plan.pricing.account,
      pricingHash: moduleFeePricingHash(plan.pricing),
      monthlyUsdCents: plan.pricing.monthlyUsdCents,
      codeHash: plan.codeHash,
    });
    if (current !== sequence) return;
    order.value = value;
    if (value.checkoutUrl && value.state === 'pending')
      window.location.assign(hostedCheckoutUrl(value.checkoutUrl));
    else await load();
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  } finally {
    if (current === sequence) busy.value = false;
  }
}
function resume() {
  if (order.value?.state === 'pending' && order.value.checkoutUrl)
    window.location.assign(hostedCheckoutUrl(order.value.checkoutUrl));
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">COMMUNITY TOOLS</p>
      <h1>Module access</h1>
      <p class="lead">
        All existing Daclify modules are free through 10 active members, including managers.
      </p>
    </div>
    <RouterLink class="button secondary" to="/pricing">All DAO pricing</RouterLink>
  </div>
  <section class="panel form-panel">
    <label for="module-access-dao">DAO you administer</label
    ><select id="module-access-dao" :value="dao ? daoPaymentKey(dao) : ''" @change="choose">
      <option value="">Choose a DAO</option>
      <option v-for="m in admins" :key="daoPaymentKey(m.dao)" :value="daoPaymentKey(m.dao)">
        DAO {{ m.dao.daoId }} · {{ m.dao.contract }}
      </option>
    </select>
    <p v-if="!workspace.account">Sign in to manage your DAO’s module access.</p>
    <p v-else-if="!admins.length">An active DAO administrator can manage access.</p>
    <p v-if="dao && !member">You need an active administrator membership in this DAO.</p>
  </section>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="busy" role="status">Checking module access…</p>
  <template v-if="status"
    ><section class="panel">
      <h2>{{ status.activeMembers }} active members</h2>
      <p v-if="free" class="notice">
        All modules are free for this DAO. No module access payment is needed.
      </p>
      <p v-else>
        Each enabled module has its own monthly price. An administrator buys one calendar month at a
        time; payments do not renew automatically.
      </p>
      <p>
        Existing voting, work completion, cancellations and payouts remain available if paid access
        expires. Member capacity and storage are priced separately.
      </p>
      <p v-if="status.paymentMode === 'test'" class="notice">
        Testnet card payments use Stripe test mode.
      </p>
      <p v-if="!status.configured">Card purchases are unavailable on this deployment.</p>
      <button class="secondary" :disabled="busy" @click="load">Refresh access</button>
    </section>
    <section v-if="order" class="panel" aria-labelledby="module-order">
      <h2 id="module-order">Module payment</h2>
      <p role="status">
        {{
          order.state === 'active'
            ? 'Payment verified and access recorded.'
            : 'Payment status: ' + order.state
        }}
      </p>
      <p v-if="order.expires">Access until {{ new Date(order.expires * 1000).toLocaleString() }}</p>
      <p v-if="order.state === 'pending'">
        A return from checkout does not prove payment. The service verifies the card receipt before
        granting access.
      </p>
      <button
        v-if="order.state === 'pending' && order.checkoutUrl"
        :disabled="busy"
        @click="resume"
      >
        Continue existing checkout
      </button>
    </section>
    <div class="dao-grid">
      <article v-for="plan in status.modules" :key="plan.pricing.account" class="panel">
        <h2>{{ plan.title }}</h2>
        <p class="price-highlight">
          {{
            free || plan.pricing.monthlyUsdCents === 0
              ? 'Free'
              : money(plan.pricing.monthlyUsdCents) + ' / DAO / month'
          }}
        </p>
        <p>
          {{ plan.installed ? 'Enabled in this DAO' : 'Enable this module in DAO settings first.' }}
        </p>
        <p v-if="!free && plan.term && !plan.term.revoked && plan.term.expires > Date.now() / 1000">
          Access until {{ new Date(plan.term.expires * 1000).toLocaleString() }}
        </p>
        <p v-else-if="!free && plan.pricing.monthlyUsdCents > 0">
          {{ plan.term?.revoked ? 'Paid access was revoked.' : 'New activity needs paid access.' }}
        </p>
        <button v-if="canBuy(plan)" :disabled="busy || !status.configured" @click="buy(plan)">
          {{
            plan.term && !plan.term.revoked && plan.term.expires > Date.now() / 1000
              ? 'Renew one month'
              : 'Buy one month'
          }}
          · {{ money(plan.pricing.monthlyUsdCents) }}
        </button>
        <p v-else-if="!free && plan.term && !plan.term.revoked" class="field-help">
          Renewal opens seven days before expiry.
        </p>
      </article>
    </div>
  </template>
</template>
