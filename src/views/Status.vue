<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { PlatformStatus } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const workspace = useWorkspace();
const status = ref<PlatformStatus>(),
  error = ref(''),
  busy = ref(false);
let sequence = 0;
async function load() {
  const current = ++sequence;
  busy.value = true;
  error.value = '';
  status.value = undefined;
  try {
    const result = await api.platformStatus();
    if (current === sequence) status.value = result;
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  } finally {
    if (current === sequence) busy.value = false;
  }
}
onMounted(load);
watch(() => workspace.network?.chainId, load);
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">PLATFORM</p>
      <h1>Status</h1>
      <p class="lead">Current network, contracts, fees and service configuration.</p>
    </div>
    <button class="secondary" :disabled="busy" @click="load">
      {{ busy ? 'Checking…' : 'Refresh status' }}
    </button>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <template v-if="status">
    <p class="field-help">
      Checked {{ new Date(status.checkedAt).toLocaleString() }}. Configuration and live chain
      readings do not establish production qualification.
      <RouterLink to="/docs/platform">Status guide ↗</RouterLink>
    </p>
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
          <dt>Creation fees</dt>
          <dd v-if="status.chain.creation">
            Shared ${{ (status.chain.creation.shared_usd / 100).toFixed(2) }} · independent ${{
              (status.chain.creation.independent_usd / 100).toFixed(2)
            }}
            + blockchain resources
          </dd>
          <dd v-else>Unconfigured · defaults $20 / $50 + resources</dd>
          <dt>TLOS premium</dt>
          <dd>
            {{ (status.chain.creation?.premium_bps ?? status.defaults.tlosPremiumBps) / 100 }}%
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
        Chain configuration could not be read. No prices or governance settings are verified.
      </p>
      <RouterLink to="/daclify">Daclify DAO controls ↗</RouterLink>
    </section>
    <section class="panel">
      <h2>Contracts and authorities</h2>
      <p>
        Runtime and hub hashes have no release pin here. Native upgrade authority remains with the
        accounts below.
      </p>
      <article v-for="contract in status.chain?.contracts" :key="contract.account">
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
    <section class="panel">
      <h2>Services</h2>
      <article v-for="service in status.services" :key="service.id">
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
          {{ status.limits.sponsoredWritesGlobal }} per {{ status.limits.windowMs / 1000 }} seconds
        </dd>
        <dt>Hosted upload maximum</dt>
        <dd>{{ status.limits.uploadBytes }} bytes</dd>
      </dl>
    </section>
    <section class="panel">
      <h2>Database migrations</h2>
      <p>{{ status.database.state }}</p>
      <ul>
        <li
          v-for="migration in status.database.migrations"
          :key="migration.namespace + ':' + migration.name"
        >
          {{ migration.namespace }} · {{ migration.name }} ·
          {{ new Date(migration.appliedAt).toLocaleString() }}
        </li>
      </ul>
    </section>
  </template>
</template>
