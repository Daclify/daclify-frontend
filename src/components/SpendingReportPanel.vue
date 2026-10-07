<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { formatReportAmount, type DaoSummary, type SpendingReport } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
const props = defineProps<{ dao: DaoSummary }>();
const report = ref<SpendingReport>(),
  busy = ref(false),
  error = ref(''),
  state = ref(''),
  category = ref(''),
  beneficiary = ref('');
let revision = 0;
const context = () => JSON.stringify(props.dao.reference);
const rows = computed(
  () =>
    report.value?.obligations.filter(
      (row) =>
        (!state.value || row.state === state.value) &&
        (!category.value || row.category === category.value) &&
        (!beneficiary.value || row.beneficiary === beneficiary.value.trim()),
    ) ?? [],
);
function amount(value: string) {
  return formatReportAmount(value, props.dao.token.precision) + ' ' + props.dao.token.symbol;
}
async function load() {
  const generation = ++revision,
    stamp = context();
  busy.value = true;
  error.value = '';
  try {
    const result = await api.spendingReport(props.dao.reference.daoId);
    if (generation !== revision || context() !== stamp) return;
    if (JSON.stringify(result.dao) !== stamp) throw new Error('DAO_REFERENCE');
    report.value = result;
  } catch (cause) {
    if (generation === revision) error.value = friendlyError(cause);
  } finally {
    if (generation === revision) busy.value = false;
  }
}
watch(
  context,
  () => {
    report.value = undefined;
    state.value = '';
    category.value = '';
    beneficiary.value = '';
    void load();
  },
  { immediate: true },
);
onUnmounted(() => {
  revision++;
});
function download(content: string, type: string, extension: string) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    link = document.createElement('a');
  link.href = url;
  link.download = `daclify-dao-${props.dao.reference.daoId}-spending.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function json() {
  if (report.value) download(JSON.stringify(report.value, null, 2), 'application/json', 'json');
}
async function csv() {
  const stamp = context(),
    generation = revision;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.spendingCsv(props.dao.reference.daoId);
    if (generation === revision && stamp === context())
      download('\uFEFF' + result.content, 'text/csv;charset=utf-8', 'csv');
  } catch (cause) {
    if (generation === revision) error.value = friendlyError(cause);
  } finally {
    if (generation === revision) busy.value = false;
  }
}
</script>
<template>
  <section class="panel">
    <div class="panel-heading">
      <h2>Spending and outcomes</h2>
      <RouterLink class="help-link" to="/docs/spending-reports">Report help ↗</RouterLink>
    </div>
    <p>Reconcile native commitments, settlements and claims. Basic portable exports are free.</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">Reading report sources…</p>
    <div class="button-row">
      <button type="button" class="secondary" :disabled="busy" @click="load">Refresh report</button
      ><button type="button" class="secondary" :disabled="busy || !report" @click="json">
        Export full JSON</button
      ><button type="button" class="secondary" :disabled="busy || !report" @click="csv">
        Export full CSV
      </button>
    </div>
    <template v-if="report"
      ><p class="field-help">
        {{ report.dao.contract }} / {{ report.dao.daoId }} · read
        {{ new Date(report.read.completedAt).toLocaleString() }} · live pages, not an atomic
        historical snapshot
      </p>
      <p v-if="!report.complete" class="notice" role="status">
        Partial or unreconciled report: {{ report.issues.join(', ') }}. Refresh or check the
        unavailable source before relying on totals.
      </p>
      <p class="field-help">
        Receipt coverage:
        {{
          report.receiptCoverage === 'since-receipt-upgrade'
            ? 'starts at the receipt upgrade; earlier withdrawals are not reconstructed'
            : 'unavailable on this runtime'
        }}.
      </p>
      <dl v-if="report.summary" class="report-totals">
        <dt>Reserved commitments</dt>
        <dd>{{ amount(report.summary.reserved) }}</dd>
        <dt>Settled obligations (including internal claims)</dt>
        <dd>{{ amount(report.summary.settledObligations) }}</dd>
        <dt>Current internal claims</dt>
        <dd>{{ amount(report.summary.claims) }}</dd>
        <dt>Recorded external cashflow</dt>
        <dd>{{ amount(report.summary.externalCashflow) }}</dd>
        <dt>Legacy settlements with unknown destination</dt>
        <dd>{{ amount(report.summary.legacyUnknownSettlements) }}</dd>
      </dl>
      <p class="field-help">
        A claim credit and its later withdrawal are one expense. Cashflow describes when native
        tokens leave the treasury; do not add it to settled obligations.
      </p>
      <div class="section-toolbar">
        <label
          >Payment state<select v-model="state">
            <option value="">All states</option>
            <option value="reserved">Reserved</option>
            <option value="approved">Approved</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select></label
        ><label
          >Source category<select v-model="category">
            <option value="">All categories</option>
            <option value="works">Works</option>
            <option value="payroll">Payroll</option>
            <option value="other">Other</option>
          </select></label
        ><label
          >Beneficiary member<input
            v-model="beneficiary"
            inputmode="numeric"
            placeholder="All members"
        /></label>
      </div>
      <p role="status">
        {{ rows.length }} of {{ report.obligations.length }} obligations. Exports include the full
        report.
      </p>
      <div class="report-table-scroll" tabindex="0" aria-label="Obligation report table">
        <table class="report-table">
          <caption class="sr-only">
            Native obligations and public outcome references
          </caption>
          <thead>
            <tr>
              <th scope="col">Obligation</th>
              <th scope="col">Beneficiary</th>
              <th scope="col">Amount</th>
              <th scope="col">State</th>
              <th scope="col">Outcome references</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <th scope="row">{{ row.source }} / {{ row.sourceId }}</th>
              <td>Member {{ row.beneficiary }}</td>
              <td>{{ amount(row.amount) }}</td>
              <td>
                {{ row.state }} · {{ row.settlement
                }}<span v-if="row.due"> · due {{ new Date(row.due * 1000).toLocaleString() }}</span>
              </td>
              <td>
                <span v-for="doc in row.documents" :key="`${doc.id}:${doc.version}`"
                  >Document {{ doc.id }} / v{{ doc.version }}{{ doc.encrypted ? ' (encrypted)' : ''
                  }}<br /></span
                ><span v-if="row.agreementTerms">Agreement commitment recorded</span
                ><span v-if="row.statements.length">
                  · {{ row.statements.length }} DAO-confirmed statement(s), not verified external
                  settlement</span
                ><span v-if="!row.documents.length && !row.agreementTerms && !row.statements.length"
                  >No module outcome reference available</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <details v-if="report.receipts.length">
        <summary>Native receipts ({{ report.receipts.length }})</summary>
        <ul class="method-list">
          <li v-for="receipt in report.receipts" :key="receipt.id">
            {{ ['Internal claim credit', 'Native payment', 'Claim withdrawal'][receipt.kind] }} ·
            {{ receipt.quantity }} · member {{ receipt.recipient
            }}<span v-if="receipt.destination"> → {{ receipt.destination }}</span>
            <details>
              <summary>Native transaction reference</summary>
              <p class="mono wrap">{{ receipt.transaction_id }}</p>
            </details>
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>
