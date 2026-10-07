<script setup lang="ts">
import { computed, ref } from 'vue';
import { JoinIdentitySchema, type DaoSummary, type UserMembership } from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { relayInstruction, vaultUnlocked } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { friendlyError } from '../api/client';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>();
const emit = defineEmits<{ admitted: [] }>();
const state = useWorkspace();
const identity = ref(''),
  kind = ref(props.dao.participantMode === 'agents-guarded' ? 1 : 0),
  operator = ref(''),
  busy = ref(false),
  error = ref(''),
  success = ref('');
const canAdmit = computed(
  () => props.member?.active && props.member.admin && vaultUnlocked.value && !busy.value,
);
async function admit() {
  const member = props.member;
  if (!member || !canAdmit.value) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const publicIdentity = JoinIdentitySchema.parse(JSON.parse(identity.value));
    if (
      (props.dao.participantMode === 'agents-guarded' && kind.value !== 1) ||
      (props.dao.participantMode === 'humans' && kind.value !== 0)
    )
      throw new Error('PARTICIPANT_MODE');
    if (publicIdentity.custody !== 'user-controlled') throw new Error('MANAGED_UNAVAILABLE');
    await relayInstruction(
      makeInstruction(
        props.dao.reference,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 300,
        props.dao.reference.contract,
        'addmember',
        encodeAction('addmember', {
          runtime: props.dao.reference.contract,
          dao_id: props.dao.reference.daoId,
          member_id: member.memberId,
          signing_key: publicIdentity.signingKey,
          encryption_key: JSON.stringify(publicIdentity.encryptionKey),
          custody: 0,
          kind: kind.value,
          operator_label: kind.value === 1 ? operator.value : '',
        }),
      ),
    );
    identity.value = '';
    operator.value = '';
    await state.refresh();
    emit('admitted');
    success.value =
      'Membership admitted. Select the new member below to grant roles, governance credits and document access separately.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="panel narrow">
    <h3>{{ member?.active && member.admin ? 'Admit a member' : 'Join this DAO' }}</h3>
    <p>
      Share your public join identity with a DAO administrator. Admission, voting credits and
      encrypted-document access are separate approvals.
    </p>
    <RouterLink
      class="button secondary"
      :to="{ path: '/account', query: { returnTo: `/dao/${dao.reference.daoId}/members` } }"
      >Open your public join identity</RouterLink
    >
    <form v-if="member?.active && member.admin" @submit.prevent="admit">
      <p class="field-help">
        Confirm the keys with the applicant through a trusted channel before signing. A copied
        identity does not prove a unique person.
      </p>
      <label for="join-identity">Applicant public join identity (JSON)</label
      ><textarea
        id="join-identity"
        v-model="identity"
        required
        rows="5"
        spellcheck="false"
      ></textarea>
      <label for="participant-kind">Participant kind</label
      ><select id="participant-kind" v-model.number="kind">
        <option v-if="dao.participantMode !== 'agents-guarded'" :value="0">Human</option>
        <option v-if="dao.participantMode !== 'humans'" :value="1">Declared agent</option>
      </select>
      <label v-if="kind === 1" for="participant-operator">Declared operator</label
      ><input
        v-if="kind === 1"
        id="participant-operator"
        v-model="operator"
        required
        maxlength="64"
      />
      <p>
        Public keys only. Never paste a recovery kit, private key or recovery credential here.
        Managed admission is unavailable on this deployment.
      </p>
      <button :disabled="!canAdmit">Sign participant admission</button>
    </form>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <p v-if="success" role="status" class="notice">{{ success }}</p>
  </section>
</template>
