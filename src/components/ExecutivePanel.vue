<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { APIClient } from '@wharfkit/antelope';
import {
  IdSchema,
  NativeAccountSchema,
  SigningPublicKeySchema,
  type GovernanceState,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import {
  encodeAction,
  handoverOwnerActions,
  nativeOwnershipSetupActions,
  makeInstruction,
  RuntimeActionSchemas,
} from '@daclify/core-protocol/sdk';
import { executiveStatus } from '../auth/executives';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { useWorkspace } from '../state/workspace';
import { friendlyError } from '../api/client';
const props = defineProps<{
  dao: DaoSummary;
  member: UserMembership | undefined;
  state: GovernanceState | undefined;
}>();
const emit = defineEmits<{ refresh: [] }>();
const workspace = useWorkspace(),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const members = ref('1'),
  days = ref(30),
  percent = ref(100),
  voter = ref(''),
  allowed = ref(true),
  contracts = ref(''),
  serviceKey = ref('');
const view = computed(() =>
  executiveStatus(props.state, props.member?.memberId, Math.floor(Date.now() / 1000)),
);
const canSign = computed(() => props.member?.active && canSignMember(props.member) && !busy.value);
const native = computed(() => props.state?.nativeGovernance);
watch(
  () => props.state,
  (state) => {
    members.value =
      state?.executives.map((office) => office.member_id).join(', ') ||
      props.member?.memberId ||
      '';
    days.value = (state?.executivePolicy?.inactivity_seconds ?? 2592000) / 86400;
    percent.value = (state?.executivePolicy?.quorum_bps ?? 10000) / 100;
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
function selectedMembers() {
  const ids = members.value.split(',').map((id) => IdSchema.parse(id.trim()));
  if (ids.length < 1 || ids.length > 8 || new Set(ids).size !== ids.length)
    throw new Error('EXECUTIVE_LIMIT');
  return ids;
}
async function run(action: 'heartbeat' | 'setexecs' | 'setvoter' | 'refreshgov', data: Uint8Array) {
  if (!props.member) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        props.dao.reference,
        props.member.memberId,
        props.member.nonce,
        Math.floor(Date.now() / 1000) + 120,
        props.dao.reference.contract,
        action,
        data,
      ),
    );
    await workspace.refresh();
    emit('refresh');
    notice.value = 'Confirmed on chain.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function heartbeat() {
  void run('heartbeat', encodeAction('heartbeat', actor()));
}
function setVoter() {
  try {
    void run(
      'setvoter',
      encodeAction('setvoter', {
        ...actor(),
        target: IdSchema.parse(voter.value),
        can_vote: allowed.value,
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
function download(actions: unknown[]) {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            chainId: props.dao.reference.chainId,
            runtime: props.dao.reference.contract,
            unsigned: true,
            actions,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'daclify-executive-transaction.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  notice.value =
    'Unsigned transaction downloaded. Verify its chain, accounts and full action list before owner/quorum signing.';
}
function appoint() {
  try {
    const data = RuntimeActionSchemas.appoint.parse({
      dao_id: props.dao.reference.daoId,
      member_ids: selectedMembers(),
      inactivity_seconds: Math.round(days.value * 86400),
      quorum_bps: percent.value * 100,
    });
    if (native.value) {
      download([
        {
          account: props.dao.reference.contract,
          name: 'appoint',
          authorization: [
            {
              actor: props.dao.reference.contract,
              permission: native.value.handed_over ? 'govern' : 'owner',
            },
          ],
          data,
        },
      ]);
    } else
      void run(
        'setexecs',
        encodeAction('setexecs', {
          ...actor(),
          member_ids: data.member_ids,
          inactivity_seconds: data.inactivity_seconds,
          quorum_bps: data.quorum_bps,
        }),
      );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
function prepareNativeSetup() {
  try {
    const accounts = contracts.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => NativeAccountSchema.parse(s));
    const data = RuntimeActionSchemas.setnativegov.parse({
      dao_id: props.dao.reference.daoId,
      contracts: accounts,
      service_key: SigningPublicKeySchema.parse(serviceKey.value),
    });
    download(
      nativeOwnershipSetupActions(props.dao.reference.contract, data).map((action) => {
        const value: unknown = JSON.parse(JSON.stringify(action));
        return value;
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function prepareHandover() {
  busy.value = true;
  error.value = '';
  try {
    const cfg = native.value,
      network = workspace.network;
    if (
      !cfg ||
      cfg.handed_over ||
      !network ||
      network.chainId !== props.dao.reference.chainId ||
      network.runtime !== props.dao.reference.contract
    )
      throw new Error('NETWORK_MISMATCH');
    const client = new APIClient({ url: network.rpcUrl });
    const info = await client.v1.chain.get_info();
    if (info.chain_id.toString() !== props.dao.reference.chainId)
      throw new Error('NETWORK_MISMATCH');
    const accounts = await Promise.all(
      [props.dao.reference.contract, ...cfg.contracts].map((account) =>
        client.v1.chain.get_account(account),
      ),
    );
    const stages = handoverOwnerActions(props.dao.reference.contract, accounts);
    download([
      ...stages.map((action) => {
        const value: unknown = JSON.parse(JSON.stringify(action));
        return value;
      }),
      {
        account: props.dao.reference.contract,
        name: 'handover',
        authorization: accounts.map((account) => ({
          actor: account.account_name.toString(),
          permission: 'owner',
        })),
        data: RuntimeActionSchemas.handover.parse({
          dao_id: props.dao.reference.daoId,
          expected_signers: view.value.effectiveSigners,
          expected_threshold: Math.max(
            1,
            Math.ceil(
              (view.value.effectiveSigners.length *
                (props.state?.executivePolicy?.quorum_bps ?? 10000)) /
                10000,
            ),
          ),
          expected_revision: props.state?.executivePolicy?.revision,
        }),
      },
    ]);
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function refresh() {
  void run('refreshgov', encodeAction('refreshgov', actor()));
}
</script>
<template>
  <section
    v-if="workspace.network?.capabilities.includes('executive-authority')"
    class="panel"
    aria-labelledby="executive-heading"
  >
    <h2 id="executive-heading">Executives and voting rights</h2>
    <p>
      Executive office is separate from membership and voting. Pairing a wallet does not appoint an
      executive.
    </p>
    <p v-if="!state">Loading executive policy…</p>
    <template v-else>
      <p v-if="!state.executivePolicy">
        No executive policy has been appointed. Existing administrator and voting rights remain in
        place.
      </p>
      <p v-if="native">
        {{
          native.handed_over
            ? 'Native contract governance is active.'
            : 'Bootstrap owner still controls the contracts. Handover awaits an appointed executive with a paired Telos Zero account and owner signatures.'
        }}
      </p>
      <p v-else>
        This DAO governs its own data. Shared DAOs do not manage the platform’s native account
        permissions.
      </p>
      <p v-if="state.executivePolicy">
        Inactivity timeout:
        {{
          state.executivePolicy.inactivity_seconds === 0
            ? 'disabled'
            : `${state.executivePolicy.inactivity_seconds / 86400} days`
        }}. Native quorum: {{ state.executivePolicy.quorum_bps / 100 }}% of active, eligible paired
        executives.
      </p>
      <ul>
        <li v-for="office in state.executives" :key="office.member_id">
          Member {{ office.member_id }} ·
          {{
            state.executiveMembers.find((m) => m.id === office.member_id)?.native_account ||
            'Telos Zero account not paired'
          }}
          · last activity {{ new Date(office.last_active * 1000).toISOString() }}
        </li>
      </ul>
      <p v-if="native?.handed_over">
        Governing DAO administrator rights follow the eligible paired executive roster. App
        administrator actions use individual member authorization; native ownership changes require
        the configured executive quorum.
      </p>
      <p v-if="native && state.executiveMembers.some((m) => m.custody === 1)" class="notice">
        A managed executive account trusts its custody provider with its Daclify signing key. That
        key can authorize an atomic paired-wallet replacement, which changes native control. Use a
        user-controlled account when that provider must not hold this power.
      </p>
      <p v-if="native?.handed_over">
        Last synchronized native threshold: {{ native.threshold }}; wallets:
        {{ native.signers.join(', ') }}. Expiry is applied by an on-chain refresh.
      </p>
      <p v-if="state.executiveHandover">
        Election {{ state.executiveHandover.election_id }} handover starts
        {{ new Date(state.executiveHandover.starts * 1000).toISOString() }}. The outgoing roster
        retains control until a valid successor activates.
      </p>
      <p v-if="view.lastPaired" class="notice">
        You are the last paired native executive. Replace your wallet atomically; unlinking is
        blocked.
      </p>
      <p v-if="state.executivePolicy" class="notice">
        One remaining active paired executive can control this deployment. Returning executives can
        restore activity while they still hold office.
      </p>
      <button v-if="view.office" type="button" :disabled="!canSign" @click="heartbeat">
        Confirm executive activity
      </button>
      <button
        v-if="state.executivePolicy"
        type="button"
        class="secondary"
        :disabled="!canSign"
        @click="refresh"
      >
        Refresh executive authority
      </button>
      <form
        v-if="member?.admin || (native?.handed_over && view.office && member?.nativeAccount)"
        @submit.prevent="appoint"
      >
        <h3>Appoint executives</h3>
        <label for="executive-members">Member IDs, separated by commas</label
        ><input id="executive-members" v-model="members" required />
        <label for="executive-days">Inactivity timeout in days; 0 disables expiry</label
        ><input
          id="executive-days"
          v-model.number="days"
          type="number"
          min="0"
          max="365"
          step="any"
          required
        />
        <label for="executive-quorum">Native quorum percentage</label
        ><input
          id="executive-quorum"
          v-model.number="percent"
          type="number"
          min="1"
          max="100"
          required
        />
        <button :disabled="busy || (!native && !canSign)">
          {{ native ? 'Prepare native appointment transaction' : 'Sign executive appointment' }}
        </button>
        <p v-if="native" class="field-help">
          {{
            native.handed_over
              ? 'Requires the current native executive quorum.'
              : 'Requires the DAO’s current deployment authority.'
          }}
        </p>
      </form>
      <form v-if="member?.admin" @submit.prevent="setVoter">
        <h3>Voting eligibility</h3>
        <label for="voter-member">Member ID</label
        ><input id="voter-member" v-model="voter" required /><label class="check"
          ><input v-model="allowed" type="checkbox" />Allow this member to vote</label
        ><button :disabled="!canSign">Sign voting eligibility change</button>
        <p>
          Active ballots block eligibility changes. Membership and private-content access remain
          separate.
        </p>
      </form>
      <details v-if="state.nativeSetupEligible && !native">
        <summary>Deployment owner: prepare native ownership setup</summary>
        <p>
          Only the runtime’s governing DAO needs this. The existing runtime owner must sign; an app
          administrator session grants no native owner authority.
        </p>
        <form @submit.prevent="prepareNativeSetup">
          <label for="executive-contracts">Managed contract accounts, separated by commas</label
          ><input id="executive-contracts" v-model="contracts" /><label for="executive-service-key"
            >Hosting service signing public key</label
          ><input id="executive-service-key" v-model="serviceKey" required /><button
            :disabled="busy"
          >
            Prepare owner configuration
          </button>
        </form>
      </details>
      <button
        v-if="native && !native.handed_over"
        type="button"
        :disabled="busy || view.pairedCount === 0"
        @click="prepareHandover"
      >
        Prepare atomic owner handover
      </button>
    </template>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <RouterLink to="/docs/executives">Executive authority and wallet recovery ↗</RouterLink>
  </section>
</template>
