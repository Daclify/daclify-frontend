<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  DaoPresets,
  DaoSetupSchema,
  FoundingAgentSchema,
  defaultDaoSetup,
  parseUnits,
  type Privacy,
} from '@daclify/core-protocol';
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
const setup = ref(defaultDaoSetup());
const maxAmount = ref('');
const dailyAmount = ref('');
const agentSigningKey = ref('');
const agentEncryptionKey = ref('');
const agentOperator = ref('');
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
    state.network?.capabilities.includes('shared-dao-create') &&
    state.network.capabilities.includes('dao-presets'),
);
async function create() {
  if (!state.network) return;
  busy.value = true;
  error.value = '';
  try {
    if (!resolved.value) throw new Error('INPUT_INVALID');
    const dao = await api.createDao(
      { schemaVersion: 1, title: title.value, description: description.value },
      privacy.value,
      {
        chainId: state.network.chainId,
        contract: token.value,
        symbol: symbol.value,
        precision: precision.value,
      },
      resolved.value,
      setup.value.participantMode === 'agents-guarded'
        ? (foundingAgent.value ?? undefined)
        : undefined,
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
    <fieldset>
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
      <label for="quorum">Quorum (basis points)</label
      ><input
        id="quorum"
        v-model.number="setup.governance.quorumBasisPoints"
        type="number"
        min="1"
        max="10000"
        required
      />
      <label for="approval">Approval (basis points)</label
      ><input
        id="approval"
        v-model.number="setup.governance.approvalBasisPoints"
        type="number"
        min="5001"
        max="10000"
        required
      />
      <p class="field-help">
        5000 means 50%. Every ballot must use the saved weight, duration and thresholds.
      </p>
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
        agents and recover their signing identity. Recovery can impersonate that agent. It does not
        automatically grant votes or document keys.
      </p>
      <p class="field-help">
        Daily limits apply when funds are committed, rather than when an existing obligation is
        paid. Cancelling does not replenish that day's allowance.
      </p>
    </fieldset>
    <aside class="notice">
      Preset v{{ setup.presetVersion }} configures this DAO once. Administrators control admission,
      roles, credit issuance and later policy changes; active ballots block policy changes. A policy
      revision invalidates pending funding execution. The shared operator retains native owner and
      contract upgrade powers. <RouterLink to="/docs/dao-presets">Read the setup guide</RouterLink>.
    </aside>
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
      ><button :disabled="busy || !available || !ready || deployment !== 'shared'">
        {{ busy ? 'Creating on chain…' : 'Create shared DAO' }}
      </button>
    </div>
  </form>
</template>
