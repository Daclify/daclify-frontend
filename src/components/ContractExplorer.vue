<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { PlatformStatus } from '@daclify/core-protocol';
import { APIClient, type API } from '@wharfkit/antelope';
import { ArrowRight, RefreshCw } from '@lucide/vue';
import {
  authorityConnections,
  contractConnections,
  permissionGraph,
  releaseState,
  resourceReading,
} from '../content/contract-map';

import PermissionMap from './PermissionMap.vue';
import ContractDiagram from './ContractDiagram.vue';

const props = defineProps<{ chain: PlatformStatus['chain']; active: boolean }>();
const selectedAccount = ref(''),
  focused = ref('');
const readings = shallowRef<Record<string, API.v1.AccountObject>>({});
const failures = ref<string[]>([]),
  resourceError = ref(''),
  resourceBusy = ref(false),
  resourceChecked = ref('');
const contracts = computed(() => props.chain?.contracts ?? []);
const selected = computed(
  () => contracts.value.find((c) => c.account === selectedAccount.value) ?? contracts.value[0],
);
const graph = computed(() =>
  selected.value ? permissionGraph(selected.value) : { nodes: [], edges: [], roots: [] },
);
const node = computed(() => graph.value.nodes.find((n) => n.id === focused.value));
const connections = computed(() =>
  selected.value && node.value
    ? authorityConnections(contracts.value, selected.value, node.value)
    : [],
);
const relatedAccounts = computed(
  () => new Set(connections.value.map((connection) => connection.account)),
);
const delegatedDefinition = computed(
  () =>
    node.value?.kind === 'account' &&
    contracts.value.some(
      (contract) =>
        contract.account === node.value?.actor &&
        contract.permissions.some((permission) => permission.name === node.value?.permission),
    ),
);
const diagramConnections = computed(() => contractConnections(contracts.value, readings.value));
const accountDetails = computed(() => {
  const contract = selected.value;
  if (!contract) return;
  const reading = readings.value[contract.account];
  const resources = [
    {
      label: 'RAM',
      ...resourceReading(
        reading
          ? BigInt(reading.ram_usage.toString())
          : contract.ramUsed !== null && Number.isSafeInteger(contract.ramUsed)
            ? BigInt(contract.ramUsed)
            : undefined,
        reading
          ? BigInt(reading.ram_quota.toString())
          : contract.ramBytes !== null
            ? BigInt(contract.ramBytes)
            : undefined,
        'bytes',
      ),
    },
    {
      label: 'CPU',
      ...resourceReading(
        reading ? BigInt(reading.cpu_limit.used.toString()) : undefined,
        reading ? BigInt(reading.cpu_limit.max.toString()) : undefined,
        'µs',
      ),
    },
    {
      label: 'NET',
      ...resourceReading(
        reading ? BigInt(reading.net_limit.used.toString()) : undefined,
        reading ? BigInt(reading.net_limit.max.toString()) : undefined,
        'bytes',
      ),
    },
  ];
  return {
    contract,
    resources,
    state: releaseState(contract),
    unavailable: failures.value.includes(contract.account) || !!resourceError.value,
  };
});
function chooseContract(account: string) {
  selectedAccount.value = account;
  focused.value = '';
}
function chooseConnection(account: string, permission: string) {
  const contract = contracts.value.find((c) => c.account === account);
  if (!contract) return;
  chooseContract(contract.account);
  focused.value = 'permission:' + permission;
  void nextTick(() => document.getElementById('contract-map-inspector')?.focus());
}
let sequence = 0,
  controller: AbortController | undefined;
function cancelResources() {
  sequence++;
  controller?.abort();
  resourceBusy.value = false;
}
async function readResources() {
  if (resourceBusy.value || !props.active || !props.chain || !contracts.value.length) return;
  cancelResources();
  const current = sequence,
    chain = props.chain;
  readings.value = {};
  failures.value = [];
  resourceError.value = '';
  resourceChecked.value = '';
  if (!chain.chainMatches) {
    resourceError.value = 'Resource chain mismatch. Check the configured network.';
    return;
  }
  const abort = new AbortController();
  controller = abort;
  resourceBusy.value = true;
  const client = new APIClient({
    url: chain.network.rpcUrl,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, {
        ...init,
        credentials: 'omit',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      }),
  });
  try {
    const info = await client.v1.chain.get_info();
    if (current !== sequence) return;
    if (info.chain_id.toString() !== chain.network.chainId) {
      resourceError.value = 'Resource chain mismatch. RPC returned a different chain.';
      return;
    }
    await Promise.all(
      chain.contracts.map(async (contract) => {
        try {
          const account = await client.v1.chain.get_account(contract.account);
          if (current !== sequence) return;
          if (account.account_name.toString() !== contract.account)
            throw new Error('ACCOUNT_MISMATCH');
          readings.value = { ...readings.value, [contract.account]: account };
        } catch {
          if (current === sequence) failures.value.push(contract.account);
        }
      }),
    );
    if (current === sequence) resourceChecked.value = new Date().toISOString();
  } catch {
    if (current === sequence)
      resourceError.value = 'Resource readings unavailable. Use Refresh resources to try again.';
  } finally {
    if (current === sequence) resourceBusy.value = false;
  }
}
watch(
  () => [props.chain, props.active] as const,
  ([chain, active], previous) => {
    cancelResources();
    if (chain !== previous?.[0]) {
      readings.value = {};
      failures.value = [];
      resourceError.value = '';
      resourceChecked.value = '';
      if (!contracts.value.some((c) => c.account === selectedAccount.value)) {
        selectedAccount.value = contracts.value[0]?.account ?? '';
        focused.value = '';
      }
      if (!graph.value.nodes.some((n) => n.id === focused.value)) focused.value = '';
    }
    if (active) void readResources();
  },
  { immediate: true },
);
onUnmounted(cancelResources);
</script>

