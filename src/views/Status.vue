<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { PlatformStatus } from '@daclify/core-protocol';
import { ArrowRight, Bot, Database, Globe, RefreshCw, Server, TrendingUp } from '@lucide/vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const workspace = useWorkspace();
const status = ref<PlatformStatus>();
const assistant = ref<Awaited<ReturnType<typeof api.docsAgent>>>();
const error = ref(''),
  agentError = ref(''),
  platformBusy = ref(false),
  agentBusy = ref(false);
const busy = computed(() => platformBusy.value || agentBusy.value);
const readableChain = computed(
  () => status.value?.rpc === 'reachable' && status.value.chain?.chainMatches === true,
);
const configuredServices = computed(
  () => status.value?.services.filter((service) => service.configured).length ?? 0,
);
const checks = computed(() => {
  const value = status.value;
  if (!value) return [];
  return [
    {
      label: 'Chain RPC',
      icon: Globe,
      value:
        value.rpc === 'unconfigured'
          ? 'Not configured'
          : value.rpc !== 'reachable'
            ? 'Unavailable'
            : value.chain?.chainMatches === false
              ? 'Wrong chain'
              : readableChain.value
                ? 'Reachable'
                : 'Not verified',
      detail: readableChain.value
        ? 'Connected to the configured chain.'
        : value.chain?.chainMatches === false
          ? 'RPC returned a different chain.'
          : 'Could not verify the configured chain.',
      tone: readableChain.value ? 'success' : 'danger',
    },
    {
      label: 'Database',
      icon: Database,
      value: value.database.state === 'reachable' ? 'Reachable' : 'Unavailable',
      detail:
        value.database.state === 'reachable'
          ? 'The API can read its database.'
          : 'Database reads failed.',
      tone: value.database.state === 'reachable' ? 'success' : 'danger',
    },
    {
      label: 'Shared setup',
      icon: Server,
      value: readableChain.value && value.chain?.sharedAvailable ? 'Configured' : 'Unavailable',
      detail: 'Free creation; member capacity billed separately.',
      tone: 'neutral',
    },
    {
      label: 'TLOS quotes',
      icon: TrendingUp,
      value: !readableChain.value
        ? 'Not verified'
        : value.chain?.rateFresh
          ? 'Current'
          : value.chain?.creation?.observed_at
            ? 'Stale'
            : 'Unavailable',
      detail: 'Conversion rates must be at most 15 minutes old.',
      tone: readableChain.value && value.chain?.rateFresh ? 'success' : 'neutral',
    },
  ];
});
const allowanceLabels = {
  unconfigured: 'Not configured',
  unavailable: 'Unavailable',
  scheduled: 'Scheduled',
  available: 'Available',
  exhausted: 'Exhausted',
  expired: 'Expired',
};
const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'network', label: 'Network' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'fees', label: 'Fees' },
  { id: 'services', label: 'Services' },
  { id: 'ai', label: 'AI Daxi Help' },
] as const;
const tab = ref<(typeof tabs)[number]['id']>('overview');
function navigateTabs(event: KeyboardEvent) {
  const current = tabs.findIndex((item) => item.id === tab.value);
  const index =
    event.key === 'ArrowRight'
      ? (current + 1) % tabs.length
      : event.key === 'ArrowLeft'
        ? (current + tabs.length - 1) % tabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : undefined;
  if (index === undefined) return;
  const item = tabs[index];
  if (!item) return;
  event.preventDefault();
  tab.value = item.id;
  void nextTick(() => document.getElementById('status-tab-' + item.id)?.focus());
}
function openHelp() {
  document.getElementById('help-launcher')?.click();
}
function showTab(id: (typeof tabs)[number]['id']) {
  tab.value = id;
  void nextTick(() => document.getElementById('status-tab-' + id)?.focus());
}
let sequence = 0;
async function load(reset = false) {
  if (busy.value && !reset) return;
  const current = ++sequence;
  platformBusy.value = true;
  agentBusy.value = true;
  error.value = '';
  agentError.value = '';
  if (reset) {
    status.value = undefined;
    assistant.value = undefined;
  }
  await Promise.all([
    api
      .platformStatus()
      .then(
        (value) => {
          if (current === sequence) status.value = value;
        },
        (cause) => {
          if (current === sequence) error.value = friendlyError(cause);
        },
      )
      .finally(() => {
        if (current === sequence) platformBusy.value = false;
      }),
    api
      .docsAgent()
      .then(
        (value) => {
          if (current === sequence) assistant.value = value;
        },
        (cause) => {
          if (current === sequence) agentError.value = friendlyError(cause);
        },
      )
      .finally(() => {
        if (current === sequence) agentBusy.value = false;
      }),
  ]);
}
onMounted(() => load());
watch(
  () =>
    workspace.network &&
    [
      workspace.network.chainId,
      workspace.network.runtime,
      workspace.network.rpcUrl,
      workspace.network.environment,
    ].join('/'),
  (_network, previous) => {
    if (previous !== undefined) void load(true);
  },
);
onUnmounted(() => {
  sequence++;
});
</script>

