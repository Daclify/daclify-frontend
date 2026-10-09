<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { PlatformStatus } from '@daclify/core-protocol';
import { Bot } from '@lucide/vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const workspace = useWorkspace();
const status = ref<PlatformStatus>();
const assistant = ref<Awaited<ReturnType<typeof api.docsAgent>>>();
const error = ref(''),
  agentError = ref(''),
  busy = ref(false);
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
let sequence = 0;
async function load() {
  const current = ++sequence;
  busy.value = true;
  error.value = '';
  agentError.value = '';
  status.value = undefined;
  assistant.value = undefined;
  const [platform, agent] = await Promise.allSettled([api.platformStatus(), api.docsAgent()]);
  if (current !== sequence) return;
  if (platform.status === 'fulfilled') status.value = platform.value;
  else error.value = friendlyError(platform.reason);
  if (agent.status === 'fulfilled') assistant.value = agent.value;
  else agentError.value = friendlyError(agent.reason);
  busy.value = false;
}
onMounted(load);
watch(() => workspace.network?.chainId, load);
onUnmounted(() => {
  sequence++;
});
</script>

<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">PLATFORM</p>
      <h1>Status</h1>
      <p class="lead">A clear view of your network, services and Daxi support.</p>
    </div>
    <button class="secondary" :disabled="busy" @click="load">
      {{ busy ? 'Checking…' : 'Refresh status' }}
    </button>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-else-if="busy && !status" role="status">Checking platform status…</p>
  <template v-if="status">
    <p class="field-help">
      Checked {{ new Date(status.checkedAt).toLocaleString() }}. Configuration is shown separately
      from live qualification. <RouterLink to="/docs/platform">Status guide ↗</RouterLink>
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
    >
      <section class="panel">
        <h2>What you can use here</h2>
        <p>
          DAO reads:
          {{
            status.rpc === 'reachable' && status.chain?.chainMatches
              ? 'network reachable'
              : 'unavailable or wrong chain'
          }}. Shared setup: {{ status.chain?.sharedAvailable ? 'configured' : 'unavailable' }}. TLOS
          quotes: {{ status.chain?.rateFresh ? 'current' : 'unavailable or stale' }}.
        </p>
        <p>
          Independent self-service setup is unavailable. Managed custody and cross-chain settlement
          still require qualification.
        </p>
        <p>
          {{ status.services.filter((service) => service.configured).length }} of
          {{ status.services.length }} services configured. Use Services for integrations and AI
          Daxi Help for support settings.
        </p>
      </section>
      <section v-if="status.gatewayAllowance" class="panel">
        <h2>Shared gateway allowance</h2>
        <p>
          State: {{ status.gatewayAllowance.state }}. This allowance covers this operator’s shared
          gateway, across its DAOs and background verification jobs.
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
        <p class="field-help">
          Reads stop when the allowance expires or is exhausted. Failed reads retain their
          reservation. Files stay pinned, and this adds no DAO bandwidth invoice. Funding is
          attested by the operator; provider payment and access controls require separate
          verification.
        </p>
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
              {{ status.chain.chainId }} · {{ status.chain.chainMatches ? 'matches' : 'MISMATCH' }}
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
            <dd>{{ status.chain.sharedAvailable ? 'Configured' : 'Unavailable' }}</dd>
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
          Runtime and hub hashes have no release pin here. Native upgrade authority remains with the
          accounts below.
        </p>
        <article
          class="status-contract"
          v-for="contract in status.chain?.contracts"
          :key="contract.account"
        >
          <h3>{{ contract.account }}{{ contract.moduleId ? ' · ' + contract.moduleId : '' }}</h3>
          <dl class="fact-list">
            <dt>Code hash</dt>
            <dd class="break-word">{{ contract.codeHash ?? 'Unknown' }}</dd>
            <dt>Pinned hash</dt>
            <dd class="break-word">{{ contract.expectedHash ?? 'No pin' }}</dd>
            <dt>Artifact match</dt>
            <dd>
              {{
                contract.expectedHash ? (contract.verified ? 'Verified' : 'MISMATCH') : 'Unverified'
              }}
            </dd>
            <dt>RAM used / quota</dt>
            <dd>
              {{ contract.ramUsed ?? 'Unknown' }} /
              {{ contract.ramBytes === -1 ? 'Unlimited' : (contract.ramBytes ?? 'Unknown') }} bytes
            </dd>
          </dl>
          <details>
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
        <p v-if="!status.chain">Contract readings unavailable.</p>
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
              {{ status.chain.rateFresh ? 'Yes · up to 15 minutes old' : 'Unavailable / stale' }}
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
        <article
          class="status-service"
          v-for="service in status.services.filter(
            (item) => !['docs', 'telegram-docs'].includes(item.id),
          )"
          :key="service.id"
        >
          <h3>
            {{ service.name }}
            <span class="pill">{{ service.configured ? 'Configured' : 'Unconfigured' }}</span>
          </h3>
          <p>{{ service.detail }}</p>
          <p class="field-help">Qualification: {{ service.qualification }}</p>
        </article>
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
        <p v-if="agentError" class="alert" role="alert">{{ agentError }}</p>
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
  </template>
</template>
<style scoped>
.status-tabs {
  margin: 24px 0;
}
.status-contract,
.status-service {
  padding: 22px 0;
  border-bottom: 1px solid var(--line);
}
.status-contract:last-child,
.status-service:last-child {
  border-bottom: 0;
}
.panel-heading h2 {
  display: flex;
  align-items: center;
  gap: 12px;
}
[role='tabpanel'] {
  min-width: 0;
}
[role='tabpanel']:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 4px;
  border-radius: var(--radius-lg);
}
</style>
