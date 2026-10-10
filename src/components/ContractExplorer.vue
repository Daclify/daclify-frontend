<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { PlatformStatus } from '@daclify/core-protocol';
import { APIClient, type API } from '@wharfkit/antelope';
import { ArrowRight, ArrowLeft, Box, ChevronLeft, RefreshCw, Shield } from '@lucide/vue';
import {
  authorityConnections,
  permissionGraph,
  releaseState,
  resourceReading,
  type ContractReading,
} from '../content/contract-map';

import PermissionMap from './PermissionMap.vue';

const props = defineProps<{ chain: PlatformStatus['chain']; active: boolean }>();
const selectedAccount = ref(''),
  reversed = ref(''),
  focused = ref('');
const readings = shallowRef<Record<string, API.v1.AccountObject>>({});
const cardViewport = ref<HTMLElement>();
const failures = ref<string[]>([]),
  resourceError = ref(''),
  resourceBusy = ref(false),
  resourceChecked = ref('');
const contracts = computed(() => props.chain?.contracts ?? []);
const selected = computed(
  () => contracts.value.find((c) => c.account === selectedAccount.value) ?? contracts.value[0],
);
const graph = computed(() =>
  selected.value
    ? permissionGraph(selected.value)
    : { nodes: [], edges: [], width: 760, height: 296 },
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
const cards = computed(() =>
  contracts.value.map((contract) => {
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
  }),
);
function chooseContract(contract: ContractReading) {
  selectedAccount.value = contract.account;
  reversed.value = contract.account;
  focused.value = '';
}
function browseContracts(direction: number) {
  cardViewport.value?.scrollBy({ left: direction * cardViewport.value.clientWidth });
}
function chooseConnection(account: string, permission: string) {
  const contract = contracts.value.find((c) => c.account === account);
  if (!contract) return;
  chooseContract(contract);
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
        reversed.value = '';
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
        <p>Explore who can authorize each contract and how its permissions connect.</p>
      </div>
      <RouterLink to="/docs/contract-permissions"
        >Permission guide <ArrowRight :size="16" aria-hidden="true"
      /></RouterLink>
    </div>
    <template v-if="contracts.length">
      <div class="explorer-context">
        <span><Box :size="16" aria-hidden="true" /> {{ contracts.length }} contracts</span>
        <span>Public authorities · {{ chain?.network.environment }} network</span>
        <span>Select a card to explore its connections</span>
        <div class="card-browse" role="group" aria-label="Browse contract cards">
          <button
            type="button"
            class="text-button"
            aria-label="Previous contracts"
            aria-controls="contract-cards"
            @click="browseContracts(-1)"
          >
            <ArrowLeft :size="18" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="text-button"
            aria-label="Next contracts"
            aria-controls="contract-cards"
            @click="browseContracts(1)"
          >
            <ArrowRight :size="18" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        id="contract-cards"
        ref="cardViewport"
        class="contract-grid"
        role="region"
        aria-label="Contract cards"
        tabindex="0"
      >
        <article
          v-for="card in cards"
          :key="card.contract.account"
          class="contract-card"
          :aria-label="'Contract ' + card.contract.account"
          :data-selected="selected?.account === card.contract.account"
          :data-related="relatedAccounts.has(card.contract.account)"
          :data-reversed="reversed === card.contract.account"
        >
          <div class="card-heading">
            <button
              type="button"
              class="card-select"
              :aria-label="'Inspect ' + card.contract.account"
              :aria-pressed="selected?.account === card.contract.account"
              @click="chooseContract(card.contract)"
            >
              <Box :size="20" aria-hidden="true" />
              <span
                ><strong>{{ card.contract.account }}</strong
                ><small>{{ card.contract.moduleId ?? 'Runtime / platform' }}</small></span
              >
              <ArrowRight :size="18" aria-hidden="true" />
            </button>
            <span class="release-state" :data-state="card.state">{{ card.state }}</span>
            <span v-if="relatedAccounts.has(card.contract.account)" class="related-authority"
              >Connected to selected authority</span
            >
          </div>
          <div v-if="reversed !== card.contract.account" class="card-face">
            <div v-for="resource in card.resources" :key="resource.label" class="resource-row">
              <div class="resource-label">
                <strong>{{ resource.label }}</strong
                ><span :class="{ 'over-capacity': resource.over }">{{
                  resource.label !== 'RAM' && card.unavailable
                    ? 'Unavailable'
                    : resource.label !== 'RAM' && !readings[card.contract.account] && resourceBusy
                      ? 'Checking…'
                      : resource.used
                }}</span>
              </div>
              <div
                v-if="resource.percent !== undefined"
                class="resource-meter"
                role="meter"
                :aria-label="card.contract.account + ' ' + resource.label + ' usage'"
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
                }}<template v-if="resource.label === 'RAM' && !readings[card.contract.account]">
                  · status snapshot</template
                ></small
              >
            </div>
            <p class="card-hint">
              Open card for authorities <ArrowRight :size="14" aria-hidden="true" />
            </p>
          </div>
          <div v-else class="card-face card-back">
            <p class="back-count">
              <Shield :size="18" aria-hidden="true" />
              {{ card.contract.permissions.length }} permissions
            </p>
            <dl>
              <template v-for="permission in card.contract.permissions" :key="permission.name"
                ><dt>{{ permission.name }}</dt>
                <dd>
                  threshold {{ permission.threshold }} · {{ permission.keys.length }} keys
                </dd></template
              >
            </dl>
            <p class="field-help">
              Select a node in the map to see its contributors and connected contracts.
            </p>
            <button
              type="button"
              class="text-button"
              :aria-label="'Show resources for ' + card.contract.account"
              @click="reversed = ''"
            >
              <ChevronLeft :size="16" aria-hidden="true" /> Show resources
            </button>
          </div>
        </article>
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
      <div v-if="selected" class="authority-workspace">
        <PermissionMap :selected="selected" :graph="graph" v-model="focused" />
        <section
          id="contract-map-inspector"
          class="authority-inspector"
          aria-label="Selected authority"
          tabindex="-1"
        >
          <template v-if="node">
            <p class="eyebrow">
              {{ node.kind === 'permission' ? 'PERMISSION' : 'AUTHORITY CONTRIBUTOR' }}
            </p>
            <h3 class="authority-title">
              {{ node.kind === 'key' ? 'Public signing key' : node.label }}
            </h3>
            <template v-if="node.authority">
              <div class="permission-facts">
                <span>Parent: {{ node.authority.parent || 'none · root' }}</span
                ><strong>Threshold: {{ node.authority.threshold }}</strong>
              </div>
              <p>
                Contributors must supply enough weight to meet this threshold. A listed contributor
                may not be sufficient alone.
              </p>
              <ul class="contributor-list">
                <li
                  v-for="edge in graph.edges.filter(
                    (e) => e.to === node?.id && e.kind !== 'hierarchy',
                  )"
                  :key="edge.from"
                >
                  <button type="button" @click="focused = edge.from">
                    <span
                      ><small>{{
                        edge.kind === 'code'
                          ? 'Code authority'
                          : edge.kind === 'key'
                            ? 'Signing key'
                            : edge.kind === 'wait'
                              ? 'Delay'
                              : 'Delegated permission'
                      }}</small
                      >{{ graph.nodes.find((n) => n.id === edge.from)?.label }}</span
                    ><strong>Weight {{ edge.weight }}</strong>
                  </button>
                </li>
              </ul>
            </template>
            <template v-else>
              <code v-if="node.publicKey" class="full-key">{{ node.publicKey }}</code>
              <p>
                {{
                  node.kind === 'key'
                    ? 'Shared key relationships show where this same public key is listed. Each permission retains its own threshold.'
                    : node.kind === 'code'
                      ? 'Code authority lets this account’s deployed contract contribute authorization during execution.'
                      : node.kind === 'wait'
                        ? 'A transaction delay contributes the listed weight; it is not a signing key.'
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
            </template>
            <div v-if="connections.length" class="connection-list">
              <h4>Observed connections</h4>
              <button
                v-for="(connection, index) in connections"
                :key="index"
                type="button"
                @click="chooseConnection(connection.account, connection.permission)"
              >
                <span
                  ><strong>{{ connection.account }}@{{ connection.permission }}</strong
                  ><small>{{ connection.relation }} · Weight {{ connection.weight }}</small></span
                ><ArrowRight :size="16" aria-hidden="true" />
              </button>
            </div>
            <p v-else class="field-help">
              No additional matching delegation or shared key was observed in the returned
              contracts.
            </p>
          </template>
          <template v-else
            ><Shield :size="28" aria-hidden="true" />
            <h3>Follow the authority</h3>
            <p>
              Select owner, active, a key or a delegated account to see the exact contributors and
              observed connections.
            </p>
            <p class="field-help">
              Keys can appear in both owner and active. Sharing a key links their signers; the
              permissions still have separate authority definitions.
            </p></template
          >
          <details class="contract-details">
            <summary>Release and RAM details</summary>
            <dl>
              <dt>Code hash</dt>
              <dd>{{ selected.codeHash ?? 'Unknown' }}</dd>
              <dt>Pinned hash</dt>
              <dd>{{ selected.expectedHash ?? 'No pin' }}</dd>
              <dt>Artifact match</dt>
              <dd>{{ releaseState(selected) }}</dd>
              <dt>RAM used / quota (status snapshot)</dt>
              <dd>
                {{ selected.ramUsed ?? 'Unknown' }} /
                {{ selected.ramBytes === -1 ? 'Unlimited' : (selected.ramBytes ?? 'Unknown') }}
                bytes
              </dd>
            </dl>
          </details>
          <details class="contract-details">
            <summary>Public permission authorities</summary>
            <ul>
              <li v-for="permission in selected.permissions" :key="permission.name">
                <strong>{{ permission.name }}</strong> · parent {{ permission.parent || 'none' }} ·
                threshold {{ permission.threshold }}
                <ul>
                  <li v-for="key in permission.keys" :key="key.key">
                    Key {{ key.key }} · weight {{ key.weight }}
                  </li>
                  <li
                    v-for="account in permission.accounts"
                    :key="account.actor + '@' + account.permission"
                  >
                    {{ account.actor }}@{{ account.permission }} · weight {{ account.weight }}
                  </li>
                  <li v-for="wait in permission.waits" :key="wait.seconds">
                    Wait {{ wait.seconds }} seconds · weight {{ wait.weight }}
                  </li>
                </ul>
              </li>
            </ul>
          </details>
        </section>
      </div>
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
.explorer-context,
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
.explorer-context {
  justify-content: flex-start;
  color: var(--text-muted);
  font-size: 0.8125rem;
  margin-bottom: 14px;
}
.explorer-context span:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}
.contract-grid {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  padding: 3px 3px 12px;
  margin: -3px;
  scrollbar-width: thin;
}
.contract-card {
  flex: 1 0 clamp(260px, calc((100% - 28px) / 3), 380px);
  scroll-snap-align: start;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  overflow: hidden;
}
.contract-card[data-selected='true'] {
  border-color: var(--accent-amber);
}
.contract-card[data-related='true'] {
  border-color: var(--accent-amber);
  background: var(--surface-raised);
}
.related-authority {
  display: block;
  color: var(--accent-amber);
  font-size: 0.6875rem;
  margin-top: 8px;
}
.card-browse {
  display: flex;
  margin-left: auto;
}
.card-browse button {
  min-width: 44px;
  min-height: 44px;
  padding: 8px;
}
.card-heading {
  padding: 16px 18px 0;
}
.card-select {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0;
  color: var(--text-primary);
  background: transparent;
  border: 0;
  border-radius: 0;
  text-align: left;
  box-shadow: none;
  min-height: 48px;
}
.card-select:hover {
  color: var(--accent-amber);
  transform: none;
  box-shadow: none;
}
.card-select > svg:first-child {
  color: var(--accent-amber);
}
.card-select > svg:last-child {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--text-muted);
}
.card-select span {
  min-width: 0;
}
.card-select strong {
  display: block;
  font-size: 1rem;
  overflow-wrap: anywhere;
}
.card-select small {
  display: block;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-muted);
  margin-top: 5px;
}
.release-state {
  display: inline-flex;
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin: 12px 0 0;
  align-items: center;
  gap: 6px;
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
.card-face {
  padding: 16px 18px;
  animation: reveal-face 140ms ease;
}
.resource-row {
  display: block;
  margin-bottom: 14px;
}
.resource-label {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.75rem;
  margin-bottom: 7px;
}
.resource-label strong {
  font-weight: 600;
  color: var(--text-secondary);
}
.resource-label span {
  text-align: right;
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
.card-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 18px 0 0;
}
.back-count {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 0.875rem;
  color: var(--accent-amber);
}
.card-back dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 14px;
  font-size: 0.75rem;
}
.card-back dd {
  margin: 0;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.card-back .text-button {
  min-height: 44px;
}
.resource-status {
  align-items: flex-start;
  margin: 16px 0 24px;
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
.authority-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}
.authority-inspector {
  min-width: 0;
  background: var(--surface-panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}
.authority-inspector {
  padding: 20px;
  overflow-wrap: anywhere;
  font-size: 0.8125rem;
}
.authority-inspector > svg {
  color: var(--accent-amber);
  margin-bottom: 12px;
}
.authority-inspector h3 {
  font-size: 1rem;
  line-height: 1.5;
  margin-bottom: 12px;
}
.authority-inspector p {
  color: var(--text-muted);
  line-height: 1.6;
}
.authority-inspector .eyebrow {
  font-size: 0.6875rem;
}
.permission-facts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--surface-soft);
  border-radius: var(--radius-sm);
  margin-bottom: 16px;
}
.permission-facts strong {
  color: var(--accent-amber);
}
.contributor-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.contributor-list button,
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
.contributor-list button:hover,
.connection-list button:hover {
  color: var(--accent-amber);
  transform: none;
  box-shadow: none;
}
.contributor-list button > span,
.connection-list button > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.contributor-list button > strong {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 0.6875rem;
}
.contributor-list small,
.connection-list small {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-muted);
  margin-bottom: 5px;
}
.connection-list {
  margin-top: 22px;
}
.connection-list h4 {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}
.connection-list small {
  margin: 5px 0 0;
}
.connection-list svg {
  flex-shrink: 0;
}
.full-key {
  display: block;
  overflow-wrap: anywhere;
  padding: 12px;
  background: var(--surface-soft);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  margin-bottom: 16px;
}
.contract-details {
  border-top: 1px solid var(--line);
  margin-top: 16px;
}
.contract-details summary {
  min-height: 44px;
  padding: 14px 0;
  cursor: pointer;
  line-height: 1.5;
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
.contract-details ul {
  padding-left: 18px;
  font-size: 0.75rem;
  line-height: 1.7;
}
.contract-explorer button:focus-visible,
.authority-inspector:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 3px;
}
@keyframes reveal-face {
  from {
    opacity: 0.4;
  }
  to {
    opacity: 1;
  }
}
@media (max-width: 1250px) {
  .authority-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .authority-inspector {
    display: block;
  }
}
@media (max-width: 600px) {
  .explorer-context {
    gap: 8px 16px;
  }
  .explorer-context > span:last-child {
    flex-basis: 100%;
  }
  .contract-grid {
    display: flex;
  }
  .contract-card {
    flex: 0 0 calc(100% - 24px);
  }
  .resource-status > button {
    width: 100%;
    justify-content: center;
  }
  .authority-inspector {
    padding: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .card-face {
    animation: none;
  }
}
</style>
