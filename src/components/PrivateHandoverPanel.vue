<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  type ExitPreflight,
  type DaoContent,
  type PrivateAccessPolicy,
  type DaoHandover,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction, type RuntimeActions } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { dispatchInstruction } from '../auth/action-signer';
import { grantPrivateEpoch, verifyPrivateEpochs, vaultUnlocked } from '../auth/session';
import { planPrivateAccess } from '../auth/private-access';
import { validatePrivateHandover } from '../auth/private-handover';
const props = defineProps<{ member: ExitPreflight['memberships'][number] }>(),
  emit = defineEmits<{ reviewed: [commitment: string] }>(),
  state = useWorkspace();
const content = ref<DaoContent>(),
  policy = ref<PrivateAccessPolicy>(),
  handover = ref<DaoHandover | null>(),
  successor = ref(''),
  otherDevice = ref(false),
  verified = ref(false),
  busy = ref(false),
  error = ref('');
const context = computed(() =>
  JSON.stringify([props.member.reference, props.member.memberId, state.account?.id]),
);
const fingerprint = computed(() =>
  JSON.stringify([
    context.value,
    policy.value,
    content.value?.epochs,
    content.value?.keyGrants,
    content.value?.members.map((person) => [
      person.id,
      person.active,
      person.admin,
      person.custody,
      person.signing_key,
      person.encryption_key,
      person.join_epoch,
    ]),
  ]),
);
watch(fingerprint, () => {
  verified.value = false;
  otherDevice.value = false;
});
const candidates = computed(
  () =>
    content.value?.members.filter(
      (person) => person.active && person.admin && person.id !== props.member.memberId,
    ) ?? [],
);
const isSuccessor = computed(() => handover.value?.successor === props.member.memberId);
const pendingGrants = computed(() =>
  content.value && policy.value
    ? planPrivateAccess(
        content.value,
        props.member.memberId,
        policy.value.historyPolicy,
        policy.value.privacy,
      ).grants.filter((grant) => grant.recipient.id === successor.value)
    : [],
);
async function refresh() {
  const domain = context.value;
  const [records, access, prepared] = await Promise.all([
    api.content(props.member.reference.daoId),
    api.privateAccessPolicy(props.member.reference.daoId),
    api.daoHandover(props.member.reference.daoId),
  ]);
  if (
    domain !== context.value ||
    JSON.stringify(records.dao) !== JSON.stringify(props.member.reference) ||
    JSON.stringify(access.dao) !== JSON.stringify(props.member.reference) ||
    Object.values(records.next).some((cursor) => cursor !== null)
  )
    throw Error('PRIVATE_ACCESS_CONTEXT');
  content.value = records;
  policy.value = access;
  handover.value = prepared;
}
async function run(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await work();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function actor() {
  const records = content.value,
    person = records?.members.find((member) => member.id === props.member.memberId);
  if (!records || !person?.active) throw Error('PRIVATE_HANDOVER_REQUIRED');
  return { runtime: records.dao.contract, dao_id: records.dao.daoId, member_id: person.id };
}
async function dispatch<K extends 'beginhand' | 'scanhand' | 'accepthand' | 'grantkey'>(
  action: K,
  parameters: RuntimeActions[K],
  expectedFingerprint?: string,
) {
  const domain = context.value;
  await refresh();
  if (expectedFingerprint !== undefined && expectedFingerprint !== fingerprint.value)
    throw Error('PRIVATE_ACCESS_CONTEXT');
  const person = content.value?.members.find((member) => member.id === props.member.memberId);
  if (!person?.active) throw Error('PRIVATE_HANDOVER_REQUIRED');
  const request = makeInstruction(
    props.member.reference,
    person.id,
    person.nonce,
    Math.floor(Date.now() / 1000) + 300,
    props.member.reference.contract,
    action,
    encodeAction(action, parameters),
  );
  if (domain !== context.value) throw Error('WALLET_CONTEXT_CHANGED');
  await dispatchInstruction(request);
  await state.refresh();
  await refresh();
}
async function verify() {
  await run(async () => {
    await refresh();
    const records = content.value,
      access = policy.value,
      person = records?.members.find((member) => member.id === props.member.memberId);
    if (!records || !access || !person) throw Error('PRIVATE_ACCESS_UNAVAILABLE');
    const snap = fingerprint.value,
      epochs = records.epochs
        .filter(
          (epoch) =>
            access.historyPolicy === 'full-history' ||
            BigInt(epoch.epoch) >= BigInt(person.join_epoch),
        )
        .map((epoch) => epoch.epoch);
    for (let index = 0; index < epochs.length; index += 20) {
      await verifyPrivateEpochs(
        props.member.reference,
        person.id,
        epochs.slice(index, index + 20),
        records,
      );
      if (snap !== fingerprint.value) throw Error('PRIVATE_ACCESS_CONTEXT');
    }
    verified.value = true;
  });
}
async function grantBatch() {
  await run(async () => {
    await refresh();
    const batch = pendingGrants.value.slice(0, 20);
    for (const grant of batch) {
      const records = content.value;
      if (!records) throw Error('PRIVATE_ACCESS_UNAVAILABLE');
      const recipient = records.members.find((person) => person.id === grant.recipient.id);
      if (!recipient || recipient.encryption_key !== grant.recipient.encryption_key)
        throw Error('PRIVATE_ACCESS_CONTEXT');
      const snap = fingerprint.value;
      const envelope = await grantPrivateEpoch(
        props.member.reference,
        props.member.memberId,
        recipient,
        grant.epoch,
        records,
      );
      await dispatch(
        'grantkey',
        {
          ...(await actor()),
          recipient: recipient.id,
          epoch: grant.epoch,
          envelope,
        },
        snap,
      );
    }
  });
}
async function prepare() {
  await run(async () => {
    const snap = fingerprint.value,
      checked = otherDevice.value,
      verifiedHere = verified.value;
    await refresh();
    if (snap !== fingerprint.value || !verifiedHere || !content.value || !policy.value)
      throw Error('PRIVATE_ACCESS_CONTEXT');
    validatePrivateHandover(
      content.value,
      policy.value,
      props.member.memberId,
      successor.value,
      checked,
    );
    await dispatch('beginhand', {
      ...(await actor()),
      departing: props.member.memberId,
      successor: successor.value,
      expires: Math.floor(Date.now() / 1000) + 3600,
    });
  });
}
async function scan() {
  await run(async () => {
    await dispatch('scanhand', { ...(await actor()), limit: 25 });
  });
}
async function accept() {
  await run(async () => {
    const snap = fingerprint.value,
      checked = otherDevice.value,
      verifiedHere = verified.value;
    await refresh();
    const preparation = handover.value;
    if (
      !preparation ||
      preparation.status !== 'ready' ||
      preparation.successor !== props.member.memberId ||
      !verifiedHere ||
      snap !== fingerprint.value ||
      !content.value ||
      !policy.value
    )
      throw Error('PRIVATE_HANDOVER_REQUIRED');
    validatePrivateHandover(
      content.value,
      policy.value,
      preparation.departing,
      preparation.successor,
      checked,
    );
    await dispatch('accepthand', {
      ...(await actor()),
      expected_commitment: preparation.commitment,
    });
  });
}
async function confirm() {
  await run(async () => {
    const checked = otherDevice.value,
      verifiedHere = verified.value,
      snap = fingerprint.value;
    await refresh();
    const preparation = handover.value;
    if (
      !preparation?.accepted ||
      preparation.status !== 'ready' ||
      preparation.departing !== props.member.memberId ||
      !verifiedHere ||
      snap !== fingerprint.value ||
      !content.value ||
      !policy.value
    )
      throw Error('PRIVATE_HANDOVER_REQUIRED');
    validatePrivateHandover(
      content.value,
      policy.value,
      preparation.departing,
      preparation.successor,
      checked,
    );
    emit('reviewed', preparation.commitment);
  });
}
</script>
<template>
  <section class="handover-panel" :aria-busy="busy">
    <h3>Private administrator handover</h3>
    <p>
      Recorded grants, successful decryption and recovery on another device are separate checks.
    </p>
    <button :disabled="busy" @click="run(refresh)">Load current private handover</button>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <template v-if="content && policy">
      <p>
        Native preparation: {{ handover?.status ?? 'not prepared' }} · successor acceptance:
        {{ handover?.accepted ? 'recorded' : 'pending' }} · decryption on this device:
        {{ verified ? 'verified' : 'pending' }}
      </p>
      <label v-if="!isSuccessor"
        >Successor administrator<select v-model="successor">
          <option value="">Choose an existing administrator</option>
          <option v-for="person in candidates" :key="person.id" :value="person.id">
            Member {{ person.id }}
          </option>
        </select></label
      >
      <p v-if="policy.historyPolicy === 'from-join'">
        A successor cannot receive earlier history forbidden by their join policy. Choose an
        eligible existing administrator.
      </p>
      <button :disabled="busy || !vaultUnlocked" @click="verify">
        Verify my permitted private history
      </button>
      <button
        v-if="successor && !isSuccessor"
        :disabled="busy || !vaultUnlocked || !pendingGrants.length"
        @click="grantBatch"
      >
        Sign up to 20 permitted missing grants ({{ pendingGrants.length }} remaining)
      </button>
      <label
        ><input v-model="otherDevice" type="checkbox" :disabled="busy || !verified" />I verified the
        original keys and private history on another device and saved recovery credentials.</label
      >
      <template v-if="!isSuccessor"
        ><button :disabled="busy || !verified || !otherDevice || !successor" @click="prepare">
          Sign handover preparation</button
        ><button :disabled="busy || handover?.status !== 'pending'" @click="scan">
          Sign scan of up to 25 epochs</button
        ><button
          :disabled="busy || !handover?.accepted || !verified || !otherDevice"
          @click="confirm"
        >
          Confirm reviewed handover for departure
        </button></template
      >
      <button
        v-else
        :disabled="
          busy || handover?.status !== 'ready' || handover.accepted || !verified || !otherDevice
        "
        @click="accept"
      >
        Sign successor acceptance
      </button>
    </template>
  </section>
</template>
<style scoped>
.handover-panel {
  border-top: 1px solid var(--border);
  margin-top: 1rem;
  padding-top: 1rem;
}
.handover-panel label {
  display: block;
  margin-block: 0.7rem;
}
.handover-panel select {
  display: block;
  max-width: 100%;
  margin-top: 0.4rem;
}
.handover-panel button {
  margin: 0.25rem 0.4rem 0.25rem 0;
}
</style>
