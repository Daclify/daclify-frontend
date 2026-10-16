<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import WorkspaceDialog from './WorkspaceDialog.vue';
import { Pencil } from '@lucide/vue';
import ExecutivePanel from './ExecutivePanel.vue';
import PrivateAgentDetails from './PrivateAgentDetails.vue';
import VotingDurationInput from './VotingDurationInput.vue';
import PercentageInput from './PercentageInput.vue';
import { readableDuration, percentageText } from '../content/governance-inputs';
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
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
const signerReady = computed(() => canSignMember(props.member));
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>();
const workspace = useWorkspace();
const state = ref<GovernanceState>();
const draft = ref<GovernanceConfig>();
const popup = ref(false);
let generation = 0;
const context = computed(() =>
  JSON.stringify([
    props.dao.reference,
    workspace.account?.id,
    props.member?.memberId,
    props.member?.active,
    props.member?.admin,
  ]),
);
onBeforeUnmount(() => generation++);
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
const canSign = computed(() => props.member?.active && signerReady.value && !busy.value);
function amount(units: string) {
  return formatUnits(BigInt(units), props.dao.token.precision);
}
async function load() {
  if (!workspace.network?.capabilities.includes('governance-policy')) return;
  const current = generation,
    reference = JSON.stringify(props.dao.reference);
  try {
    const result = await api.governance(props.dao.reference.daoId);
    if (current !== generation) return;
    if (JSON.stringify(result.dao) !== reference) throw new Error('DAO_REFERENCE');
    state.value = result;
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
    if (current === generation) error.value = friendlyError(cause);
  }
}
watch(
  context,
  () => {
    generation++;
    state.value = undefined;
    draft.value = undefined;
    popup.value = false;
    error.value = '';
    success.value = '';
    busy.value = false;
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
  if (!props.member || !canSign.value) return false;
  const current = generation,
    dao = props.dao,
    member = props.member;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        dao.reference,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 300,
        props.dao.reference.contract,
        action,
        data,
      ),
    );
    if (current !== generation) return false;
    await workspace.refresh();
    if (current !== generation) return false;
    await load();
    if (current !== generation) return false;
    success.value = message;
    return true;
  } catch (cause) {
    if (current === generation) error.value = friendlyError(cause);
    return false;
  } finally {
    if (current === generation) busy.value = false;
  }
}
async function updatePolicy() {
  if (
    !draft.value ||
    !policy.value ||
    !props.member?.active ||
    !props.member.admin ||
    !canSign.value
  )
    return;
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
    const saved = await run(
      'setdaogov',
      encodeAction('setdaogov', {
        ...actor(),
        settings: governanceSettings(setup, policy.value.config.decide),
      }),
      'Policy updated. Pending funding execution under the previous revision is invalid.',
    );
    if (saved) popup.value = false;
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
    <div class="panel-heading">
      <div>
        <h2>Voting rules</h2>
        <p class="field-help">How members vote and approve funding.</p>
      </div>
      <button
        v-if="member?.active && member.admin && draft"
        type="button"
        class="secondary settings-edit"
        aria-haspopup="dialog"
        :disabled="busy"
        @click="popup = true"
      >
        <Pencil aria-hidden="true" />Edit voting rules
      </button>
    </div>
    <p v-if="error && !popup" class="alert" role="alert">{{ error }}</p>
    <p v-if="success" role="status">{{ success }}</p>
    <p v-if="!workspace.network?.capabilities.includes('governance-policy')" class="notice">
      This deployment does not advertise the versioned governance policy interface.
    </p>
    <p v-else-if="!policy" class="notice">
      No saved governance policy. Existing DAO permissions remain in effect; adopting one requires
      an explicit administrator instruction.
    </p>
    <template v-else>
      <dl class="settings-values">
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
            ['Equal active members', 'Governance credits', 'Deposited native stake'][
              policy.config.kind
            ]
          }}
          · {{ percentageText(policy.config.quorum) }}% quorum ·
          {{ percentageText(policy.config.approval) }}% approval
        </dd>
        <dt>Voting duration</dt>
        <dd>{{ readableDuration(policy.config.duration) }}</dd>
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
        Last pause expires at {{ new Date(state.guardian.paused_until * 1000).toLocaleString() }}.
        Pauses preserve existing obligations; expiry permits settlement again.
      </p>
      <WorkspaceDialog
        v-if="member?.active && member.admin && draft"
        v-model:open="popup"
        title="Edit voting rules"
        :busy="busy"
      >
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <form @submit.prevent="updatePolicy">
          <label for="policy-weight">How votes are weighted</label
          ><select id="policy-weight" v-model="draft.weight">
            <option value="member">Equal active members</option>
            <option value="credit">Governance credits</option>
            <option value="native-stake">Deposited {{ dao.token.symbol }} stake</option>
          </select>
          <VotingDurationInput
            id="policy-duration"
            v-model="draft.duration"
            label="Policy duration"
          />
          <div class="two-column">
            <div>
              <PercentageInput
                id="policy-quorum"
                v-model="draft.quorumBasisPoints"
                label="Policy quorum (%)"
                kind="quorum"
              />
            </div>
            <div>
              <PercentageInput
                id="policy-approval"
                v-model="draft.approvalBasisPoints"
                label="Policy approval (%)"
                kind="approval"
              />
            </div>
          </div>
          <label class="choice"
            ><input
              v-model="draft.governedWorks"
              type="checkbox"
              :disabled="policy.config.participant_mode === 2"
            /><span>Require a member vote to approve Works funding</span></label
          >
          <div class="two-column">
            <div>
              <label for="policy-maximum"
                >Per milestone / installment maximum ({{ dao.token.symbol }})</label
              ><input id="policy-maximum" v-model="maximum" inputmode="decimal" required />
            </div>
            <div>
              <label for="policy-daily">Daily commitment maximum ({{ dao.token.symbol }})</label
              ><input id="policy-daily" v-model="daily" inputmode="decimal" required />
            </div>
          </div>
          <p class="field-help">Enter amounts in {{ dao.token.symbol }}. Use 0 for no limit.</p>
          <p class="notice">
            Active ballots block this change. A new policy revision invalidates pending funding
            execution; members must vote again. Participant mode and guardian identity remain fixed.
          </p>
          <button :disabled="!canSign">Sign policy update</button>
        </form>
      </WorkspaceDialog>
      <details class="settings-advanced">
        <summary>Advanced: agents and automation access</summary>
        <p class="field-help">
          Policy revision {{ policy.revision }}. These controls are intended for operators and
          integrations.
        </p>
        <h3>Registered agents</h3>
        <p v-if="!agents.length">No agent participants registered.</p>
        <ul v-else>
          <li v-for="agent in agents" :key="agent.id">
            Member {{ agent.id }} · {{ agent.operator_label }} ·
            {{ agent.revoked ? 'Authority revoked' : 'Registered' }}
            <PrivateAgentDetails
              v-if="dao.privacy !== 'public'"
              :dao="dao"
              :member="member"
              :subject="agent.id"
            />
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
              {{ new Date(credential.expires * 1000).toLocaleString()
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
            This prepares an unsigned transaction. It requires the native guardian account's
            authority in an external wallet or operator tooling; your Daclify session cannot sign
            it.
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
              ><label for="guard-member">Agent</label
              ><select id="guard-member" v-model="guardMember" required>
                <option value="" disabled>Choose an agent</option>
                <option v-for="agent in agents" :key="agent.id" :value="agent.id">
                  {{ agent.operator_label || `Member ${agent.id}` }}
                </option></select
              ><template v-if="guardAction === 'recover'"
                ><label for="guard-key">Replacement signing public key</label
                ><input id="guard-key" v-model="guardKey" required maxlength="128" /></template
            ></template>
            <button>Prepare guardian transaction</button>
          </form>
        </details>
        <p class="field-help">
          <RouterLink to="/docs/agents">Agent accounts, recovery and privacy limits ↗</RouterLink>
        </p>
      </details>
    </template>
  </section>
  <ExecutivePanel :dao="dao" :member="member" :state="state" @refresh="load" />
</template>

<style scoped>
.settings-edit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.settings-edit svg {
  width: 18px;
  height: 18px;
}
.settings-advanced {
  margin-top: 24px;
  border-top: 1px solid var(--border-default);
  padding-top: 16px;
}
</style>
