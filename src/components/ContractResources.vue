<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue';
import { APIClient, type API } from '@wharfkit/antelope';
import { ramMarketCost, tlosAsset, type ChainPlatform } from '@daclify/core-protocol';
import { HardDrive, RefreshCw, Wallet, X } from '@lucide/vue';
import { api } from '../api/client';
import { useWorkspace } from '../state/workspace';
import {
  connectNative,
  nativeWallet,
  nativeResourcePurchase,
  ResourceBroadcastUnconfirmed,
} from '../auth/telos-zero';
import {
  capacityIncrease,
  readResourceMarket,
  resourceAmount,
  resourceTotal,
  resourceUsd,
  resourceValues,
  ResourcePurchaseSchema,
  ResourceRateSchema,
  type ResourceKind,
  type ResourcePurchase,
  type ResourceRate,
} from '../content/contract-resources';
import { accountRole, resourceReading } from '../content/contract-map';

const props = defineProps<{
  chain: ChainPlatform;
  active: boolean;
  readings: Record<string, API.v1.AccountObject>;
  busy: boolean;
  failures: string[];
  readError: string;
  checkedAt: string;
  selected: string;
}>();
const emit = defineEmits<{ refresh: [] }>();
const workspace = useWorkspace();
const dialog = ref<HTMLDialogElement>(),
  opened = ref(false),
  kind = ref<ResourceKind>('RAM');
const receiver = ref(''),
  percent = ref(125),
  enteredStake = ref('0.2500');
const loading = ref(false),
  preparing = ref(false),
  signing = ref(false);
const error = ref(''),
  sourceError = ref(''),
  notice = ref(''),
  uncertain = ref('');
const now = ref(Date.now() / 1000),
  liquid = ref<bigint | null>(null);
const source = shallowRef<Awaited<ReturnType<typeof readResourceMarket>>>();
const rate = shallowRef<ResourceRate | null>(null),
  quote = shallowRef<ResourcePurchase>();
const locked = computed(() => preparing.value || signing.value);
const selected = computed(() =>
  props.chain.contracts.find((row) => row.account === receiver.value),
);
const metric = computed(() => {
  const reading = props.readings[receiver.value];
  return reading ? resourceValues(reading, kind.value) : undefined;
});
const total = computed(() => resourceTotal(props.chain.contracts, props.readings, kind.value));
const serviceCount = computed(
  () =>
    new Set(
      props.chain.contracts
        .filter((row) => row.codeHash === '00'.repeat(32))
        .map((row) => row.account),
    ).size,
);
const availableRate = computed(() => resourceUsd(1n, rate.value, now.value) !== null);
const formatUnits = (value: bigint | null | undefined) =>
  value == null ? 'Unavailable' : tlosAsset(value);
const formatBytes = (value: bigint | null | undefined) =>
  value == null
    ? 'Unavailable'
    : value.toLocaleString('en-US') + (kind.value === 'CPU' ? ' µs' : ' bytes');
