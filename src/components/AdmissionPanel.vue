<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  JoinIdentitySchema,
  type DaoSummary,
  type UserMembership,
  type GovernanceState,
} from '@daclify/core-protocol';
import type { ModuleState } from '@daclify/modules';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { encodeEndorse, type EndorseActions } from '@daclify/modules/sdk';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError } from '../api/client';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>();
const emit = defineEmits<{ admitted: [] }>(),
  state = useWorkspace();
const identity = ref(''),
  kind = ref(props.dao.participantMode === 'agents-guarded' ? 1 : 0),
  operator = ref(''),
  busy = ref(false),
  error = ref(''),
  success = ref('');
const data = ref<ModuleState>(),
  governance = ref<GovernanceState>(),
  documentId = ref(''),
  documentVersion = ref(1),
  applicationId = ref(''),
  days = ref(7),
  confirmed = ref(false),
  reviewed = ref<Record<string, boolean>>({});
const endorsementMode = ref(false),
  threshold = ref(2),
  allowAgents = ref(false),
  adminOverride = ref(false);
const signerReady = computed(
  () => props.member?.active && canSignMember(props.member) && !busy.value,
);
const module = computed(() =>
  data.value?.modules.find((m) => m.deployment.id === 'endorsement-admission'),
);
const rule = computed(() => governance.value?.admission),
  requiresEndorsement = computed(() => rule.value?.mode === 1);
const canAdmit = computed(
  () =>
    signerReady.value &&
    props.member?.admin &&
    (!requiresEndorsement.value || rule.value?.admin_override),
);
const context = computed(() =>
  JSON.stringify([props.dao.reference, state.account?.id, props.member?.memberId]),
);
let generation = 0,
  disposed = false;
