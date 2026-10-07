<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  DaoPresets,
  DaoSetupSchema,
  FoundingAgentSchema,
  defaultDaoSetup,
  parseUnits,
  type Privacy,
  type CreationMethodSchema,
  type CreationOrderView,
  type PlatformStatus,
} from '@daclify/core-protocol';
import type { z } from 'zod';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError } from '../api/client';
const state = useWorkspace();
const router = useRouter();
const route = useRoute();
const platform = ref<PlatformStatus>();
const order = ref<CreationOrderView>();
const method = ref<z.infer<typeof CreationMethodSchema>>('tlos');
const orderId = ref(typeof route.query.order === 'string' ? route.query.order : '');
const resumeId = ref(orderId.value);
const previousOrders = ref<string[]>([]);
let orderSequence = 0;
const quotedInput = ref<Parameters<typeof api.creationOrder>[0]>();
const sharedPrice = computed(() => platform.value?.chain?.creation?.shared_usd ?? 2000);
const independentPrice = computed(() => platform.value?.chain?.creation?.independent_usd ?? 5000);
const premium = computed(() => (platform.value?.chain?.creation?.premium_bps ?? 2000) / 100);
const cardAvailable = computed(
  () => platform.value?.services.find((s) => s.id === 'card')?.configured ?? false,
);
function usd(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
let loadSequence = 0;
async function loadPlatform() {
  const current = ++loadSequence;
  try {
    const result = await api.platformStatus();
    if (current === loadSequence) platform.value = result;
  } catch (cause) {
    if (current === loadSequence) error.value = friendlyError(cause);
  }
}
onMounted(loadPlatform);
function acceptOrder(result: CreationOrderView) {
  if (
    result.network.chainId !== state.network?.chainId ||
    result.network.runtime !== state.network?.runtime
  )
    throw new Error('DAO_REFERENCE');
  order.value = result;
}
const title = ref('');
const description = ref('');
const privacy = ref<Privacy>('public');
const deployment = ref('shared');
const token = ref('eosio.token');
const symbol = ref('TLOS');
const precision = ref(4);
const error = ref('');
const busy = ref(false);
const setup = ref(defaultDaoSetup());
const maxAmount = ref('');
const dailyAmount = ref('');
const agentSigningKey = ref('');
const agentEncryptionKey = ref('');
const agentOperator = ref('');
const quorumPercent = computed({
  get: () => setup.value.governance.quorumBasisPoints / 100,
  set: (value: number) => {
    setup.value.governance.quorumBasisPoints = Math.round(value * 100);
  },
});
const approvalPercent = computed({
  get: () => setup.value.governance.approvalBasisPoints / 100,
  set: (value: number) => {
    setup.value.governance.approvalBasisPoints = Math.round(value * 100);
  },
});
const preset = computed(() => DaoPresets.find((preset) => preset.id === setup.value.presetId));
watch(
  () => setup.value.presetId,
  (id) => {
    const defaults = defaultDaoSetup(id).governance;
    setup.value.governance = {
      ...defaults,
      guardian: setup.value.governance.guardian,
      governedWorks:
        setup.value.participantMode === 'agents-guarded' ? true : defaults.governedWorks,
    };
  },
);
watch(
  () => setup.value.participantMode,
  (mode) => {
    if (mode === 'agents-guarded') setup.value.governance.governedWorks = true;
  },
);
const resolved = computed(() => {
  try {
    return DaoSetupSchema.parse({
      ...setup.value,
      governance: {
        ...setup.value.governance,
        maxCommitment: parseUnits(maxAmount.value || '0', precision.value).toString(),
        dailyCommitment: parseUnits(dailyAmount.value || '0', precision.value).toString(),
      },
    });
  } catch {
    return null;
  }
});
const foundingAgent = computed(() => {
  try {
    return FoundingAgentSchema.parse({
      signingKey: agentSigningKey.value,
      encryptionKey: JSON.parse(agentEncryptionKey.value),
      operator: agentOperator.value,
    });
  } catch {
    return null;
  }
});
const ready = computed(
  () =>
    resolved.value !== null &&
    (setup.value.participantMode !== 'agents-guarded' || foundingAgent.value !== null),
);
const available = computed(
  () =>
    platform.value?.chain?.sharedAvailable &&
    platform.value.chain.network.chainId === state.network?.chainId &&
    state.network?.capabilities.includes('shared-dao-create') &&
    state.network.capabilities.includes('dao-presets'),
);
async function create() {
  if (!state.network || !resolved.value || deployment.value !== 'shared') return;
  const request = ++orderSequence;
  const accountId = state.account?.id;
  busy.value = true;
  error.value = '';
  try {
    if (!quotedInput.value) {
      orderId.value = crypto.randomUUID();
      quotedInput.value = {
        requestId: orderId.value,
        deployment: 'shared',
        method: method.value,
        request: {
          metadata: { schemaVersion: 1, title: title.value, description: description.value },
          privacy: privacy.value,
          token: {
            chainId: state.network.chainId,
            contract: token.value,
            symbol: symbol.value,
            precision: precision.value,
          },
          setup: resolved.value,
          ...(setup.value.participantMode === 'agents-guarded' && foundingAgent.value
            ? { foundingAgent: foundingAgent.value }
            : {}),
        },
      };
      await router.replace({ path: '/create', query: { order: orderId.value } });
    }
    const input = quotedInput.value;
    if (request !== orderSequence || accountId !== state.account?.id || !input) return;
    const result = await api.creationOrder(input);
    if (request !== orderSequence || accountId !== state.account?.id) return;
    acceptOrder(result);
  } catch (cause) {
    if (request === orderSequence) error.value = friendlyError(cause);
  } finally {
    if (request === orderSequence) busy.value = false;
  }
}
async function checkOrder() {
  if (!orderId.value) return;
  const request = ++orderSequence;
  const accountId = state.account?.id;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.creationOrderStatus(orderId.value);
    if (request !== orderSequence || accountId !== state.account?.id) return;
    acceptOrder(result);
    if (order.value?.state === 'created' && order.value.dao) {
      const dao = order.value.dao;
      await state.refresh();
      if (request === orderSequence) await router.push('/dao/' + dao.daoId);
    }
  } catch (cause) {
    if (request === orderSequence) error.value = friendlyError(cause);
  } finally {
    if (request === orderSequence) busy.value = false;
  }
}
async function completeOrder() {
  if (order.value?.state !== 'paid') return;
  busy.value = true;
  error.value = '';
  const request = ++orderSequence,
    accountId = state.account?.id;
  try {
    const result = await api.creationFulfill(orderId.value);
    if (request !== orderSequence || accountId !== state.account?.id) return;
    acceptOrder(result);
    if (result.dao) {
      await state.refresh();
      if (request === orderSequence) await router.push('/dao/' + result.dao.daoId);
    }
  } catch (cause) {
    if (request === orderSequence) error.value = friendlyError(cause);
  } finally {
    if (request === orderSequence) busy.value = false;
  }
}
async function checkout() {
  const request = ++orderSequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.creationCheckout(orderId.value);
    if (request !== orderSequence) return;
    const url = new URL(result.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'checkout.stripe.com' ||
      url.username ||
      url.password
    )
      throw new Error('CHECKOUT_URL');
    window.location.assign(url.toString());
  } catch (cause) {
    if (request === orderSequence) error.value = friendlyError(cause);
  } finally {
    if (request === orderSequence) busy.value = false;
  }
}
async function resume() {
  orderId.value = resumeId.value.trim();
  await router.replace({ path: '/create', query: { order: orderId.value } });
  await checkOrder();
}
function newOrder() {
  if (orderId.value) previousOrders.value = [...new Set([...previousOrders.value, orderId.value])];
  orderSequence++;
  busy.value = false;
  error.value = '';
  order.value = undefined;
  quotedInput.value = undefined;
  orderId.value = '';
  void router.replace('/create');
}
watch(
  () => JSON.stringify([state.account?.id, state.network?.chainId, state.network?.runtime]),
  () => {
    orderSequence++;
    busy.value = false;
    error.value = '';
    platform.value = undefined;
    order.value = undefined;
    previousOrders.value = [];
    quotedInput.value = undefined;
    void loadPlatform();
    if (state.account && state.network && orderId.value) void checkOrder();
  },
  { flush: 'sync' },
);
watch(
  () => route.query.order,
  (value) => {
    const id = typeof value === 'string' ? value : '';
    if (id === orderId.value) return;
    orderSequence++;
    busy.value = false;
    order.value = undefined;
    quotedInput.value = undefined;
    orderId.value = id;
    resumeId.value = id;
    if (state.account && state.network && id) void checkOrder();
  },
);
onBeforeUnmount(() => {
  orderSequence++;
  loadSequence++;
});
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">START A COMMUNITY</p>
      <h1>Create a DAO</h1>
      <p class="lead">Choose your deployment, account policy, and governance asset.</p>
    </div>
    <RouterLink class="help-link" to="/docs/deployments">Deployment guide ↗</RouterLink>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <div v-if="!state.account" class="panel narrow">
    <h2>Set up your account first</h2>
    <p>Your internal account becomes the first administrator of this DAO.</p>
    <RouterLink class="button" :to="{ path: '/account', query: { returnTo: route.fullPath } }"
      >Set up account</RouterLink
    >
  </div>
  <section v-else-if="order" class="panel narrow">
    <h2>{{ order.setup.metadata.title }}</h2>
    <p>{{ order.setup.metadata.description }}</p>
    <h3>Review this saved setup</h3>
    <dl class="fact-list">
      <dt>Deployment</dt>
      <dd>{{ order.deployment }}</dd>
      <dt>Purpose / participants</dt>
      <dd>
        {{ order.setup.setup?.presetId ?? 'custom' }} ·
        {{ order.setup.setup?.participantMode ?? 'humans' }}
      </dd>
      <dt>Document privacy</dt>
      <dd>{{ order.setup.privacy }}</dd>
      <dt>Treasury asset</dt>
      <dd>
        {{ order.setup.token.symbol }} · {{ order.setup.token.contract }} ·
        {{ order.setup.token.precision }} decimals
      </dd>
      <template v-if="order.setup.setup"
        ><dt>Voting</dt>
        <dd>
          {{ order.setup.setup.governance.weight }} · quorum
          {{ order.setup.setup.governance.quorumBasisPoints / 100 }}% · approval
          {{ order.setup.setup.governance.approvalBasisPoints / 100 }}% ·
          {{ order.setup.setup.governance.duration }} seconds
        </dd>
        <dt>Funding policy</dt>
        <dd>
          {{
            order.setup.setup.governance.governedWorks
              ? 'Member vote required'
              : 'Administrator approval'
          }}
        </dd>
        <dt>Guardian</dt>
        <dd>{{ order.setup.setup.governance.guardian || 'None' }}</dd></template
      >
      <dt>Founding participant</dt>
      <dd class="mono wrap">{{ order.creator.signingKey }} · {{ order.creator.custody }}</dd>
    </dl>
    <details>
      <summary>Complete immutable setup and public keys</summary>
      <pre class="wrap">{{
        JSON.stringify({ setup: order.setup, creator: order.creator }, null, 2)
      }}</pre>
    </details>
    <p>
      This order cannot be edited. Verify its name, rules, privacy and public keys before paying.
    </p>
    <h3>DAO setup payment</h3>
    <p>
      Network: <strong>{{ order.network.environment }}</strong> · {{ order.network.runtime }}
    </p>
    <p class="field-help break-word">Chain ID: {{ order.network.chainId }}</p>
    <p>
      Shared DAO setup: <strong>{{ usd(order.usdCents) }}</strong> USD.
    </p>
    <p>
      Order <code>{{ order.requestId }}</code> · {{ order.state }}
    </p>
    <template v-if="order.state === 'awaiting-payment'">
      <p>Expires {{ new Date(order.expires * 1000).toLocaleString() }}.</p>
      <template v-if="order.method === 'tlos'">
        <p>
          The quoted amount includes the conversion premium. Send the exact amount before expiry.
        </p>
        <dl class="fact-list">
          <dt>Amount</dt>
          <dd>{{ order.tlosAmount }}</dd>
          <dt>Recipient</dt>
          <dd>{{ order.recipient }}</dd>
          <dt>Token contract</dt>
          <dd>{{ order.tokenContract }}</dd>
          <dt>Memo</dt>
          <dd class="break-word">{{ order.memo }}</dd>
        </dl>
        <p>
          Pay with a native Telos wallet. Payment funds the platform fee treasury; it is separate
          from this DAO's treasury.
        </p>
      </template>
      <button v-else :disabled="busy" @click="checkout">
        Pay {{ usd(order.usdCents) }} by card
      </button>
    </template>
    <p v-else-if="order.state === 'expired'">
      This unpaid order has expired. Do not send payment; start a new order.
    </p>
    <p v-else-if="order.state === 'paid'">
      Payment verified; setup execution is pending. Review the saved setup, then create your DAO. A
      failed attempt preserves this payment for retry.
    </p>
    <p v-else>DAO created. This receipt has been used and cannot create a second DAO.</p>
    <button v-if="order.state === 'paid'" :disabled="busy" @click="completeOrder">
      Create this paid DAO
    </button>
    <button class="secondary" :disabled="busy" @click="checkOrder">
      {{ busy ? 'Checking…' : 'Check payment status' }}
    </button>
    <button
      v-if="order.state === 'awaiting-payment' || order.state === 'expired'"
      class="text-button"
      :disabled="busy"
      @click="newOrder"
    >
      Start a different order
    </button>
    <p class="field-help">
      Starting a different order does not cancel or refund this saved request. Bookmark
      <RouterLink :to="{ path: '/create', query: { order: order.requestId } }"
        >this order</RouterLink
      >. Keep this order ID. A browser return or a transaction ID you enter is not accepted as
      payment proof.
    </p>
  </section>
  <form v-else class="panel form-panel" @submit.prevent="create">
    <div v-if="quotedInput" class="notice">
      <p>
        This saved request is immutable. Retry it after resolving the error, or start a different
        order to change its setup. Keep the saved link in case the earlier quote completed.
      </p>
      <button type="button" class="secondary" :disabled="busy" @click="newOrder">
        Start a different order
      </button>
    </div>
    <fieldset :disabled="!!quotedInput">
      <legend>02 · Public identity</legend>
      <label for="dao-title">DAO name</label
      ><input
        id="dao-title"
        v-model="title"
        maxlength="160"
        required
        placeholder="e.g. Ocean Commons"
      /><label for="dao-description">Description</label
      ><textarea
        id="dao-description"
        v-model="description"
        maxlength="1800"
        rows="3"
        placeholder="What is your community here to do?"
      ></textarea>
      <p class="field-help">
        These fields are public on the blockchain, including for DAOs with encrypted documents.
      </p>
    </fieldset>
    <fieldset :disabled="!!quotedInput">
      <legend>03 · Document privacy</legend>
      <label for="privacy">Privacy policy</label
      ><select id="privacy" v-model="privacy">
        <option value="public">Public content</option>
        <option value="encrypted-managed-allowed">
          Encrypted content · managed accounts allowed
        </option>
        <option value="encrypted-user-controlled">
          Encrypted content · user-controlled keys required
        </option>
      </select>
      <p class="field-help">
        Encryption protects document contents. Memberships, votes, balances, and transaction
        metadata remain public. <RouterLink to="/docs/privacy">Read the privacy limits</RouterLink>.
      </p>
    </fieldset>
    <fieldset :disabled="!!quotedInput">
      <legend>Purpose and participants</legend>
      <label for="dao-purpose">DAO purpose</label>
      <select id="dao-purpose" v-model="setup.presetId">
        <option v-for="preset in DaoPresets" :key="preset.id" :value="preset.id">
          {{ preset.title }}
        </option>
      </select>
      <p class="field-help">{{ preset?.description }}</p>
      <p class="field-help">
        Initial modules: {{ preset?.modules.join(', ') }}. Purpose labels do not grant permissions.
      </p>
      <label for="participants">Participants</label>
      <select id="participants" v-model="setup.participantMode">
        <option value="humans">Human members</option>
        <option value="mixed">Humans and registered agents</option>
        <option value="agents-guarded">Agents with human emergency controls</option>
      </select>
      <p v-if="setup.participantMode !== 'humans'" class="field-help">
        Separate keys do not prove independent operators or decisions made exclusively by AI.
      </p>
      <template v-if="setup.participantMode === 'agents-guarded'">
        <p class="notice">
          Your human account sponsors creation and does not receive a voting membership.
        </p>
        <label for="agent-signing">Founding agent signing public key</label
        ><input
          id="agent-signing"
          v-model="agentSigningKey"
          required
          maxlength="128"
          placeholder="PUB_K1_…"
        />
        <label for="agent-encryption">Founding agent encryption public key (JWK)</label
        ><textarea
          id="agent-encryption"
          v-model="agentEncryptionKey"
          required
          rows="3"
          placeholder='{"kty":"EC","crv":"P-256","x":"…","y":"…"}'
        ></textarea>
        <label for="agent-operator">Declared agent operator</label
        ><input id="agent-operator" v-model="agentOperator" required maxlength="64" />
        <p class="field-help">
          Provide public keys only. The first agent becomes administrator. Its signing key remains
          outside this browser.
        </p>
      </template>
    </fieldset>
    <fieldset :disabled="!!quotedInput">
      <legend>01 · Deployment</legend>
      <div class="choice-grid">
        <label class="choice"
          ><input v-model="deployment" type="radio" value="shared" name="deployment" /><span
            ><strong>Shared contract · {{ usd(sharedPrice) }}</strong
            ><small
              >Start with a managed runtime. The deployment operator controls contract
              upgrades.</small
            ></span
          ></label
        ><label class="choice"
          ><input v-model="deployment" type="radio" value="independent" name="deployment" /><span
            ><strong>Independent contract · {{ usd(independentPrice) }} + resources</strong
            ><small
              >Your DAO controls its deployment and upgrade permissions. Connect it to the hub
              afterward.</small
            ></span
          ></label
        >
      </div>
    </fieldset>
    <details :open="setup.participantMode === 'agents-guarded'">
      <summary>Advanced governance and emergency safeguards</summary>
      <fieldset :disabled="!!quotedInput">
        <legend>Governance and safeguards</legend>
        <label for="weight">Voting weight</label
        ><select id="weight" v-model="setup.governance.weight">
          <option value="member">One approved member, one vote</option>
          <option value="credit">Internal governance credits</option>
          <option value="native-stake">Deposited native stake</option>
        </select>
        <p class="field-help">
          Credit and stake voting require eligible balances before a ballot can open.
        </p>
        <label for="ballot-duration">Ballot duration (seconds)</label
        ><input
          id="ballot-duration"
          v-model.number="setup.governance.duration"
          type="number"
          min="60"
          max="2592000"
          required
        />
        <label for="quorum">Quorum (%)</label
        ><input
          id="quorum"
          v-model.number="quorumPercent"
          type="number"
          min="0.01"
          max="100"
          step="0.01"
          required
        />
        <label for="approval">Approval (%)</label
        ><input
          id="approval"
          v-model.number="approvalPercent"
          type="number"
          min="50.01"
          max="100"
          step="0.01"
          required
        />
        <p class="field-help">Every ballot must use the saved weight, duration and thresholds.</p>
        <label class="choice"
          ><input
            v-model="setup.governance.governedWorks"
            type="checkbox"
            :disabled="setup.participantMode === 'agents-guarded'"
          /><span>Require a member vote for Works funding</span></label
        >
        <label for="commitment-cap">Maximum per milestone / installment ({{ symbol }})</label
        ><input
          id="commitment-cap"
          v-model="maxAmount"
          inputmode="decimal"
          placeholder="0 means unlimited"
          :required="setup.participantMode === 'agents-guarded'"
        />
        <label for="daily-cap">Maximum commitments per UTC day ({{ symbol }})</label
        ><input
          id="daily-cap"
          v-model="dailyAmount"
          inputmode="decimal"
          placeholder="0 means unlimited"
          :required="setup.participantMode === 'agents-guarded'"
        />
        <label for="guardian">Human guardian account</label
        ><input
          id="guardian"
          v-model="setup.governance.guardian"
          maxlength="13"
          :required="setup.participantMode === 'agents-guarded'"
          placeholder="Native Antelope account; optional for human or mixed DAOs"
        />
        <p class="field-help">
          A guardian can pause commitments and payouts for up to 24 hours per instruction, revoke
          agents and recover their signing identity. Recovery can impersonate that agent. It does
          not automatically grant votes or document keys.
        </p>
        <p class="field-help">
          Daily limits apply when funds are committed, rather than when an existing obligation is
          paid. Cancelling does not replenish that day's allowance.
        </p>
      </fieldset>
    </details>
    <aside class="notice">
      Preset v{{ setup.presetVersion }} configures this DAO once. Administrators control admission,
      roles, credit issuance and later policy changes; active ballots block policy changes. A policy
      revision invalidates pending funding execution. The shared operator retains native owner and
      contract upgrade powers. <RouterLink to="/docs/dao-presets">Read the setup guide</RouterLink>.
    </aside>
    <aside v-if="deployment === 'independent'" class="notice">
      Independent setup is {{ usd(independentPrice) }} USD, plus native account creation, CPU, NET
      and RAM charged separately. Self-service deployment and checkout are not available yet. Use
      the deployment kit. <RouterLink to="/docs/deployments">Open the deployment guide</RouterLink>.
    </aside>
    <details>
      <summary>Advanced treasury asset · {{ symbol }}</summary>
      <fieldset :disabled="!!quotedInput">
        <legend>04 · Native treasury asset</legend>
        <div class="three-column">
          <div>
            <label for="token">Token contract</label
            ><input id="token" v-model="token" required maxlength="13" />
          </div>
          <div>
            <label for="symbol">Symbol</label
            ><input id="symbol" v-model="symbol" required pattern="[A-Z]{1,7}" maxlength="7" />
          </div>
          <div>
            <label for="precision">Precision</label
            ><input
              id="precision"
              v-model.number="precision"
              type="number"
              min="0"
              max="18"
              required
            />
          </div>
        </div>
        <p class="field-help">
          Use the exact token contract, symbol, and precision. Governance credits are separate,
          nontransferable internal units.
        </p>
      </fieldset>
    </details>
    <fieldset :disabled="!!quotedInput">
      <legend>05 · Setup payment</legend>
      <label for="payment-method">Pay with</label
      ><select id="payment-method" v-model="method">
        <option value="tlos" :disabled="!platform?.chain?.rateFresh">
          TLOS · {{ premium }}% conversion premium
        </option>
        <option value="card" :disabled="!cardAvailable">
          Card · USD{{ cardAvailable ? '' : ' (unconfigured)' }}
        </option>
      </select>
      <p v-if="!platform?.chain?.rateFresh" class="notice">
        A fresh TLOS conversion rate is unavailable. The operator must publish a current observation
        before a TLOS quote can be prepared.
      </p>
      <p class="field-help">
        Shared setup: {{ usd(sharedPrice) }} USD. TLOS converts this fee with a {{ premium }}%
        premium using a fresh quote. Independent setup: {{ usd(independentPrice) }} USD plus
        blockchain resources. Prices are captured when your order is prepared.
      </p>
      <RouterLink to="/docs/creation-fees">Payment guide ↗</RouterLink>
    </fieldset>
    <div class="form-footer">
      <span v-if="!available" class="muted">Shared creation is unavailable on this deployment.</span
      ><button
        :disabled="
          busy ||
          !available ||
          !ready ||
          deployment !== 'shared' ||
          (method === 'tlos' && !platform?.chain?.rateFresh) ||
          (method === 'card' && !cardAvailable)
        "
      >
        {{ busy ? 'Preparing order…' : 'Review setup payment' }}
      </button>
    </div>
  </form>
  <p v-if="previousOrders.length" class="notice">
    Earlier saved requests: check their current status before paying again.
    <RouterLink
      v-for="id in previousOrders"
      :key="id"
      :to="{ path: '/create', query: { order: id } }"
      >{{ id }}
    </RouterLink>
  </p>
  <form v-if="state.account && !order" class="panel narrow" @submit.prevent="resume">
    <h2>Resume a setup order</h2>
    <label for="resume-order">Order ID</label
    ><input id="resume-order" v-model="resumeId" required /><button :disabled="busy">
      Check existing order
    </button>
    <p v-if="quotedInput" class="field-help">
      Pending order: {{ orderId }}. Retry the original request before paying or starting another.
    </p>
  </form>
</template>