const dollars = (units: bigint | null) => {
  const cents = units === null ? null : resourceUsd(units, rate.value, now.value);
  return cents === null
    ? 'USD unavailable'
    : '$' +
        (cents / 100n).toLocaleString('en-US') +
        '.' +
        (cents % 100n).toString().padStart(2, '0');
};
function valueUnits(used: bigint | null, stake: bigint | null): bigint | null {
  if (kind.value !== 'RAM') return stake;
  if (used === null || !source.value?.market) return null;
  if (used === 0n) return 0n;
  try {
    return ramMarketCost(used, source.value.market.ram, source.value.market.tokens);
  } catch {
    return null;
  }
}
const rows = computed(() =>
  props.chain.contracts.map((contract) => {
    const reading = props.readings[contract.account];
    const values = reading ? resourceValues(reading, kind.value) : undefined;
    return {
      contract,
      values,
      display: resourceReading(
        values?.used,
        values?.capacity,
        kind.value === 'CPU' ? 'µs' : 'bytes',
      ),
      value: valueUnits(values?.used ?? null, values?.stake ?? null),
    };
  }),
);
const baseline = computed(() =>
  kind.value === 'RAM' ? metric.value?.capacity : metric.value?.stake,
);
const increase = computed(() => {
  if (baseline.value == null || baseline.value < 0n) return null;
  try {
    return baseline.value === 0n && kind.value !== 'RAM'
      ? resourceAmount(enteredStake.value)
      : capacityIncrease(baseline.value, percent.value);
  } catch {
    return null;
  }
});
const target = computed(() =>
  baseline.value == null || increase.value === null ? null : baseline.value + increase.value,
);
const preview = computed(() =>
  resourceReading(
    metric.value?.used,
    kind.value === 'RAM' ? (target.value ?? undefined) : metric.value?.capacity,
    kind.value === 'CPU' ? 'µs' : 'bytes',
  ),
);
const estimatedSpend = computed(() => {
  if (increase.value === null || increase.value <= 0n) return null;
  if (kind.value !== 'RAM') return increase.value;
  const market = source.value?.market;
  if (!market) return null;
  try {
    return ramMarketCost(increase.value, market.ram, market.tokens);
  } catch {
    return null;
  }
});
const fingerprint = computed(() =>
  JSON.stringify([
    opened.value,
    props.active,
    props.chain.network,
    props.chain.contracts.map((row) => [row.account, row.codeHash]),
    receiver.value,
    kind.value,
    percent.value,
    enteredStake.value,
    props.readings[receiver.value],
    nativeWallet.value?.actor.toString(),
    nativeWallet.value?.chain.id.toString(),
    workspace.account?.id,
  ]),
);
let intent = 0,
  sourceSequence = 0,
  controller: AbortController | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
