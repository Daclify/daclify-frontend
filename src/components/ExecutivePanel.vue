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
  nativeHandoverActions,
  nativeOwnershipAuthorities,
  nativeOwnershipAccount,
  assertNativeOwnershipRuntime,
  NativeOwnershipPolicyVersion,
  NativeServiceActions,
  nativeOwnershipSetupActions,
  makeInstruction,
  RuntimeActionSchemas,
  RuntimeTableSchemas,
} from '@daclify/core-protocol/sdk';
import { executiveStatus } from '../auth/executives';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError } from '../api/client';
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
  serviceKey = ref(''),
  creator = ref(''),
  inlineContracts = ref('');
const view = computed(() =>
  executiveStatus(props.state, props.member?.memberId, Math.floor(Date.now() / 1000)),
);
const canSign = computed(() => props.member?.active && canSignMember(props.member) && !busy.value);
const native = computed(() => props.state?.nativeGovernance);
const ownershipSupported = computed(
  () =>
    workspace.network?.capabilities.includes('creator-owner-executive-active') &&
    (!native.value || native.value.ownership?.policy_version === NativeOwnershipPolicyVersion),
);
const quorum = computed(() =>
  Math.ceil(
    (view.value.effectiveSigners.length * (props.state?.executivePolicy?.quorum_bps ?? 10000)) /
      10000,
  ),
);
const authorityPlan = computed(() => {
  const cfg = native.value;
  if (!cfg?.ownership || !ownershipSupported.value || quorum.value < 1) return [];
  return nativeOwnershipAuthorities(
    props.dao.reference.contract,
    { contracts: cfg.contracts, ...cfg.ownership },
    view.value.effectiveSigners,
    quorum.value,
  );
});
async function verifiedClient() {
  const network = workspace.network;
  if (!ownershipSupported.value) throw new Error('NATIVE_POLICY_MIGRATION_REQUIRED');
  if (
    !network ||
    network.chainId !== props.dao.reference.chainId ||
    network.runtime !== props.dao.reference.contract
  )
    throw new Error('NETWORK_MISMATCH');
  const client = new APIClient({
    url: network.rpcUrl,
    fetch: (input, init) =>
      fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) }),
  });
  const [info, release] = await Promise.all([
    client.v1.chain.get_info(),
    client.v1.chain.get_raw_abi(network.runtime),
  ]);
  if (
    info.chain_id.toString() !== network.chainId ||
    release.account_name.toString() !== network.runtime
  )
    throw new Error('NETWORK_MISMATCH');
  assertNativeOwnershipRuntime(release);
  return { client, info, release };
}
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
function download(actions: unknown[], review: unknown = undefined) {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            chainId: props.dao.reference.chainId,
            runtime: props.dao.reference.contract,
            unsigned: true,
            review,
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
async function appoint() {
  try {
    const data = RuntimeActionSchemas.appoint.parse({
      dao_id: props.dao.reference.daoId,
      member_ids: selectedMembers(),
      inactivity_seconds: Math.round(days.value * 86400),
      quorum_bps: percent.value * 100,
    });
    if (native.value) {
      await verifiedClient();
      download([
        {
          account: props.dao.reference.contract,
          name: 'appoint',
          authorization: [
            {
              actor: props.dao.reference.contract,
              permission: native.value.handed_over ? 'active' : 'owner',
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
async function prepareNativeSetup() {
  busy.value = true;
  error.value = '';
  try {
    const { client, info, release } = await verifiedClient();
    const accounts = contracts.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => NativeAccountSchema.parse(s));
    const data = RuntimeActionSchemas.setnativegov.parse({
      dao_id: props.dao.reference.daoId,
      contracts: accounts,
      service_key: SigningPublicKeySchema.parse(serviceKey.value),
      creator: NativeAccountSchema.parse(creator.value.trim()),
      inline_code: inlineContracts.value
        .split(',')
        .map((account) => account.trim())
        .filter(Boolean),
    });
    const snapshots = await Promise.all(
      [props.dao.reference.contract, data.creator, ...data.contracts].map(async (account) =>
        nativeOwnershipAccount(
          await client.call({ path: '/v1/chain/get_account', params: { account_name: account } }),
        ),
      ),
    );
    download(
      nativeOwnershipSetupActions(props.dao.reference.contract, data).map((action) => {
        const value: unknown = JSON.parse(JSON.stringify(action));
        return value;
      }),
      {
        observedBlock: info.head_block_num.toString(),
        runtimeCodeHash: release.code_hash.toString(),
        runtimeRawAbiHash: release.abi_hash.toString(),
        creator: data.creator,
        inlineCode: data.inline_code,
        serviceActions: NativeServiceActions,
        accounts: snapshots,
        upgradePolicy: { bootstrapRuntime: 'owner', handedOverRuntime: 'active', managed: 'owner' },
      },
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function prepareHandover() {
  busy.value = true;
  error.value = '';
  try {
    const { client, info, release } = await verifiedClient();
    const rows = await client.v1.chain.get_table_rows({
      code: props.dao.reference.contract,
      scope: props.dao.reference.contract,
      table: 'nativegov',
      limit: 1,
    });
    const cfg = RuntimeTableSchemas.nativegov.parse(rows.rows[0]);
    if (
      cfg.handed_over ||
      cfg.dao_id !== props.dao.reference.daoId ||
      cfg.ownership?.creator !== native.value?.ownership?.creator
    )
      throw new Error('NATIVE_HANDOVER_CHANGED');
    const current = await api.governance(props.dao.reference.daoId);
    const fresh = executiveStatus(
      current,
      props.member?.memberId,
      Math.floor(info.head_block_time.toDate().getTime() / 1000),
    );
    const threshold = Math.ceil(
      (fresh.effectiveSigners.length * (current.executivePolicy?.quorum_bps ?? 10000)) / 10000,
    );
    const accounts = await Promise.all(
      [props.dao.reference.contract, ...cfg.contracts].map(async (account) =>
        nativeOwnershipAccount(
          await client.call({ path: '/v1/chain/get_account', params: { account_name: account } }),
        ),
      ),
    );
    const data = RuntimeActionSchemas.handover.parse({
      dao_id: props.dao.reference.daoId,
      expected_signers: fresh.effectiveSigners,
      expected_threshold: threshold,
      expected_revision: current.executivePolicy?.revision,
      expected_creator: cfg.ownership?.creator,
      expected_policy_version: cfg.ownership?.policy_version,
    });
    download(
      nativeHandoverActions(props.dao.reference.contract, cfg, data, accounts).map((action) => {
        const value: unknown = JSON.parse(JSON.stringify(action));
        return value;
      }),
      {
        observedBlock: info.head_block_num.toString(),
        runtimeCodeHash: release.code_hash.toString(),
        runtimeRawAbiHash: release.abi_hash.toString(),
        before: accounts,
        after: nativeOwnershipAuthorities(
          props.dao.reference.contract,
          {
            contracts: cfg.contracts,
            creator: data.expected_creator,
            inline_code: cfg.ownership?.inline_code ?? [],
          },
          fresh.effectiveSigners,
          threshold,
        ),
        serviceActions: NativeServiceActions,
        policyVersion: data.expected_policy_version,
      },
    );
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
      <p v-if="!ownershipSupported" class="notice">
        This runtime needs a reviewed ownership-policy upgrade before native ownership transactions
        can be prepared.
      </p>
      <div v-if="native?.ownership" class="ownership-review">
        <h3>
          {{ native.handed_over ? 'Native ownership policy' : 'Proposed native ownership policy' }}
        </h3>
        <p>
          Configured creator recovery: <strong>{{ native.ownership.creator }}@active</strong>.
          Handover delegates runtime owner to this account.
        </p>
        <p>
          Effective executive quorum:
          <strong>{{ quorum }} of {{ view.effectiveSigners.length }}</strong> eligible executives;
          authority refresh applies this quorum and the same code weight to active.
          {{ view.effectiveSigners.join(', ') }}
        </p>
        <p>
          After handover, runtime upgrades use active quorum. Creator owner can recover active.
          Managed contract upgrades use owner, delegated to runtime active.
        </p>
        <ul>
          <li v-for="account in native.contracts" :key="account">
            {{ account }} ·
            {{
              native.ownership.inline_code.includes(account)
                ? 'Own code enabled for inline actions'
                : 'Runtime active delegation only'
            }}
          </li>
        </ul>
        <p>Service scope after handover: {{ NativeServiceActions.join(', ') }}.</p>
        <p v-if="authorityPlan.length">
          A download includes current authority snapshots and the proposed owner/active tree for
          review.
        </p>
      </div>
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
        <button :disabled="busy || (native ? !ownershipSupported : !canSign)">
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
        ><input id="voter-member" v-model="voter" required /><label class="checkbox"
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
          <label for="executive-creator">Creator recovery account</label
          ><input id="executive-creator" v-model="creator" required /><label for="executive-inline"
            >Managed accounts that send inline actions, separated by commas</label
          ><input id="executive-inline" v-model="inlineContracts" />
          <p class="field-help">
            Enable own code for modules and Names. Hub needs only runtime delegation.
          </p>
          <label for="executive-contracts">Managed contract accounts, separated by commas</label
          ><input id="executive-contracts" v-model="contracts" /><label for="executive-service-key"
            >Hosting service signing public key</label
          ><input id="executive-service-key" v-model="serviceKey" required /><button
            :disabled="busy || !ownershipSupported"
          >
            Prepare owner configuration
          </button>
        </form>
      </details>
      <button
        v-if="native && !native.handed_over"
        type="button"
        :disabled="busy || !ownershipSupported || view.pairedCount === 0"
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