<template>
  <section class="contract-explorer" aria-label="Contract explorer">
    <div class="explorer-heading">
      <div>
        <h2>Contracts and authorities</h2>
        <p>Explore how contract accounts connect and who can authorize them.</p>
      </div>
      <RouterLink to="/docs/contract-permissions"
        >Permission guide <ArrowRight :size="16" aria-hidden="true"
      /></RouterLink>
    </div>
    <template v-if="contracts.length">
      <ContractDiagram
        :contracts="contracts"
        :connections="diagramConnections"
        :runtime="chain?.network.runtime ?? ''"
        :selected="selected?.account ?? ''"
        :related="relatedAccounts"
        @select="chooseContract"
      />
      <section
        v-if="selected && accountDetails"
        id="contract-account-details"
        class="account-details"
        aria-label="Contract Account Details"
      >
        <div class="account-heading">
          <div>
            <p class="eyebrow">Contract Account Details</p>
            <h3>{{ selected.account }}</h3>
            <p class="account-module">
              {{ selected.moduleId ?? 'Runtime / platform' }} ·
              {{ chain?.network.environment }} network
            </p>
          </div>
          <span class="release-state" :data-state="accountDetails.state">{{
            accountDetails.state
          }}</span>
        </div>
        <div class="resource-grid">
          <div
            v-for="resource in accountDetails.resources"
            :key="resource.label"
            class="resource-row"
          >
            <div class="resource-label">
              <strong>{{ resource.label }}</strong>
              <span :class="{ 'over-capacity': resource.over }">{{
                resource.label !== 'RAM' && accountDetails.unavailable
                  ? 'Unavailable'
                  : resource.label !== 'RAM' && !readings[selected.account] && resourceBusy
                    ? 'Checking…'
                    : resource.used
              }}</span>
            </div>
            <div
              v-if="resource.percent !== undefined"
              class="resource-meter"
              role="meter"
              :aria-label="selected.account + ' ' + resource.label + ' usage'"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="resource.percent"
              :aria-valuetext="resource.used + ' used / ' + resource.capacity"
              :data-full="resource.percent >= 90"
            >
              <span :style="{ width: resource.percent + '%' }"></span>
            </div>
            <small
              >{{ resource.capacity }}{{ resource.over ? ' · over capacity' : ''
              }}<template v-if="resource.label === 'RAM' && !readings[selected.account]">
                · status snapshot</template
              ></small
            >
          </div>
        </div>
        <div class="resource-status">
          <div aria-live="polite">
            <p v-if="resourceBusy">Checking account resources…</p>
            <p v-else-if="resourceError" class="resource-warning">{{ resourceError }}</p>
            <p v-else-if="failures.length" class="resource-warning">
              Resource readings unavailable for {{ failures.join(', ') }}. Retry with Refresh
              resources.
            </p>
            <p v-else-if="resourceChecked">
              Resource readings checked
              <time :datetime="resourceChecked">{{
                new Date(resourceChecked).toLocaleTimeString()
              }}</time>
            </p>
            <small
              >CPU in microseconds; RAM and NET in bytes. Account resources are read separately from
              the permission snapshot.</small
            >
          </div>
          <button
            type="button"
            class="secondary"
            :aria-disabled="resourceBusy"
            @click="readResources"
          >
            <RefreshCw :size="16" aria-hidden="true" /> Refresh resources
          </button>
        </div>
        <PermissionMap
          :selected="selected"
          :graph="graph"
          :account="readings[selected.account]"
          v-model="focused"
        />
        <section
          v-if="node"
          id="contract-map-inspector"
          class="authority-inspector"
          aria-label="Selected authority"
          tabindex="-1"
        >
          <h4>{{ node.kind === 'key' ? 'Shared signing authority' : node.label }}</h4>
          <p v-if="node.kind !== 'permission'">
            {{
              node.kind === 'key'
                ? 'Highlighted permissions and contracts list this same public key. Each permission retains its own threshold.'
                : node.kind === 'code'
                  ? 'Code authority lets this account’s deployed contract contribute authorization during execution.'
                  : node.kind === 'wait'
                    ? 'A transaction delay contributes the listed weight.'
                    : 'This delegates weight to another account’s permission. Its full authority may be outside these contract readings.'
            }}
          </p>
          <button
            v-if="delegatedDefinition && node.actor && node.permission"
            type="button"
            class="text-button"
            :aria-label="'Inspect ' + node.actor + '@' + node.permission"
            @click="chooseConnection(node.actor, node.permission)"
          >
            Inspect {{ node.actor }}@{{ node.permission }}
            <ArrowRight :size="16" aria-hidden="true" />
          </button>
          <div v-if="connections.length" class="connection-list">
            <h5>Observed connections</h5>
            <button
              v-for="(connection, index) in connections"
              :key="index"
              type="button"
              @click="chooseConnection(connection.account, connection.permission)"
            >
              <span
                ><strong>{{ connection.account }}@{{ connection.permission }}</strong
                ><small>{{ connection.relation }} · Weight {{ connection.weight }}</small></span
              >
              <ArrowRight :size="16" aria-hidden="true" />
            </button>
          </div>
          <p v-else class="field-help">
            No additional matching delegation or shared key was observed in the returned contracts.
          </p>
        </section>
        <details class="contract-details">
          <summary>Release details</summary>
          <dl>
            <dt>Code hash</dt>
            <dd>{{ selected.codeHash ?? 'Unknown' }}</dd>
            <dt>Pinned hash</dt>
            <dd>{{ selected.expectedHash ?? 'No pin' }}</dd>
            <dt>Artifact match</dt>
            <dd>{{ accountDetails.state }}</dd>
          </dl>
        </details>
      </section>
    </template>
    <p v-else class="panel">
      Contract readings unavailable. Refresh to check again; no contract verification is implied.
    </p>
  </section>