function clearPurchase() {
  intent++;
  quote.value = undefined;
  error.value = '';
}
watch(
  fingerprint,
  () => {
    clearPurchase();
    liquid.value = null;
  },
  { flush: 'sync' },
);
function close() {
  opened.value = false;
  sourceSequence++;
  controller?.abort();
  if (timer) clearInterval(timer);
  timer = undefined;
  if (dialog.value?.open) dialog.value.close();
}
watch(
  () => props.active,
  (active) => {
    if (!active) close();
  },
);
watch(
  () => JSON.stringify(props.chain.network),
  () => {
    sourceSequence++;
    controller?.abort();
    source.value = undefined;
    rate.value = null;
    if (opened.value) void refreshSource();
  },
);
watch(
  () => props.chain.contracts.map((row) => row.account).join(','),
  () => {
    if (!props.chain.contracts.some((row) => row.account === receiver.value))
      receiver.value = props.chain.contracts[0]?.account ?? '';
  },
);
onUnmounted(close);
function client(signal: AbortSignal) {
  return new APIClient({
    url: props.chain.network.rpcUrl,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      }),
  });
}
async function readRate(): Promise<ResourceRate | null> {
  const creation = props.chain.creation;
  if (creation) {
    const value = ResourceRateSchema.parse({
      median: creation.median,
      precision: creation.precision,
      observed_at: creation.observed_at,
    });
    if (resourceUsd(1n, value, Date.now() / 1000) !== null) return value;
  }
  const nameContract = props.chain.fees?.names;
  if (!nameContract) return null;
  const names = await api.names();
  if (names.contract !== nameContract || names.tokenContract !== 'eosio.token') return null;
  const parsed = ResourceRateSchema.safeParse({
    median: names.oracleMedian,
    precision: names.oraclePrecision,
    observed_at: names.oracleObservedAt,
  });
  return parsed.success ? parsed.data : null;
}
async function refreshSource() {
  const request = ++sourceSequence;
  controller?.abort();
  const abort = new AbortController();
  controller = abort;
  clearPurchase();
  source.value = undefined;
  rate.value = null;
  sourceError.value = '';
  loading.value = true;
  try {
    if (!props.chain.chainMatches) throw new Error('RESOURCE_CHAIN_MISMATCH');
    const results = await Promise.allSettled([
      readResourceMarket(client(abort.signal), props.chain.network),
      readRate(),
    ]);
    if (request !== sourceSequence || !opened.value) return;
    if (results[0].status === 'fulfilled') source.value = results[0].value;
    else sourceError.value = 'Live system resources are unavailable. Refresh to try again.';
    if (results[1].status === 'fulfilled') rate.value = results[1].value;
  } catch {
    if (request === sourceSequence)
      sourceError.value = 'The configured resource network could not be verified.';
  } finally {
    if (request === sourceSequence) loading.value = false;
  }
}
async function open() {
  receiver.value = props.chain.contracts.some((row) => row.account === props.selected)
    ? props.selected
    : (props.chain.contracts[0]?.account ?? '');
  opened.value = true;
  now.value = Date.now() / 1000;
  await nextTick();
  dialog.value?.showModal();
  timer = setInterval(() => {
    now.value = Date.now() / 1000;
  }, 1000);
  emit('refresh');
  void refreshSource();
}
function refresh() {
  emit('refresh');
  void refreshSource();
}
function acknowledgeSubmission() {
  uncertain.value = '';
  refresh();
}
function failure(cause: unknown) {
  const code = cause instanceof Error ? cause.message : '';
  const messages: Record<string, string> = {
    RESOURCE_BALANCE:
      'This payer does not have enough liquid TLOS. Choose another account or a smaller increase.',
    RESOURCE_QUOTE_EXPIRED: 'This purchase preview expired. Prepare it again before signing.',
    RESOURCE_SYSTEM_CHANGED: 'The system contract changed. Refresh and prepare a new purchase.',
    RESOURCE_CHAIN_MISMATCH: 'The RPC returned a different network. Check the configured network.',
    WALLET_CONTEXT_CHANGED: 'The account, amount, page or wallet changed. Prepare a new purchase.',
    NATIVE_WALLET_MISSING: 'Connect the payer in Anchor first.',
    NATIVE_AUTHORITY_UNSUPPORTED: 'Choose an account with its active permission in Anchor.',
  };
  return messages[code] ?? 'The purchase could not be prepared or approved. Refresh or try again.';
}
async function connect() {
  preparing.value = true;
  error.value = '';
  try {
    await connectNative();
  } catch (cause) {
    if (opened.value) error.value = failure(cause);
  } finally {
    preparing.value = false;
  }
}
async function prepare() {
  if (
    !selected.value ||
    !nativeWallet.value ||
    increase.value === null ||
    increase.value <= 0n ||
    locked.value
  )
    return;
  clearPurchase();
  notice.value = '';
  const request = intent,
    context = fingerprint.value,
    wallet = nativeWallet.value;
  preparing.value = true;
  const abort = new AbortController();
  controller?.abort();
  controller = abort;
  try {
    const [current, balance] = await Promise.all([
      readResourceMarket(client(abort.signal), props.chain.network),
      client(abort.signal).v1.chain.get_currency_balance('eosio.token', wallet.actor, 'TLOS'),
    ]);
    if (request !== intent || context !== fingerprint.value || !opened.value) return;
    source.value = current;
    const spend = estimatedSpend.value;
    if (spend === null || spend <= 0n) throw new Error('RESOURCE_MARKET_UNAVAILABLE');
    const asset = balance[0];
    liquid.value =
      balance.length === 1 && asset?.symbol.toString() === '4,TLOS'
        ? BigInt(asset.units.toString())
        : 0n;
    if (liquid.value < spend) throw new Error('RESOURCE_BALANCE');
    quote.value = ResourcePurchaseSchema.parse({
      network: props.chain.network,
      receiver: receiver.value,
      kind: kind.value,
      units: spend.toString(),
      systemCodeHash: current.codeHash,
      systemAbiHash: current.abiHash,
      expires: Math.floor(Date.now() / 1000) + 60,
    });
  } catch (cause) {
    if (request === intent && opened.value) error.value = failure(cause);
  } finally {
    preparing.value = false;
  }
}
async function purchase() {
  const accepted = quote.value,
    context = fingerprint.value,
    request = intent;
  if (!accepted || uncertain.value || locked.value) return;
  signing.value = true;
  error.value = '';
  notice.value = '';
  try {
    const id = await nativeResourcePurchase(accepted, () => {
      if (
        request !== intent ||
        quote.value !== accepted ||
        context !== fingerprint.value ||
        !opened.value ||
        !props.active
      )
        throw new Error('WALLET_CONTEXT_CHANGED');
    });
    if (opened.value) {
      quote.value = undefined;
      emit('refresh');
      notice.value = 'Confirmed · ' + id;
    }
  } catch (cause) {
    if (cause instanceof ResourceBroadcastUnconfirmed) {
      uncertain.value = cause.transactionId;
      quote.value = undefined;
    } else if (opened.value && request === intent) error.value = failure(cause);
  } finally {
    signing.value = false;
  }
}
</script>

