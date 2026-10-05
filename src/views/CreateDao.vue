<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import type { Privacy } from '@daclify/core-protocol';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError } from '../api/client';
const state = useWorkspace();
const router = useRouter();
const title = ref('');
const description = ref('');
const privacy = ref<Privacy>('public');
const deployment = ref('shared');
const token = ref('eosio.token');
const symbol = ref('TLOS');
const precision = ref(4);
const error = ref('');
const busy = ref(false);
const available = computed(() => state.network?.capabilities.includes('shared-dao-create'));
async function create() {
  if (!state.network) return;
  busy.value = true;
  error.value = '';
  try {
    const dao = await api.createDao(
      { schemaVersion: 1, title: title.value, description: description.value },
      privacy.value,
      {
        chainId: state.network.chainId,
        contract: token.value,
        symbol: symbol.value,
        precision: precision.value,
      },
    );
    await state.refresh();
    await router.push(`/dao/${dao.reference.daoId}`);
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
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
    <RouterLink class="button" to="/account">Set up account</RouterLink>
  </div>
  <form v-else class="panel form-panel" @submit.prevent="create">
    <fieldset>
      <legend>01 · Deployment</legend>
      <div class="choice-grid">
        <label class="choice"
          ><input v-model="deployment" type="radio" value="shared" name="deployment" /><span
            ><strong>Shared contract</strong
            ><small
              >Start with a managed runtime. The deployment operator controls contract
              upgrades.</small
            ></span
          ></label
        ><label class="choice"
          ><input v-model="deployment" type="radio" value="independent" name="deployment" /><span
            ><strong>Independent contract</strong
            ><small
              >Your DAO controls its deployment and upgrade permissions. Connect it to the hub
              afterward.</small
            ></span
          ></label
        >
      </div>
    </fieldset>
    <aside v-if="deployment === 'independent'" class="notice">
      Independent deployment requires the deployment kit and an on-chain account with CPU, NET, and
      RAM. <RouterLink to="/docs/deployments">Open the deployment guide</RouterLink>.
    </aside>
    <fieldset>
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
    <fieldset>
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
    <fieldset>
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
    <div class="form-footer">
      <span v-if="!available" class="muted">Shared creation is unavailable on this deployment.</span
      ><button :disabled="busy || !available || deployment !== 'shared'">
        {{ busy ? 'Creating on chain…' : 'Create shared DAO' }}
      </button>
    </div>
  </form>
</template>