function actor() {
  if (!props.member) throw new Error('AUTH_REQUIRED');
  return {
    runtime: props.dao.reference.contract,
    dao_id: props.dao.reference.daoId,
    member_id: props.member.memberId,
  };
}
function newId() {
  const v = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(v[0] ?? 0) << 32n) | BigInt(v[1] ?? 0) || 1n).toString();
}
async function load(more = false) {
  const request = ++generation,
    domain = context.value;
  try {
    const [records, policy] = await Promise.all([
      api.moduleState(props.dao.reference.daoId, {
        ballots: 'done',
        projects: 'done',
        schedules: 'done',
        rounds: 'done',
        applications: 'done',
        elections: 'done',
        terms: 'done',
        ...(more ? { joinApplications: data.value?.next.joinApplications ?? 'done' } : {}),
      }),
      api.governance(props.dao.reference.daoId),
    ]);
    if (disposed || request !== generation || domain !== context.value) return;
    if (
      JSON.stringify(records.dao) !== JSON.stringify(props.dao.reference) ||
      JSON.stringify(policy.dao) !== JSON.stringify(props.dao.reference)
    )
      throw new Error('DAO_REFERENCE');
    if (more && data.value) records.joinApplications.unshift(...data.value.joinApplications);
    data.value = records;
    governance.value = policy;
    endorsementMode.value = policy.admission?.mode === 1;
    threshold.value = policy.admission?.threshold ?? 2;
    allowAgents.value = policy.admission?.allow_agents ?? false;
    adminOverride.value = policy.admission?.admin_override ?? false;
  } catch (cause) {
    if (!disposed && request === generation && domain === context.value)
      error.value = friendlyError(cause);
  }
}
watch(
  context,
  () => {
    generation++;
    identity.value = '';
    operator.value = '';
    confirmed.value = false;
    reviewed.value = {};
    data.value = undefined;
    governance.value = undefined;
    error.value = '';
    success.value = '';
    busy.value = false;
    void load();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
async function run(target: string, action: string, bytes: Uint8Array, message: string) {
  const member = props.member,
    domain = context.value;
  if (!member || !signerReady.value) return;
  if (
    target !== props.dao.reference.contract &&
    (!module.value?.enabled ||
      !module.value.compatible ||
      !module.value.codeVerified ||
      !module.value.actions.includes(action))
  )
    return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        props.dao.reference,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 300,
        target,
        action,
        bytes,
      ),
    );
    if (disposed || domain !== context.value) return;
    await state.refresh();
    if (disposed || domain !== context.value) return;
    await load();
    if (disposed || domain !== context.value) return;
    confirmed.value = false;
    reviewed.value = {};
    emit('admitted');
    success.value = message;
  } catch (cause) {
    if (!disposed && domain === context.value) error.value = friendlyError(cause);
  } finally {
    if (!disposed && domain === context.value) busy.value = false;
  }
}
function publicFields() {
  const person = JoinIdentitySchema.parse(JSON.parse(identity.value));
  if (person.custody !== 'user-controlled') throw new Error('MANAGED_UNAVAILABLE');
  if (
    (props.dao.participantMode === 'agents-guarded' && kind.value !== 1) ||
    (props.dao.participantMode === 'humans' && kind.value !== 0)
  )
    throw new Error('PARTICIPANT_MODE');
  return {
    signing_key: person.signingKey,
    encryption_key: JSON.stringify(person.encryptionKey),
    custody: 0,
    kind: kind.value,
    operator_label: kind.value === 1 ? operator.value : '',
  };
}
async function admit() {
  if (!canAdmit.value || !confirmed.value) return;
  try {
    await run(
      props.dao.reference.contract,
      'addmember',
      encodeAction('addmember', { ...actor(), ...publicFields() }),
      'Membership admitted. Roles, credits and private document access require separate approvals.',
    );
    identity.value = '';
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function sign<K extends keyof EndorseActions>(
  action: K,
  payload: EndorseActions[K],
  message: string,
) {
  try {
    if (!module.value) return;
    await run(module.value.deployment.account, action, encodeEndorse(action, payload), message);
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function sponsor() {
  if (!confirmed.value) return;
  try {
    await sign(
      'applyjoin',
      {
        ...actor(),
        ...publicFields(),
        application_id: applicationId.value || newId(),
        document_id: documentId.value,
        document_version: documentVersion.value,
        expires: Math.floor(Date.now() / 1000) + days.value * 86400,
      },
      'Application sponsored. Current eligible members must endorse its exact revision.',
    );
    identity.value = '';
    applicationId.value = '';
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function savePolicy() {
  if (!props.member?.admin) return;
  if (endorsementMode.value && (!module.value?.enabled || !module.value.codeVerified)) return;
  if (
    !window.confirm(
      `Change DAO admission to ${endorsementMode.value ? `${threshold.value} eligible endorsements; administrator override ${adminOverride.value ? 'ENABLED' : 'disabled'}` : 'administrator admission'}? Existing applications will require renewal.`,
    )
  )
    return;
  await run(
    props.dao.reference.contract,
    'setadmit',
    encodeAction('setadmit', {
      ...actor(),
      enabled: endorsementMode.value,
      source: module.value?.deployment.account ?? '',
      threshold: threshold.value,
      allow_agents: allowAgents.value,
      admin_override: adminOverride.value,
    }),
    'Admission policy updated. Earlier applications require renewal.',
  );
}
function eligibleAction(action: string) {
  return (
    signerReady.value &&
    module.value?.enabled &&
    module.value.compatible &&
    module.value.codeVerified &&
    module.value.actions.includes(action)
  );
}
</script>
<template>
  <section class="panel narrow">
    <h3>{{ requiresEndorsement ? 'Member endorsement admission' : 'Administrator admission' }}</h3>
    <p>
      Share your public join identity with
      {{
        requiresEndorsement
          ? 'a current member who can sponsor your application'
          : 'a DAO administrator'
      }}. Joining, voting credits and encrypted document access are separate approvals.
    </p>
    <RouterLink
      class="button secondary"
      :to="{ path: '/account', query: { returnTo: `/dao/${dao.reference.daoId}/members` } }"
      >Open your public join identity</RouterLink
    ><RouterLink v-if="requiresEndorsement" class="help-link" to="/docs/endorsement-admission"
      >Endorsement rules ↗</RouterLink
    >
    <p v-if="requiresEndorsement">
      Policy revision {{ rule?.revision }} · {{ rule?.threshold }} current eligible endorsements ·
      {{ rule?.allow_agents ? 'Humans and agents can endorse' : 'Human members endorse' }} ·
      administrator override {{ rule?.admin_override ? 'enabled' : 'disabled' }}.
    </p>
    <details v-if="member?.admin">
      <summary>Configure admission policy</summary>
      <form @submit.prevent="savePolicy">
        <label
          >Admission mode<select v-model="endorsementMode">
            <option :value="false">Administrator admission</option>
            <option :value="true">Member endorsements</option>
          </select></label
        ><template v-if="endorsementMode"
          ><p v-if="!module?.enabled">
            Enable Endorsement admission in
            <RouterLink :to="`/dao/${dao.reference.daoId}/modules`">Modules</RouterLink> first.
          </p>
          <label
            >Required endorsements<input
              v-model.number="threshold"
              type="number"
              min="1"
              max="20"
              required /></label
          ><label class="checkbox"
            ><input v-model="allowAgents" type="checkbox" />Allow active agents to endorse</label
          ><label class="checkbox"
            ><input v-model="adminOverride" type="checkbox" />Allow administrator admission
            override</label
          >
          <p>
            Disabling the override also enforces this rule on owner enrollment. An administrator can
            change this policy later. Policy changes invalidate pending applications.
          </p></template
        ><button
          :disabled="
            !signerReady || (endorsementMode && (!module?.enabled || !module.codeVerified))
          "
        >
          Review and sign admission policy
        </button>
      </form>
    </details>
    <form
      v-if="member?.active && (requiresEndorsement || member.admin)"
      @submit.prevent="requiresEndorsement ? sponsor() : admit()"
    >
      <h4>{{ requiresEndorsement ? 'Sponsor or renew an application' : 'Admit a member' }}</h4>
      <p class="field-help">
        Public keys only. Verify the keys with the applicant through a trusted channel. Multiple
        logins and endorsements do not prove a unique person.
      </p>
      <label for="join-identity">Applicant public join identity (JSON)</label
      ><textarea
        id="join-identity"
        v-model="identity"
        rows="5"
        spellcheck="false"
        required
      ></textarea
      ><label for="participant-kind">Participant kind</label
      ><select id="participant-kind" v-model.number="kind">
        <option v-if="dao.participantMode !== 'agents-guarded'" :value="0">Human</option>
        <option v-if="dao.participantMode !== 'humans'" :value="1">Declared agent</option></select
      ><label v-if="kind === 1"
        >Declared operator<input v-model="operator" maxlength="64" required /></label
      ><template v-if="requiresEndorsement"
        ><label
          >Existing application ID (leave blank for a new application)<input
            v-model="applicationId"
            inputmode="numeric" /></label
        ><label
          >Application document ID<input v-model="documentId" inputmode="numeric" required /></label
        ><label
          >Document version<input
            v-model.number="documentVersion"
            type="number"
            min="1"
            required /></label
        ><label
          >Expires in days<input v-model.number="days" type="number" min="1" max="30" required
        /></label>
        <p>
          Only the original sponsor can amend or renew. Renewal clears earlier endorsements.
        </p></template
      ><label class="checkbox"
        ><input v-model="confirmed" type="checkbox" required />I confirmed these public keys,
        participant identity and application terms</label
      >
      <p>
        Never paste a recovery kit or private key. Managed admission is unavailable on this
        deployment.
      </p>
      <button
        :disabled="!confirmed || (requiresEndorsement ? !eligibleAction('applyjoin') : !canAdmit)"
      >
        {{
          requiresEndorsement ? 'Sign sponsored application' : 'Sign participant admission'
        }}</button
      ><button
        v-if="requiresEndorsement && rule?.admin_override && member.admin"
        type="button"
        class="secondary"
        :disabled="!canAdmit || !confirmed"
        @click="admit"
      >
        Use disclosed administrator override
      </button>
    </form>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="success" class="notice" role="status">{{ success }}</p>
  </section>
  <article v-for="app in data?.joinApplications" :key="app.id" class="panel">
    <h3>
      Join application {{ app.id }} ·
      {{ app.admitted ? 'Admitted member ' + app.member_id : 'Pending' }}
    </h3>
    <p>
      Sponsor {{ app.sponsor }} · revision {{ app.revision }} · policy {{ app.policy_revision }} ·
      {{ app.kind === 1 ? 'Agent: ' + app.operator_label : 'Human' }} · expires
      {{ new Date(app.expires * 1000).toLocaleString() }}
    </p>
    <p>
      Document {{ app.document_id }} / v{{ app.document_version }} · recorded endorsements
      {{ app.witnesses.join(', ') || 'none' }}. Admission rechecks whether they remain eligible.
    </p>
    <details>
      <summary>Review complete public identity and document commitment</summary>
      <p class="mono wrap">{{ app.signing_key }}</p>
      <p class="mono wrap">{{ app.encryption_key }}</p>
      <p>
        {{ app.custody === 0 ? 'User-controlled' : 'Managed' }} · document commitment
        <span class="mono wrap">{{ app.document_commitment }}</span>
      </p>
    </details>
    <template v-if="!app.admitted && member?.active"
      ><label class="checkbox"
        ><input v-model="reviewed[app.id]" type="checkbox" />I reviewed this exact revision and
        confirmed the applicant identity</label
      ><button
        v-if="!app.witnesses.includes(member.memberId)"
        :disabled="
          !reviewed[app.id] || !eligibleAction('witness') || app.policy_revision !== rule?.revision
        "
        @click="
          sign(
            'witness',
            { ...actor(), application_id: app.id, revision: app.revision },
            'Endorsement recorded for this revision.',
          )
        "
      >
        Sign endorsement</button
      ><button
        v-else
        class="secondary"
        :disabled="!eligibleAction('unwitness')"
        @click="
          sign(
            'unwitness',
            { ...actor(), application_id: app.id, revision: app.revision },
            'Endorsement withdrawn.',
          )
        "
      >
        Withdraw endorsement</button
      ><button
        :disabled="
          !reviewed[app.id] || !eligibleAction('admit') || app.policy_revision !== rule?.revision
        "
        @click="
          sign(
            'admit',
            { ...actor(), application_id: app.id, revision: app.revision },
            'Member admitted once. Roles, credits and private access remain separate.',
          )
        "
      >
        Sign admission request
      </button></template
    >
  </article>
  <button v-if="data?.next.joinApplications" class="secondary" :disabled="busy" @click="load(true)">
    Load more join applications
  </button>
</template>