</template>

<style scoped>
.contract-explorer {
  min-width: 0;
}
.explorer-heading,
.account-heading,
.resource-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.explorer-heading {
  margin-bottom: 20px;
}
.explorer-heading h2 {
  font-size: 1.25rem;
  margin-bottom: 8px;
}
.explorer-heading p {
  color: var(--text-muted);
  margin: 0;
}
.explorer-heading a {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 0.875rem;
}
.account-details {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
}
.account-heading {
  margin-bottom: 24px;
}
.account-heading .eyebrow {
  font-size: 0.6875rem;
  margin: 0 0 8px;
}
.account-heading h3 {
  margin: 0;
  font-size: 1.25rem;
  overflow-wrap: anywhere;
}
.account-module {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 8px 0 0;
}
.release-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.release-state::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.release-state[data-state='Verified'] {
  color: var(--state-success);
}
.release-state[data-state='Hash mismatch'] {
  color: var(--state-danger);
}
.resource-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.resource-row {
  display: block;
  min-width: 0;
}
.resource-label {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 0.75rem;
  margin-bottom: 8px;
}
.resource-label strong {
  font-weight: 600;
  color: var(--text-secondary);
}
.resource-label span {
  overflow-wrap: anywhere;
}
.resource-row small {
  display: block;
  color: var(--text-muted);
  font-size: 0.6875rem;
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.resource-meter {
  height: 4px;
  background: var(--surface-soft);
  border-radius: 5px;
  overflow: hidden;
}
.resource-meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-amber);
}
.resource-meter[data-full='true'] span {
  background: var(--state-danger);
}
.over-capacity,
.resource-warning {
  color: var(--state-danger);
}
.resource-status {
  align-items: flex-start;
  margin: 18px 0 24px;
}
.resource-status p {
  font-size: 0.8125rem;
  margin: 0 0 5px;
}
.resource-status small {
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.5;
}
.resource-status > div {
  flex: 1;
  min-width: min(240px, 100%);
}
.resource-status > button {
  min-height: 44px;
  font-size: 0.8125rem;
  flex-shrink: 0;
}
.authority-inspector {
  padding: 20px 0 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.8125rem;
}
.authority-inspector h4 {
  font-size: 0.875rem;
  margin: 0 0 12px;
}
.authority-inspector p {
  color: var(--text-muted);
  line-height: 1.6;
}
.connection-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  column-gap: 24px;
  margin-top: 16px;
}
.connection-list h5 {
  grid-column: 1 / -1;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0;
}
.connection-list button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 12px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--text-secondary);
  box-shadow: none;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 400;
}
.connection-list button:hover {
  color: var(--accent-amber);
  transform: none;
  box-shadow: none;
}
.connection-list button > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.connection-list small {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-muted);
  margin-top: 5px;
}
.connection-list svg {
  flex-shrink: 0;
}
.contract-details {
  border-top: 1px solid var(--line);
  margin-top: 20px;
}
.contract-details summary {
  min-height: 44px;
  padding: 14px 0;
  cursor: pointer;
  line-height: 1.5;
  font-size: 0.8125rem;
}
.contract-details dl {
  font-size: 0.75rem;
}
.contract-details dt {
  color: var(--text-muted);
  margin-bottom: 6px;
}
.contract-details dd {
  margin: 0 0 14px;
  overflow-wrap: anywhere;
}
.contract-explorer button:focus-visible,
.authority-inspector:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .account-details {
    padding: 16px;
  }
  .resource-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
  .resource-status > button {
    width: 100%;
    justify-content: center;
  }
}
</style>