<template>
  <div class="page-heading status-heading">
    <div>
      <p class="eyebrow">PLATFORM</p>
      <h1>Status</h1>
      <p class="lead">Network checks, service configuration and Daxi support.</p>
    </div>
    <button type="button" class="secondary" :aria-disabled="busy" @click="load()">
      <RefreshCw aria-hidden="true" :size="18" />
      {{ busy ? 'Checking…' : error && !status ? 'Try again' : 'Refresh status' }}
    </button>
  </div>
  <div v-if="error" class="alert" role="alert">
    <strong>{{
      status ? 'Refresh failed. Showing the previous readings.' : 'Could not check platform status.'
    }}</strong>
    <p>{{ error }} Use {{ status ? 'Refresh status' : 'Try again' }} to check again.</p>
  </div>
  <section v-else-if="platformBusy && !status" class="panel status-loading" role="status">
    <h2>Checking platform status…</h2>
    <p>Reading the network and service configuration.</p>
  </section>
  <div v-if="status" class="status-page">
    <div class="status-meta">
      <p :class="{ 'previous-readings': error }">
        {{ error ? 'Previous readings' : platformBusy ? 'Last checked' : 'Checked' }}
        <time :datetime="status.checkedAt">{{ new Date(status.checkedAt).toLocaleString() }}</time>
        <span v-if="platformBusy" role="status"> · Refreshing readings…</span>
      </p>
      <RouterLink to="/docs/platform"
        >Status guide <ArrowRight :size="16" aria-hidden="true"
      /></RouterLink>
    </div>
    <section class="status-checks" aria-label="Latest checks" :aria-busy="platformBusy">
      <article v-for="check in checks" :key="check.label" class="check-card">
        <h2><component :is="check.icon" :size="18" aria-hidden="true" />{{ check.label }}</h2>
        <p class="check-value" :data-tone="check.tone">{{ check.value }}</p>
        <p class="check-detail">{{ check.detail }}</p>
      </article>
    </section>
    <p v-if="status.chain?.chainMatches === false" class="alert" role="alert">
      Chain mismatch. These readings come from a different chain than the configured deployment.
    </p>
    <div
      class="account-tabs status-tabs"
      role="tablist"
      aria-label="Status sections"
      @keydown="navigateTabs"
    >
      <button
        v-for="item in tabs"
        :id="'status-tab-' + item.id"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="tab === item.id"
        :aria-controls="'status-panel-' + item.id"
        :tabindex="tab === item.id ? 0 : -1"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </div>

    <div
      v-show="tab === 'overview'"
      id="status-panel-overview"
      role="tabpanel"
      aria-labelledby="status-tab-overview"
      tabindex="0"
      class="status-overview"
    >
      <section class="panel">
        <h2>What you can use here</h2>
        <p>
          {{
            readableChain
              ? 'The configured chain is reachable for DAO reads.'
              : 'DAO reads could not be verified. Review Network for connection details.'
          }}
        </p>
        <div class="service-count">
          <strong
            >{{ configuredServices }} <span>/ {{ status.services.length }}</span></strong
          ><span>services configured</span>
        </div>
        <p class="field-help">
          Configuration does not prove live provider availability. Review each service before
          relying on it.
        </p>
        <div class="button-row">
          <RouterLink class="button secondary" to="/hub"
            >Browse DAOs <ArrowRight aria-hidden="true"
          /></RouterLink>
          <button type="button" class="text-button" @click="showTab('services')">
            Review services <ArrowRight aria-hidden="true" />
          </button>
        </div>
        <details class="status-disclosure">
          <summary>Deployment limitations</summary>
          <p>
            Independent self-service setup is unavailable. Managed custody and cross-chain
            settlement still require qualification.
          </p>
        </details>
      </section>
      <section v-if="status.gatewayAllowance" class="panel">
        <h2>Shared gateway allowance</h2>
        <span class="pill" :class="{ success: status.gatewayAllowance.state === 'available' }">{{
          allowanceLabels[status.gatewayAllowance.state]
        }}</span>
        <p class="gateway-description">
          Shared across this operator’s DAOs and background verification jobs.
        </p>
        <template v-if="status.gatewayAllowance.fundingQualification === 'operator-attested'">
          <p>
            {{ status.gatewayAllowance.reservedBytes }} /
            {{ status.gatewayAllowance.byteLimit }} bytes reserved;
            {{ status.gatewayAllowance.requests }} /
            {{ status.gatewayAllowance.requestLimit }} requests.
          </p>
          <p>
            Period: {{ new Date(status.gatewayAllowance.startsAt ?? '').toLocaleString() }} to
            {{ new Date(status.gatewayAllowance.endsAt ?? '').toLocaleString() }}.
          </p>
        </template>
        <details class="status-disclosure">
          <summary>How this allowance works</summary>
          <p class="field-help">
            Reads stop when the allowance expires or is exhausted. Failed reads retain their
            reservation. Files stay pinned, and this adds no DAO bandwidth invoice. Funding is
            attested by the operator; provider payment and access controls require separate
            verification.
          </p>
        </details>
      </section>
    </div>
    <div
      v-show="tab === 'network'"
      id="status-panel-network"
      role="tabpanel"
      aria-labelledby="status-tab-network"
      tabindex="0"
    >
      <section class="panel">
        <h2>Network and versions</h2>
        <dl class="fact-list">
          <dt>API / core</dt>
          <dd>{{ status.apiVersion }}</dd>
          <dt>Modules</dt>
          <dd>{{ status.moduleVersion }}</dd>
          <dt>Database</dt>
          <dd>{{ status.database.state }}</dd>
          <dt>RPC</dt>
          <dd>{{ status.rpc }}</dd>
          <template v-if="status.chain"
            ><dt>Environment</dt>
            <dd>{{ status.chain.network.environment }}</dd>
            <dt>RPC endpoint</dt>
            <dd class="break-word">{{ status.chain.network.rpcUrl }}</dd>
            <dt>Expected chain ID</dt>
            <dd class="break-word">{{ status.chain.network.chainId }}</dd>
            <dt>Actual chain ID</dt>
            <dd class="break-word">
              {{ status.chain.chainId }} ·
              {{ status.chain.chainMatches ? 'matches' : 'MISMATCH' }}
            </dd>
            <dt>Head / irreversible block</dt>
            <dd>{{ status.chain.headBlock }} / {{ status.chain.irreversibleBlock }}</dd>
            <dt>Head time (UTC)</dt>
            <dd>{{ status.chain.headTime }}</dd>
            <dt>Interface</dt>
            <dd>{{ status.chain.network.interfaceVersion }}</dd>
            <dt>Capabilities</dt>
            <dd>{{ status.chain.network.capabilities.join(', ') }}</dd>
            <dt>Shared creation</dt>
            <dd>
              {{
                readableChain && status.chain.sharedAvailable
                  ? 'Configured'
                  : 'Unavailable / unverified'
              }}
            </dd>
            <dt>Independent checkout</dt>
            <dd>Unavailable · operator deployment kit</dd></template
          >
        </dl>
      </section>
    </div>
    <div
      v-show="tab === 'contracts'"
      id="status-panel-contracts"
      role="tabpanel"
      aria-labelledby="status-tab-contracts"
      tabindex="0"
    >
      <section class="panel">
        <h2>Contracts and authorities</h2>
        <p>
          Compare deployed code with its release pin and inspect public permissions. Native upgrade
          authority remains with each account.
        </p>
        <article
          class="status-contract"
          v-for="contract in status.chain?.contracts"
          :key="contract.account"
        >
          <div class="contract-heading">
            <h3>
              {{ contract.account
              }}<span v-if="contract.moduleId" class="contract-module">{{
                contract.moduleId
              }}</span>
            </h3>
            <span
              class="pill"
              :class="{
                success: contract.codeHash && contract.expectedHash && contract.verified,
              }"
              >{{
                !contract.codeHash
                  ? 'Not read'
                  : contract.expectedHash
                    ? contract.verified
                      ? 'Verified'
                      : 'Hash mismatch'
                    : 'No release pin'
              }}</span
            >
          </div>
          <dl class="fact-list">
            <dt>Code hash</dt>
            <dd class="break-word">{{ contract.codeHash ?? 'Unknown' }}</dd>
            <dt>Pinned hash</dt>
            <dd class="break-word">{{ contract.expectedHash ?? 'No pin' }}</dd>
            <dt>Artifact match</dt>
            <dd>
              {{
                !contract.codeHash
                  ? 'Not read'
                  : contract.expectedHash
                    ? contract.verified
                      ? 'Verified'
                      : 'MISMATCH'
                    : 'Unverified'
              }}
            </dd>
            <dt>RAM used / quota</dt>
            <dd>
              {{ contract.ramUsed ?? 'Unknown' }} /
              {{ contract.ramBytes === -1 ? 'Unlimited' : (contract.ramBytes ?? 'Unknown') }}
              bytes
            </dd>
          </dl>
          <details class="status-disclosure">
            <summary>Public permission authorities</summary>
            <ul>
              <li v-for="permission in contract.permissions" :key="permission.name">
                <strong>{{ permission.name }}</strong> · parent {{ permission.parent || 'none' }} ·
                threshold {{ permission.threshold }}
                <ul>
                  <li v-for="key in permission.keys" :key="key.key" class="break-word">
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
        </article>
        <p v-if="!status.chain?.contracts.length">
          Contract readings unavailable. Refresh to check again; no contract verification is
          implied.
        </p>
      </section>
    </div>
    <div
      v-show="tab === 'fees'"
      id="status-panel-fees"
      role="tabpanel"
      aria-labelledby="status-tab-fees"
      tabindex="0"
    >
      <section class="panel">
        <h2>Fees and governance</h2>
        <template v-if="status.chain"
          ><dl class="fact-list">
            <dt>Daclify DAO</dt>
            <dd>
              <RouterLink
                v-if="status.chain.platformDao"
                :to="'/dao/' + status.chain.platformDao.daoId"
                >DAO {{ status.chain.platformDao.daoId }}</RouterLink
              ><span v-else>Not linked</span>
            </dd>
            <dt>Shared creation</dt>
            <dd>Free creation · shared member capacity is billed separately</dd>
            <dt>Independent deployment</dt>
            <dd>Contact for pricing</dd>
            <dt>Included member slots</dt>
            <dd>{{ status.chain.hosting?.free_members ?? 'Not reported' }}</dd>
            <dt>Connect commission</dt>
            <dd>
              {{
                status.chain.paymentPolicy
                  ? status.chain.paymentPolicy.bps / 100 + '%'
                  : 'Not configured'
              }}
            </dd>
            <dt>Legacy creation configuration</dt>
            <dd>
              {{
                status.chain.creation
                  ? 'Shared ' +
                    status.chain.creation.shared_usd +
                    ' / independent ' +
                    status.chain.creation.independent_usd +
                    ' USD cents; operator configuration, not a current checkout quote.'
                  : 'Not configured'
              }}
            </dd>
            <dt>TLOS premium</dt>
            <dd>
              {{ (status.chain.creation?.premium_bps ?? status.defaults.tlosPremiumBps) / 100 }}%
            </dd>
            <dt>Operator RAM reserve</dt>
            <dd>
              {{ status.chain.ramReserve?.available ?? 'Unfunded / unavailable' }} · separate from
              DAO treasury, stakes and claims.
            </dd>
            <dt>Creation settler</dt>
            <dd>{{ status.chain.creation?.settler ?? 'Unconfigured' }}</dd>
            <dt>Fresh TLOS rate</dt>
            <dd>
              {{
                readableChain && status.chain.rateFresh
                  ? 'Yes · up to 15 minutes old'
                  : 'Unavailable / stale'
              }}
            </dd>
            <dt>Rate observation</dt>
            <dd>
              {{
                status.chain.creation?.observed_at
                  ? new Date(status.chain.creation.observed_at * 1000).toLocaleString()
                  : 'No rate'
              }}
            </dd>
            <dt>USD/TLOS median / precision</dt>
            <dd>
              {{ status.chain.creation?.median ?? '—' }} /
              {{ status.chain.creation?.precision ?? '—' }}
            </dd>
            <dt>Fee treasury</dt>
            <dd>{{ status.chain.fees?.treasury ?? 'Unconfigured' }}</dd>
            <dt>Payment token</dt>
            <dd>
              {{ status.chain.fees?.token_contract ?? '—' }} ·
              {{ status.chain.fees?.token_symbol ?? '—' }}
            </dd>
            <dt>Third-party / Daclify module cuts</dt>
            <dd>
              {{ (status.chain.fees?.third_party_bps ?? 0) / 100 }}% /
              {{ (status.chain.fees?.first_party_bps ?? 0) / 100 }}%
            </dd>
            <dt>Names contract</dt>
            <dd>{{ status.chain.fees?.names || 'Unconfigured' }}</dd>
            <dt>Name resale increase / conversion premium</dt>
            <dd>
              {{
                status.chain.market
                  ? status.chain.market.bump_bps / 100 +
                    '% / ' +
                    status.chain.market.quote_premium_bps / 100 +
                    '%'
                  : 'Unconfigured'
              }}
            </dd>
          </dl></template
        >
        <p v-else>
          Chain configuration could not be read. Current fees and governance settings are
          unavailable; independent deployments require contact for pricing.
        </p>
        <RouterLink to="/daclify">Daclify DAO controls ↗</RouterLink>
      </section>
    </div>
    <div
      v-show="tab === 'services'"
      id="status-panel-services"
      role="tabpanel"
      aria-labelledby="status-tab-services"
      tabindex="0"
    >
      <section class="panel">
        <h2>Services</h2>
        <p>
          {{ configuredServices }} of {{ status.services.length }} services configured, including
          Daxi. Configuration is separate from a successful live check.
        </p>
        <div class="status-service-grid">
          <article
            class="status-service"
            v-for="service in status.services.filter(
              (item) => !['docs', 'telegram-docs'].includes(item.id),
            )"
            :key="service.id"
          >
            <span class="pill">{{ service.configured ? 'Configured' : 'Not configured' }}</span>
            <h3>{{ service.name }}</h3>
            <p>{{ service.detail }}</p>
            <p class="field-help">
              {{
                service.qualification === 'local-fixture'
                  ? 'Local fixture only · live availability unverified'
                  : 'Live availability unverified'
              }}
            </p>
          </article>
        </div>
        <p
          v-if="!status.services.some((service) => !['docs', 'telegram-docs'].includes(service.id))"
          class="field-help"
        >
          No other integrations reported by this server.
        </p>
        <button type="button" class="text-button" @click="showTab('ai')">
          Daxi configuration <ArrowRight aria-hidden="true" />
        </button>
      </section>
      <section class="panel">
        <h2>Service limits</h2>
        <dl class="fact-list">
          <dt>Sponsored writes per account / global</dt>
          <dd>
            {{ status.limits.sponsoredWritesPerAccount }} /
            {{ status.limits.sponsoredWritesGlobal }} per
            {{ status.limits.windowMs / 1000 }} seconds
          </dd>
          <dt>Hosted upload maximum</dt>
          <dd>{{ status.limits.uploadBytes }} bytes</dd>
        </dl>
      </section>
    </div>
    <div
      v-show="tab === 'ai'"
      id="status-panel-ai"
      role="tabpanel"
      aria-labelledby="status-tab-ai"
      tabindex="0"
    >
      <section class="panel">
        <div class="panel-heading">
          <h2><Bot aria-hidden="true" :size="24" /> AI Daxi Help</h2>
          <span v-if="assistant" class="pill">{{
            assistant.configured ? 'Configured' : 'Not configured'
          }}</span>
        </div>
        <p>
          Meet Daxi, your guide to Daclify, Telos and DAOs. Clear answers, practical next steps and
          the occasional joke about governance paperwork.
        </p>
        <p v-if="agentError" class="alert" role="alert">
          Could not refresh Daxi settings.
          {{ assistant ? 'Showing previously read settings.' : 'Configuration is unknown.' }}
          {{ agentError }} Use Refresh status to try again.
        </p>
        <p v-else-if="agentBusy" role="status">
          Checking Daxi settings{{ assistant ? ' · previous settings remain below' : '' }}…
        </p>
        <dl v-if="assistant" class="fact-list">
          <dt>Scope</dt>
          <dd>{{ assistant.profile?.scope.join(', ') ?? 'Not reported by this server' }}</dd>
          <dt>Answer model</dt>
          <dd class="break-word">
            {{ assistant.profile?.answerModel ?? 'Not reported / not configured' }}
          </dd>
          <dt>Decision model</dt>
          <dd class="break-word">
            {{ assistant.profile?.decisionsModel ?? 'Not reported / not configured' }}
          </dd>
          <dt>Knowledge version</dt>
          <dd>{{ assistant.profile?.knowledgeVersion ?? 'Not reported by this server' }}</dd>
        </dl>
        <p class="field-help">
          Daxi uses reviewed guides and adds a source link to supported answers. It does not read
          your vault or live DAO records. Provider configuration needs a successful answer check; it
          does not prove availability or answer quality.
        </p>
        <div class="button-row">
          <button type="button" @click="openHelp">Open Daxi Help</button
          ><RouterLink class="button secondary" to="/docs/docs-assistant"
            >Setup & scope guide</RouterLink
          >
        </div>
      </section>
      <section class="panel">
        <h2>Daxi on Telegram</h2>
        <article
          v-for="service in status.services.filter((item) => item.id === 'telegram-docs')"
          :key="service.id"
        >
          <span class="pill">{{ service.configured ? 'Configured' : 'Not configured' }}</span>
          <p>{{ service.detail }}</p>
        </article>
        <p v-if="!status.services.some((service) => service.id === 'telegram-docs')">
          Telegram support configuration was not reported by this server.
        </p>
        <p>
          Groups use /docs commands and replies; direct chat requires the approved-user whitelist.
          Telegram sign-in and bot chat are configured separately.
        </p>
        <p class="field-help">
          The public page does not expose bot credentials or allowlist IDs. Webhook registration is
          checked separately by the operator.
        </p>
      </section>
    </div>
  </div>
