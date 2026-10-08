<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from 'vue';
import { ApiRoutes, type DaoRef, type UserMembership } from '@daclify/core-protocol';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import CardRamPanel from './CardRamPanel.vue';
import { useWorkspace } from '../state/workspace';
import { connectNative, nativeIdentity, nativeRamPurchase, nativeWallet } from '../auth/telos-zero';
const props = defineProps<{ dao: DaoRef; member: UserMembership }>(),
  workspace = useWorkspace(),
  usage = ref<z.infer<typeof ApiRoutes.ramUsage.response>>(),
  busy = ref(false),
  error = ref('');
const receiver = ref(''),
  minimum = ref('65536'),
  consent = ref(false),
  purchasing = ref(false),
  quote = ref<z.infer<typeof ApiRoutes.ramQuote.response>>(),
  transactionId = ref('');
const candidates = computed(
  () => usage.value?.payers.filter((p) => p.sourceVerified && p.globalQuotaBytes !== null) ?? [],
);
watch(
  () =>
    JSON.stringify([
      props.dao,
      workspace.account?.id,
      receiver.value,
      minimum.value,
      nativeWallet.value?.actor.toString(),
    ]),
  () => {
    quote.value = undefined;
    consent.value = false;
    transactionId.value = '';
  },
);
async function price() {
  const request = sequence;
  error.value = '';
  quote.value = undefined;
  consent.value = false;
  purchasing.value = true;
  try {
    if (!nativeWallet.value) await connectNative();
    const result = await api.ramQuote({
      dao: props.dao,
      payer: nativeIdentity().account,
      allocations: [{ receiver: receiver.value, minimumBytes: minimum.value }],
    });
    if (request === sequence) quote.value = result;
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) purchasing.value = false;
  }
}
async function purchase() {
  const accepted = quote.value,
    request = sequence;
  if (!accepted || !consent.value) return;
  purchasing.value = true;
  error.value = '';
  try {
    const result = await nativeRamPurchase(accepted, () => {
      if (
        request !== sequence ||
        quote.value !== accepted ||
        !consent.value ||
        !props.member.active
      )
        throw new Error('WALLET_CONTEXT_CHANGED');
    });
    if (request === sequence) {
      transactionId.value = result;
      quote.value = undefined;
      consent.value = false;
      await refresh();
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    purchasing.value = false;
  }
}
const amount = (units: string) =>
  `${BigInt(units) / 10000n}.${(BigInt(units) % 10000n).toString().padStart(4, '0')} TLOS`;
let sequence = 0;
const bytes = (value: string) => `${BigInt(value).toLocaleString()} bytes`;
async function refresh() {
  const request = ++sequence;
  usage.value = undefined;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.ramUsage(props.dao);
    if (request === sequence) usage.value = result;
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
watch(
  () =>
    JSON.stringify([props.dao, props.member.memberId, props.member.active, workspace.account?.id]),
  () => {
    sequence++;
    usage.value = undefined;
    error.value = '';
    busy.value = false;
    quote.value = undefined;
    consent.value = false;
    purchasing.value = false;
    receiver.value = '';
    if (props.member.active) void refresh();
  },
  { immediate: true },
);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section class="panel narrow" aria-labelledby="ram-heading">
    <h2 id="ram-heading">Blockchain RAM</h2>
    <p>
      RAM pays for live contract records across core and installed modules. IPFS storage has a
      separate allowance. Purchased RAM is permanent and reusable after pruning.
    </p>
    <p v-if="busy" role="status">Reading contract RAM…</p>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <template v-if="usage">
      <p v-if="usage.totalObservedBytes !== null" role="status">
        <strong>{{ bytes(usage.totalObservedBytes) }}</strong> recorded for this DAO across its
        metered Daclify contract records.
      </p>
      <p v-else class="notice" role="status">
        A complete DAO RAM total is unavailable.
        {{
          usage.observation === 'disabled'
            ? 'DAO-level observation is disabled on this deployment.'
            : 'At least one payer does not match its approved accounting source.'
        }}
      </p>
      <p>
        <strong>{{ bytes(usage.purchasedBytes) }}</strong> credited by settled RAM purchases.
      </p>
      <ul class="plain-list">
        <li v-for="payer in usage.payers" :key="payer.payer">
          <h3>
            {{
              payer.moduleId ?? (payer.payer === dao.contract ? 'Core runtime' : 'Contract payer')
            }}
            · {{ payer.payer }}
          </h3>
          <p v-if="!payer.sourceVerified" class="notice">
            This contract does not match its approved accounting source. Recorded counters may be
            incomplete.
          </p>
          <p v-if="payer.usage">
            Identity and recovery {{ bytes(payer.usage.identity) }} · activity
            {{ bytes(payer.usage.activity) }} · retained records {{ bytes(payer.usage.retained) }} ·
            platform category {{ bytes(payer.usage.platform) }}.
          </p>
          <p>Purchased credit {{ bytes(payer.purchasedBytes) }}.</p>
          <p v-if="payer.allocation">
            Recorded allocation: activity {{ bytes(payer.allocation.activity) }} · identity
            {{ bytes(payer.allocation.identity) }} · completion budget
            {{ bytes(payer.allocation.completion) }}. Quota enforcement is disabled; this is not a
            guarantee that outstanding work has reserved completion RAM.
          </p>
          <p
            v-if="payer.entitlement && payer.entitlement.identity_per_slot !== '0'"
            class="field-help"
          >
            Identity allowance granted once for {{ payer.entitlement.slots }} funded member slots at
            {{ bytes(payer.entitlement.identity_per_slot) }} per slot, under accepted policy
            {{ payer.entitlement.policy_revision }}. Renewals and replacement members do not grant
            those bytes again. This is distinct from the current monthly membership limit.
          </p>
          <details>
            <summary>Whole payer account</summary>
            <p>
              {{ bytes(payer.globalUsedBytes) }} used ·
              {{
                payer.globalQuotaBytes === null
                  ? 'No finite quota reported'
                  : bytes(payer.globalQuotaBytes) + ' total quota'
              }}.
            </p>
            <p class="field-help">
              These figures include other DAOs, code, permissions and shared infrastructure. They
              are not this DAO’s remaining allowance.
            </p>
          </details>
        </li>
      </ul>
      <p v-if="usage.policy" class="field-help">
        Configured policy budgets {{ bytes(usage.policy.includedActivityBytes) }} activity and
        {{ bytes(usage.policy.identityBytesPerSlot) }} per approved member slot. These values do not
        prove a funded allocation.
      </p>
      <p class="field-help">
        Token contracts can create or change sender-paid RAM outside these counters. Full resource
        accounting and protected payout reserves remain under qualification; growth limits are not
        active.
      </p>
      <p class="field-help">
        Live account reads completed {{ new Date(usage.read.completedAt).toLocaleString() }}. They
        are not an atomic billing snapshot.
      </p>
    </template>
    <button class="secondary" :disabled="busy" @click="refresh">Refresh RAM usage</button>
    <form
      v-if="usage?.observation === 'active' && usage.policy && candidates.length"
      @submit.prevent="price"
    >
      <h3>Buy permanent RAM with TLOS</h3>
      <p>
        The connected Telos Zero wallet pays. Sponsoring RAM does not grant membership or
        administration.
      </p>
      <label for="ram-receiver">Contract payer</label>
      <select id="ram-receiver" v-model="receiver" required :disabled="purchasing">
        <option value="" disabled>Select a contract</option>
        <option v-for="payer in candidates" :key="payer.payer" :value="payer.payer">
          {{ payer.moduleId ?? 'Core runtime' }} · {{ payer.payer }}
        </option>
      </select>
      <label for="ram-minimum">Minimum additional RAM, in bytes</label>
      <input
        id="ram-minimum"
        v-model="minimum"
        inputmode="numeric"
        pattern="[1-9][0-9]*"
        required
        :disabled="purchasing"
      />
      <button type="submit" :disabled="purchasing || !receiver">
        {{ purchasing ? 'Working…' : 'Get TLOS quote' }}
      </button>
    </form>
    <div v-if="quote" class="notice">
      <p>
        Native acquisition, including system fee: {{ amount(quote.baseUnits) }}. Daclify operational
        fee {{ quote.feeBps / 100 }}%: {{ amount(quote.feeUnits) }}. Total maximum:
        <strong>{{ amount(quote.totalUnits) }}</strong
        >.
      </p>
      <p>
        Minimum {{ bytes(quote.order.purchases[0]?.minimum_bytes ?? '0') }} for
        {{ quote.order.purchases[0]?.receiver }}. Expires
        {{ new Date(quote.order.expires * 1000).toLocaleTimeString() }}. A changed price or policy
        causes the whole payment to roll back.
      </p>
      <label class="check"
        ><input v-model="consent" type="checkbox" :disabled="purchasing" />I approve this one-time
        payment from {{ quote.order.payer }}.</label
      >
      <button :disabled="!consent || purchasing" @click="purchase">
        Approve in wallet and buy RAM
      </button>
    </div>
    <p v-if="transactionId" role="status">
      RAM purchase confirmed. Transaction {{ transactionId }}.
    </p>
    <CardRamPanel
      v-if="member.admin && usage?.observation === 'active' && candidates.length"
      :dao="dao"
      :member="member"
      :payers="candidates.map((p) => p.payer)"
    />
    <p class="field-help">
      Funded pools, protected completion reserves and quota enforcement are still being qualified.
      Card RAM availability depends on operator configuration and qualification. Hosting arrears do
      not sell purchased RAM or erase financial and recovery records.
    </p>
    <RouterLink to="/docs/resources-and-retention" class="help-link"
      >RAM and storage guide ↗</RouterLink
    >
  </section>
</template>