<template>
  <button type="button" class="secondary" :disabled="!active" @click="open">
    <HardDrive :size="16" aria-hidden="true" />Resources
  </button>
  <dialog
    ref="dialog"
    class="resource-card"
    aria-labelledby="contract-resources-heading"
    @cancel="close"
    @close="close"
  >
    <header class="card-heading">
      <div>
        <p class="eyebrow">{{ chain.network.environment }} · Telos Zero</p>
        <h2 id="contract-resources-heading">Contract resources</h2>
        <p>Monitor capacity and fund the account you choose.</p>
      </div>
      <button
        type="button"
        class="secondary close-button"
        aria-label="Close resources"
        autofocus
        @click="close"
      >
        <X :size="20" aria-hidden="true" />
      </button>
    </header>
    <div class="resource-tabs" role="group" aria-label="Resource type">
      <button
        v-for="item in ['RAM', 'CPU', 'NET'] as const"
        :key="item"
        type="button"
        class="secondary"
        :aria-pressed="kind === item"
        :disabled="locked"
        @click="kind = item"
      >
        {{ item }}
      </button>
    </div>
    <section class="resource-totals" aria-label="Resource totals">
      <div>
        <small>{{ kind }} used</small><strong>{{ formatBytes(total.used) }}</strong>
      </div>
      <div>
        <small>{{ kind === 'RAM' ? 'RAM allocated' : kind + ' staked' }}</small
        ><strong>{{
          kind === 'RAM' ? formatBytes(total.capacity) : formatUnits(total.stake)
        }}</strong>
      </div>
      <div>
        <small>{{ kind === 'RAM' ? 'Used RAM replacement estimate' : 'Stake value' }}</small
        ><strong>{{ dollars(valueUnits(total.used, total.stake)) }}</strong
        ><span>{{ formatUnits(valueUnits(total.used, total.stake)) }}</span>
      </div>
    </section>
    <p class="field-help">
      {{ total.accounts }} contract accounts{{
        serviceCount
          ? ' · ' + serviceCount + ' service accounts listed separately from totals'
          : ''
      }}.
      {{
        total.missing
          ? 'Complete totals unavailable: ' +
            total.missing +
            ' missing account' +
            (total.missing === 1 ? '' : 's') +
            '.'
          : 'Whole-account readings include code, tables and permissions.'
      }}
    </p>
    <p v-if="chain.network.environment !== 'mainnet'" class="field-help">
      USD reference using the mainnet TLOS price. Testnet and local tokens have no cash value.
    </p>
    <p v-if="!availableRate && !loading" class="field-help">
      USD estimates are unavailable without a fresh published TLOS rate.
    </p>
    <p v-if="sourceError || readError" class="alert" role="alert">{{ sourceError || readError }}</p>
    <p v-if="source && !source.market && kind === 'RAM'" class="alert" role="alert">
      The RAM market price is unavailable. CPU and NET staking remain available.
    </p>
    <div class="resource-body">
      <ul class="resource-accounts" aria-label="Account resources">
        <li
          v-for="row in rows"
          :key="row.contract.account"
          :data-selected="receiver === row.contract.account"
        >
          <div class="resource-account-heading">
            <button
              type="button"
              class="text-button"
              :aria-label="'Select ' + row.contract.account"
              :aria-pressed="receiver === row.contract.account"
              :disabled="locked"
              @click="receiver = row.contract.account"
            >
              {{ row.contract.account }}</button
            ><small
              >{{ accountRole(row.contract, chain)
              }}{{ row.contract.codeHash === '00'.repeat(32) ? ' · service account' : '' }}</small
            >
          </div>
          <div>
            <div v-if="row.display.percent !== undefined" class="usage-numbers">
              <strong>{{ row.display.percent }}% used</strong
              ><span>{{ Number((100 - row.display.percent).toFixed(2)) }}% free</span>
            </div>
            <strong v-else>{{ row.values ? row.display.capacity : 'Unavailable' }}</strong>
            <div
              v-if="row.display.percent !== undefined"
              class="usage-meter"
              role="meter"
              :aria-label="row.contract.account + ' ' + kind + ' usage'"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="row.display.percent"
              :data-full="row.display.percent >= 90"
            >
              <span :style="{ width: row.display.percent + '%' }"></span>
            </div>
            <small
              >{{ row.display.used }} / {{ row.display.capacity
              }}{{ row.display.over ? ' · over capacity' : '' }}</small
            >
          </div>
          <div class="account-value">
            <strong>{{ dollars(row.value) }}</strong
            ><small>{{ formatUnits(row.value) }}</small>
          </div>
        </li>
      </ul>
      <section class="purchase-panel" aria-labelledby="resource-purchase-heading">
        <h3 id="resource-purchase-heading">
          {{ kind === 'RAM' ? 'Buy RAM' : 'Stake ' + kind }} for {{ receiver }}
        </h3>
        <label for="resource-recipient">Recipient account</label>
        <select id="resource-recipient" v-model="receiver" :disabled="locked">
          <option
            v-for="contract in chain.contracts"
            :key="contract.account"
            :value="contract.account"
          >
            {{ contract.account }} · {{ accountRole(contract, chain) }}
          </option>
        </select>
        <div class="payer-row">
          <Wallet :size="18" aria-hidden="true" />
          <div>
            <strong>{{
              nativeWallet
                ? nativeWallet.actor + '@' + nativeWallet.permission
                : 'Choose the payer in Anchor'
            }}</strong
            ><small v-if="liquid !== null">Liquid balance: {{ formatUnits(liquid) }}</small>
          </div>
          <button type="button" class="secondary" :disabled="locked" @click="connect">
            {{ nativeWallet ? 'Change payer' : 'Connect Anchor' }}
          </button>
        </div>
        <label :for="'resource-target-' + kind"
          >{{ kind === 'RAM' ? 'RAM capacity target' : kind + ' stake target' }}
          <strong aria-hidden="true">{{ percent }}%</strong></label
        >
        <input
          :id="'resource-target-' + kind"
          v-model.number="percent"
          type="range"
          min="100"
          max="200"
          step="1"
          :disabled="locked || baseline == null || baseline <= 0n"
        />
        <div class="range-labels"><span>100% · current</span><span>200% · double</span></div>
        <template v-if="kind !== 'RAM' && baseline === 0n"
          ><label for="resource-stake-amount">Additional {{ kind }} stake in TLOS</label
          ><input
            id="resource-stake-amount"
            v-model="enteredStake"
            inputmode="decimal"
            :disabled="locked"
            placeholder="0.2500"
        /></template>
        <section class="purchase-preview" aria-label="Purchase preview">
          <template v-if="kind === 'RAM'"
            ><p>
              Estimated target: <strong>{{ formatBytes(target) }}</strong> · additional
              <strong>{{ formatBytes(increase) }}</strong
              >.
            </p>
            <p v-if="preview.percent !== undefined">
              Expected usage: <strong>{{ preview.percent }}%</strong>.
            </p>
            <p class="field-help">
              100% is today's capacity. RAM received depends on the market price at execution; the
              TLOS amount is fixed. Purchased RAM belongs to the recipient account.
            </p></template
          >
          <template v-else
            ><p>
              Additional stake: <strong>{{ formatUnits(increase) }}</strong> · target
              <strong>{{ formatUnits(target) }}</strong
              >.
            </p>
            <p class="field-help">
              Capacity varies with network conditions. This slider increases TLOS stake. The payer
              retains ownership of the new delegation.
            </p></template
          >
          <p>
            Estimated {{ kind === 'RAM' ? 'purchase' : 'stake' }}:
            <strong>{{ formatUnits(estimatedSpend) }}</strong>
            <span>{{ dollars(estimatedSpend) }}</span
            ><small v-if="kind === 'RAM'">Includes the system RAM fee.</small>
          </p>
        </section>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="signing" class="field-help">Waiting for Anchor approval and chain confirmation…</p>
        <button
          type="button"
          :disabled="
            locked ||
            loading ||
            busy ||
            !nativeWallet ||
            !source ||
            !estimatedSpend ||
            !chain.chainMatches ||
            !!uncertain
          "
          @click="prepare"
        >
          {{ preparing ? 'Preparing…' : 'Prepare purchase' }}
        </button>
        <section v-if="quote" class="prepared-purchase" aria-label="Prepared purchase">
          <p>
            <strong>{{ formatUnits(BigInt(quote.units)) }}</strong> from
            <strong>{{ nativeWallet?.actor }}</strong> to <strong>{{ quote.receiver }}</strong> ·
            {{ dollars(BigInt(quote.units)) }}.
          </p>
          <p class="field-help">
            {{
              kind === 'RAM'
                ? 'This is the full fixed debit, including the system fee. It buys account RAM directly and creates no DAO RAM credit.'
                : 'This delegates stake directly to the account and transfers no ownership.'
            }}
            Sponsorship grants no governance or account authority.
          </p>
          <p class="field-help">
            {{
              now >= quote.expires
                ? 'Preview expired. Prepare it again.'
                : 'Review and approve this transaction in Anchor.'
            }}
          </p>
          <button
            type="button"
            :disabled="locked || now >= quote.expires || !!uncertain"
            @click="purchase"
          >
            {{ kind === 'RAM' ? 'Buy RAM with Anchor' : 'Stake ' + kind + ' with Anchor' }}
          </button>
        </section>
        <p v-if="notice" class="notice transaction-notice" role="status">{{ notice }}</p>
        <div v-if="uncertain" class="alert" role="alert">
          <p>
            Submission could not be confirmed. Check this transaction in your wallet before
            preparing another purchase.
          </p>
          <code>{{ uncertain }}</code
          ><button type="button" class="secondary" @click="acknowledgeSubmission">
            I have checked this transaction
          </button>
        </div>
      </section>
    </div>
    <footer class="card-footer">
      <div>
        <small>{{
          busy
            ? 'Checking account resources…'
            : checkedAt
              ? 'Accounts checked ' + new Date(checkedAt).toLocaleTimeString()
              : 'Live account readings unavailable'
        }}</small
        ><small v-if="failures.length">Unavailable: {{ failures.join(', ') }}.</small
        ><RouterLink to="/docs/telos-resources" @click="close">Telos resource guide</RouterLink>
      </div>
      <button
        type="button"
        class="secondary"
        :disabled="locked || busy || loading"
        @click="refresh"
      >
        <RefreshCw :size="16" aria-hidden="true" />Refresh
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.resource-card {
  width: min(1000px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  padding: 28px;
  overflow: auto;
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-lg);
  background: var(--color-bg-gradient);
  color: var(--text-primary);
  box-shadow: var(--elevation-panel);
}
.resource-card::backdrop {
  background: rgba(0, 0, 0, 0.72);
}
.card-heading,
.card-footer,
.payer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.card-heading {
  align-items: flex-start;
}
.card-heading h2 {
  margin: 4px 0 8px;
}
.card-heading p {
  margin: 0;
}
.card-heading .eyebrow {
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
}
.close-button {
  padding: 8px;
  width: 44px;
  flex-shrink: 0;
}
.resource-tabs {
  display: flex;
  gap: 8px;
  margin: 24px 0 20px;
}
.resource-tabs [aria-pressed='true'] {
  border-color: var(--accent-amber);
  color: var(--accent-amber);
  background: var(--accent-soft);
}
.resource-totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.resource-totals > div {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 16px;
  background: var(--surface-panel);
  min-width: 0;
}
.resource-totals small,
.resource-totals span,
.resource-accounts small,
.payer-row small,
.card-footer small {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-top: 6px;
}
.resource-totals strong {
  display: block;
  font-size: 1.125rem;
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.resource-accounts {
  padding: 0;
  margin: 0;
  list-style: none;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.resource-accounts li {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(200px, 1.4fr) minmax(120px, 0.7fr);
  gap: 20px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);
}
.resource-accounts li:last-child {
  border-bottom: 0;
}
.resource-accounts [data-selected='true'] {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 var(--accent-amber);
}
.resource-account-heading .text-button {
  padding: 0;
  font-size: 0.875rem;
  min-height: 32px;
  overflow-wrap: anywhere;
  text-align: left;
}
.usage-numbers {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.8125rem;
}
.usage-numbers span {
  color: var(--text-secondary);
}
.usage-meter {
  height: 5px;
  border-radius: 8px;
  background: var(--surface-soft);
  overflow: hidden;
  margin: 8px 0;
}
.usage-meter span {
  display: block;
  height: 100%;
  background: var(--accent-amber);
}
.usage-meter[data-full='true'] span {
  background: var(--state-danger);
}
.account-value {
  text-align: right;
  font-size: 0.875rem;
}
.purchase-panel {
  padding: 20px;
  background: var(--surface-panel);
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-md);
}
.resource-body {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  align-items: start;
  gap: 20px;
  margin-top: 24px;
}
.resource-body .resource-accounts li {
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
}
.resource-body .resource-accounts li > div:nth-child(2) {
  grid-column: 1 / -1;
  grid-row: 2;
}
.resource-body .resource-accounts .account-value {
  grid-column: 2;
  grid-row: 1;
}
.resource-body .purchase-panel {
  position: sticky;
  top: 0;
}
.purchase-panel select {
  width: 100%;
  margin: 8px 0 20px;
}
@media (max-width: 800px) {
  .resource-body {
    grid-template-columns: 1fr;
  }
  .resource-body .purchase-panel {
    position: static;
    order: -1;
  }
}
.purchase-panel h3 {
  margin: 0 0 18px;
  overflow-wrap: anywhere;
}
.payer-row {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.payer-row > div {
  flex: 1;
  min-width: 150px;
  overflow-wrap: anywhere;
}
.purchase-panel label {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.purchase-panel input[type='range'] {
  width: 100%;
  accent-color: var(--accent-amber);
  padding: 0;
  min-height: 44px;
  border: 0;
  margin: 6px 0 0;
}
.range-labels {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 0.75rem;
}
.purchase-preview {
  margin: 20px 0;
  font-size: 0.875rem;
}
.purchase-preview small {
  display: block;
  margin-top: 5px;
  color: var(--text-muted);
}
.prepared-purchase {
  border-top: 1px solid var(--border-default);
  margin-top: 20px;
  padding-top: 6px;
}
.transaction-notice,
code {
  overflow-wrap: anywhere;
}
.card-footer {
  margin-top: 24px;
  flex-wrap: wrap;
}
.card-footer a {
  display: inline-block;
  margin-top: 8px;
  font-size: 0.8125rem;
}
@media (max-width: 680px) {
  .resource-card {
    padding: 18px;
    width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
  }
  .resource-totals {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .resource-totals > div {
    padding: 12px;
  }
  .resource-accounts li {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .account-value {
    text-align: left;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .account-value small {
    margin: 0;
  }
  .purchase-panel {
    padding: 16px;
  }
  .card-heading h2 {
    font-size: 1.25rem;
  }
}
</style>
