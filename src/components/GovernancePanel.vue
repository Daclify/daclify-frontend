<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Checksum256 } from '@wharfkit/antelope';
import {
  DaoSetupSchema,
  SigningPublicKeySchema,
  formatUnits,
  parseUnits,
  type GovernanceState,
  type GovernanceConfig,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import {
  encodeAction,
  governanceSettings,
  makeInstruction,
  RuntimeActionSchemas,
} from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { relayInstruction, vaultUnlocked } from '../auth/session';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>();
const workspace = useWorkspace();
const state = ref<GovernanceState>();
const draft = ref<GovernanceConfig>();
const maximum = ref('0'),
  daily = ref('0');
const error = ref(''),
  success = ref(''),
  busy = ref(false);
const sessionId = ref('1'),
  sessionKey = ref(''),
  sessionHours = ref(24);
const guardAction = ref<'pause' | 'revoke' | 'recover'>('pause');
const guardMember = ref('1'),
  guardKey = ref(''),
  pauseMinutes = ref(60),
  reason = ref('');
const policy = computed(() => state.value?.policy);
const agents = computed(() => state.value?.actors.filter((actor) => actor.kind === 1) ?? []);
const canSign = computed(() => props.member?.active && vaultUnlocked.value && !busy.value);
function amount(units: string) {
  return formatUnits(BigInt(units), props.dao.token.precision);
}
async function load() {
  if (!workspace.network?.capabilities.includes('governance-policy')) return;
  try {
    state.value = await api.governance(props.dao.reference.daoId);
    const config = state.value.policy?.config;
    if (config) {
      draft.value = {
        weight: config.kind === 0 ? 'member' : config.kind === 1 ? 'credit' : 'native-stake',
        duration: config.duration,
        quorumBasisPoints: config.quorum,
        approvalBasisPoints: config.approval,
        governedWorks: config.governed_works,
        maxCommitment: config.max_commitment,
        dailyCommitment: config.daily_commitment,
        guardian: config.guardian,
      };
      maximum.value = amount(config.max_commitment);
      daily.value = amount(config.daily_commitment);
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
watch(
  () => props.dao.reference,
  () => {
    void load();
  },
  { immediate: true },
);
function actor() {
  if (!props.member) throw new Error('AUTH_REQUIRED');
  return {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: props.member.memberId,
  };
}
async function run(action: string, data: Uint8Array, message: string) {
  if (!props.member) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        props.dao.reference,
        props.member.memberId,
        props.member.nonce,
        Math.floor(Date.now() / 1000) + 300,
        props.dao.reference.contract,
        action,
        data,
      ),
    );
    await workspace.refresh();
    await load();
    success.value = message;
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function updatePolicy() {
  if (!draft.value || !policy.value) return;
  try {
    const setup = DaoSetupSchema.parse({
      presetId: props.dao.purpose ?? 'custom',
      presetVersion: 1,
      participantMode: ['humans', 'mixed', 'agents-guarded'][policy.value.config.participant_mode],
      governance: {
        ...draft.value,
        maxCommitment: parseUnits(maximum.value, props.dao.token.precision).toString(),
        dailyCommitment: parseUnits(daily.value, props.dao.token.precision).toString(),
      },
    });
    await run(
      'setdaogov',
      encodeAction('setdaogov', {
        ...actor(),
        settings: governanceSettings(setup, policy.value.config.decide),
      }),
      'Policy updated. Pending funding execution under the previous revision is invalid.',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function delegate() {
  try {
    await run(
      'addsession',
      encodeAction(
        'addsession',
        RuntimeActionSchemas.addsession.parse({
          ...actor(),
          session_id: sessionId.value,
          signing_key: SigningPublicKeySchema.parse(sessionKey.value),
          expires: Math.floor(Date.now() / 1000) + sessionHours.value * 3600,
          permissions: [
            { target: props.dao.reference.contract, action: 'putjson', code_hash: '00'.repeat(32) },
          ],
        }),
      ),
      'Scoped publishing credential registered. It cannot administer members, spend funds or create credentials.',
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function revoke(id: string) {
  await run(
    'delsession',
    encodeAction('delsession', { ...actor(), session_id: id }),
    'Credential revoked.',
  );
}
function prepareGuardian() {
  if (!policy.value?.config.guardian) return;
  try {
    const guardian = policy.value.config.guardian;
    const native =
      guardAction.value === 'pause'
        ? {
            name: 'guardpause',
            data: RuntimeActionSchemas.guardpause.parse({
              dao_id: props.dao.reference.daoId,
              until: Math.floor(Date.now() / 1000) + pauseMinutes.value * 60,
              reason: Checksum256.hash(new TextEncoder().encode(reason.value)).toString(),
            }),
          }
        : guardAction.value === 'revoke'
          ? {
              name: 'guardrevoke',
              data: RuntimeActionSchemas.guardrevoke.parse({
                dao_id: props.dao.reference.daoId,
                member_id: guardMember.value,
              }),
            }
          : {
              name: 'guardrecover',
              data: RuntimeActionSchemas.guardrecover.parse({
                dao_id: props.dao.reference.daoId,
                member_id: guardMember.value,
                signing_key: SigningPublicKeySchema.parse(guardKey.value),
              }),
            };
    const payload = {
      chainId: props.dao.reference.chainId,
      runtime: props.dao.reference.contract,
      interfaceVersion: props.dao.reference.interfaceVersion,
      unsigned: true,
      actions: [
        {
          account: props.dao.reference.contract,
          name: native.name,
          authorization: [{ actor: guardian, permission: 'active' }],
          data: native.data,
        },
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'daclify-guardian-transaction.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    success.value =
      'Unsigned transaction prepared. Verify the chain, runtime and action, then sign using the native guardian account.';
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
</script>
<template>
  <section class="panel">
    <div class="section-toolbar">
      <h2>Governance and participants</h2>
      <RouterLink :to="{ path: '/docs/dao-governance', query: { dao: dao.reference.daoId } }"
        >Policy guide ↗</RouterLink
      >
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="success" role="status">{{ success }}</p>
    <p v-if="!workspace.network?.capabilities.includes('governance-policy')" class="notice">
      This deployment does not advertise the versioned governance policy interface.
    </p>
    <p v-else-if="!policy" class="notice">
      No saved governance policy. Existing DAO permissions remain in effect; adopting one requires
      an explicit administrator instruction.
    </p>
    <template v-else>
      <dl>
        <dt>Policy revision</dt>
        <dd>{{ policy.revision }}</dd>
        <dt>Participants</dt>
        <dd>
          {{
            [
              'Human members',
              'Humans and registered agents',
              'Agents with human emergency controls',
            ][policy.config.participant_mode]
          }}
        </dd>
        <dt>Voting</dt>
        <dd>
          {{
            ['Approved members', 'Governance credits', 'Deposited native stake'][policy.config.kind]
          }}
          · {{ policy.config.quorum / 100 }}% quorum · {{ policy.config.approval / 100 }}% approval
        </dd>
        <dt>Funding approval</dt>
        <dd>
          {{
            policy.config.governed_works
              ? 'Works funding requires a passed vote'
              : 'Works funding requires administrator acceptance'
          }}
        </dd>
        <dt>Guardian</dt>
        <dd>{{ policy.config.guardian || 'None configured' }}</dd>
        <dt>Maximum per milestone / installment</dt>
        <dd>
          {{
            policy.config.max_commitment === '0'
              ? 'Unlimited'
              : amount(policy.config.max_commitment) + ' ' + dao.token.symbol
          }}
        </dd>
        <dt>Daily commitment maximum</dt>
        <dd>
          {{
            policy.config.daily_commitment === '0'
              ? 'Unlimited'
              : amount(policy.config.daily_commitment) + ' ' + dao.token.symbol
          }}
        </dd>
      </dl>
      <p class="field-help">
        Administrators control admission, roles, credits, module installation and policy edits.
        Native owner and contract upgrade authority remain separate. Category labels confer no
        authority.
      </p>
      <p v-if="policy.config.guardian === dao.owner" class="notice">
        The guardian is also the native DAO owner and retains those additional owner powers.
      </p>
      <p v-if="state?.guardian" class="notice">
        Last pause expires at {{ new Date(state.guardian.paused_until * 1000).toISOString() }}.
        Pauses preserve existing obligations; expiry permits settlement again.
      </p>
      <details v-if="member?.active && member.admin && draft">
        <summary>Edit ballot policy and commitment limits</summary>
        <form @submit.prevent="updatePolicy">
          <label for="policy-weight">Policy voting weight</label
          ><select id="policy-weight" v-model="draft.weight">
            <option value="member">Approved members</option>
            <option value="credit">Governance credits</option>
            <option value="native-stake">Native stake</option>
          </select>
          <label for="policy-duration">Policy duration (seconds)</label
          ><input
            id="policy-duration"
            v-model.number="draft.duration"
            type="number"
            min="60"
            max="2592000"
            required
          />
          <label for="policy-quorum">Policy quorum (basis points)</label
          ><input
            id="policy-quorum"
            v-model.number="draft.quorumBasisPoints"
            type="number"
            min="1"
            max="10000"
            required
          />
          <label for="policy-approval">Policy approval (basis points)</label
          ><input
            id="policy-approval"
            v-model.number="draft.approvalBasisPoints"
            type="number"
            min="5001"
            max="10000"
            required
          />
          <label class="choice"
            ><input
              v-model="draft.governedWorks"
              type="checkbox"
              :disabled="policy.config.participant_mode === 2"
            /><span>Governed Works funding</span></label
          >
          <label for="policy-maximum">Per milestone / installment maximum</label
          ><input id="policy-maximum" v-model="maximum" inputmode="decimal" required />
          <label for="policy-daily">Daily commitment maximum</label
          ><input id="policy-daily" v-model="daily" inputmode="decimal" required />
          <p class="notice">
            Active ballots block this change. A new policy revision invalidates pending funding
            execution; members must vote again. Participant mode and guardian identity remain fixed.
          </p>
          <button :disabled="!canSign">Sign policy update</button>
        </form>
      </details>
      <h3>Registered agents</h3>
      <p v-if="!agents.length">No agent participants registered.</p>
      <ul v-else>
        <li v-for="agent in agents" :key="agent.id">
          Member {{ agent.id }} · {{ agent.operator_label }} ·
          {{ agent.revoked ? 'Authority revoked' : 'Registered' }}
        </li>
      </ul>
      <details v-if="member">
        <summary>Your scoped publishing credentials</summary>
        <p class="field-help">
          A scoped key can publish inline JSON as your member. It shares your nonce and cannot
          change policies, spend, administer members or delegate. The SDK supports additional
          explicitly granted module actions.
        </p>
        <ul>
          <li
            v-for="credential in state?.sessions.filter(
              (credential) => credential.member_id === member?.memberId,
            )"
            :key="credential.id"
          >
            Credential {{ credential.id }} · expires
            {{ new Date(credential.expires * 1000).toISOString()
            }}<button :disabled="!canSign" @click="revoke(credential.id)">
              Revoke credential {{ credential.id }}
            </button>
          </li>
        </ul>
        <form @submit.prevent="delegate">
          <label for="session-id">Credential ID</label
          ><input id="session-id" v-model="sessionId" pattern="[1-9][0-9]*" required /><label
            for="session-key"
            >Scoped signing public key</label
          ><input id="session-key" v-model="sessionKey" required maxlength="128" /><label
            for="session-hours"
            >Credential lifetime (hours)</label
          ><input
            id="session-hours"
            v-model.number="sessionHours"
            type="number"
            min="1"
            max="168"
            required
          /><button :disabled="!canSign">Register publishing credential</button>
        </form>
      </details>
      <details v-if="policy.config.guardian">
        <summary>Prepare a native guardian action</summary>
        <p>
          Signing recovery can impersonate an agent; it does not recover document decryption keys.
        </p>
        <p class="field-help">
          This prepares an unsigned transaction. It requires the native guardian account's authority
          in an external wallet or operator tooling; your Daclify session cannot sign it.
        </p>
        <form @submit.prevent="prepareGuardian">
          <label for="guard-action">Guardian action</label
          ><select id="guard-action" v-model="guardAction">
            <option value="pause">Pause commitments and payouts</option>
            <option value="revoke">Revoke agent authority</option>
            <option value="recover">Recover a revoked agent signing identity</option>
          </select>
          <template v-if="guardAction === 'pause'"
            ><label for="pause-minutes">Pause duration (minutes)</label
            ><input
              id="pause-minutes"
              v-model.number="pauseMinutes"
              type="number"
              min="1"
              max="1440"
              required /><label for="pause-reason">Pause reason (only its hash is public)</label
            ><input id="pause-reason" v-model="reason" required maxlength="1000"
          /></template>
          <template v-else
            ><label for="guard-member">Agent member ID</label
            ><input
              id="guard-member"
              v-model="guardMember"
              pattern="[1-9][0-9]*"
              required /><template v-if="guardAction === 'recover'"
              ><label for="guard-key">Replacement signing public key</label
              ><input id="guard-key" v-model="guardKey" required maxlength="128" /></template
          ></template>
          <button>Prepare guardian transaction</button>
        </form>
      </details>
      <p class="field-help">
        <RouterLink to="/docs/agents">Agent accounts, recovery and privacy limits ↗</RouterLink>
      </p>
    </template>
  </section>
</template>