</template>
<style scoped>
.status-page {
  container-type: inline-size;
}
.status-heading {
  margin-bottom: 20px;
}
.status-heading > button {
  flex-shrink: 0;
}
.status-heading > button[aria-disabled='true'] {
  cursor: progress;
  opacity: 0.65;
  box-shadow: none;
  transform: none;
}
.status-meta,
.contract-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.status-meta {
  margin-bottom: 20px;
  font-size: 0.8125rem;
  color: var(--text-muted);
}
.status-meta p {
  margin: 0;
}
.status-meta a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
}
.previous-readings {
  color: var(--accent-amber);
}
.status-checks {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.check-card {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-panel);
}
.check-card h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.check-card svg {
  flex: none;
  color: var(--text-muted);
}
.check-value {
  font-size: 1.25rem;
  font-weight: 650;
  line-height: 1.4;
  letter-spacing: -0.3px;
  margin-bottom: 8px;
  overflow-wrap: anywhere;
}
.check-value[data-tone='success'] {
  color: var(--state-success);
}
.check-value[data-tone='danger'] {
  color: var(--state-danger);
}
.check-detail {
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-muted);
  margin: 0;
}
.status-tabs {
  margin: 24px 0;
  gap: 8px;
}
.status-tabs button {
  min-height: 44px;
  font-size: 0.875rem;
}
.status-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.status-overview .panel {
  margin-bottom: 0;
}
.status-overview > .panel:only-child {
  grid-column: 1 / -1;
}
.service-count {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 8px;
}
.service-count strong {
  color: var(--text-primary);
  font-size: 2rem;
  letter-spacing: -1px;
}
.service-count strong span {
  color: var(--text-muted);
  font-size: 1.125rem;
  letter-spacing: 0;
}
.gateway-description {
  margin-top: 16px;
}
.status-disclosure {
  margin-top: 16px;
  border-top: 1px solid var(--line);
}
.status-disclosure summary {
  min-height: 44px;
  padding: 12px 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-secondary);
  cursor: pointer;
}
.status-disclosure p:last-child {
  margin-bottom: 0;
}
.status-disclosure ul {
  padding-left: 20px;
  font-size: 0.875rem;
  line-height: 1.7;
}
.status-contract {
  padding: 22px 0;
  border-bottom: 1px solid var(--line);
}
.status-contract:last-child {
  border-bottom: 0;
}
.contract-heading h3 {
  margin: 0;
  overflow-wrap: anywhere;
}
.contract-module {
  margin-left: 12px;
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 450;
}
.status-service-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 20px 0;
}
.status-service {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  overflow-wrap: anywhere;
}
.status-service h3 {
  font-size: 1rem;
  line-height: 1.5;
  margin: 12px 0 8px;
}
.status-service p:last-child {
  margin-bottom: 0;
}
.panel-heading h2 {
  display: flex;
  align-items: center;
  gap: 12px;
}
[role='tabpanel'] {
  min-width: 0;
  font-size: 0.875rem;
}
[role='tabpanel'] .panel h2 {
  font-size: 1.25rem;
}
[role='tabpanel'] .panel p {
  font-size: 0.875rem;
}
[role='tabpanel']:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 4px;
  border-radius: var(--radius-lg);
}
@media (max-width: 1100px) {
  .status-checks {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .status-overview {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  .status-meta {
    gap: 0;
  }
  .status-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .status-tabs button {
    padding: 8px;
    border-radius: var(--radius-sm);
  }
  .status-service-grid {
    grid-template-columns: 1fr;
  }
  .check-card {
    padding: 16px;
  }
  .check-value {
    font-size: 1.0625rem;
  }
  [role='tabpanel'] .panel {
    padding: 20px;
  }
}
@media (min-width: 601px) {
  .fact-list {
    grid-template-columns: minmax(10rem, 1fr) minmax(0, 2fr);
    gap: 12px 24px;
  }
}
@container (max-width: 40rem) {
  .status-overview,
  .status-service-grid {
    grid-template-columns: 1fr;
  }
  .status-checks {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .fact-list {
    grid-template-columns: 1fr;
  }
}
</style>
