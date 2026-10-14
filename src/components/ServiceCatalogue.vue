<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { Checksum256 } from '@wharfkit/antelope';
import { ServiceOfferDocumentSchema } from '@daclify/modules';
import {
  daoPaymentKey,
  type DaoContent,
  type DaoRef,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { relayInstruction, encryptDaoJson, decryptDaoJson, vaultUnlocked } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { newDocumentId } from '../content/document-identity';
import { serviceOfferValue } from '../content/service-offer';
import WorkspaceDialog from './WorkspaceDialog.vue';
const props = defineProps<{
    content: DaoContent | undefined;
    dao: DaoRef;
    privacy: DaoSummary['privacy'];
    keyEpoch: string;
    member: UserMembership | undefined;
    canPropose: boolean;
    memberLabels?: Record<string, string>;
  }>(),
  emit = defineEmits<{ choose: [member: string]; updated: [] }>();
const query = ref('');
const workspace = useWorkspace(),
  open = ref(false),
  title = ref(''),
  summary = ref(''),
  skills = ref(''),
  error = ref(''),
  notice = ref(''),
  busy = ref(false);
const privateOffers = ref(new Map<string, string>()),
  privateOffset = ref(0),
  privateBusy = ref(false);
const privateDao = computed(() => props.privacy !== 'public');
const signerReady = computed(() => canSignMember(props.member));
const context = computed(
  () =>
    daoPaymentKey(props.dao) +
    ':' +
    workspace.account?.id +
    ':' +
    props.member?.memberId +
    ':' +
    props.member?.signingKey +
    ':' +
    props.privacy +
    ':' +
    props.keyEpoch,
);
let disposed = false,
  generation = 0;
onBeforeUnmount(() => {
  disposed = true;
  privateOffers.value.clear();
});
watch(context, () => {
  generation++;
  busy.value = false;
  privateBusy.value = false;
  title.value = '';
  summary.value = '';
  skills.value = '';
  error.value = '';
  notice.value = '';
  open.value = false;
  privateOffers.value.clear();
  privateOffset.value = 0;
});
watch(vaultUnlocked, (unlocked) => {
  if (!unlocked) {
    if (privateDao.value) {
      generation++;
      busy.value = false;
    }
    privateBusy.value = false;
    privateOffers.value.clear();
    privateOffset.value = 0;
  }
});
async function publish() {
  const member = props.member,
    records = props.content,
    domain = context.value,
    started = generation;
  if (
    !member?.active ||
    !records ||
    !signerReady.value ||
    busy.value ||
    (privateDao.value && !vaultUnlocked.value)
  )
    return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const id = newDocumentId(records.documents),
      plain = serviceOfferValue({
        dao: props.dao,
        memberId: member.memberId,
        title: title.value,
        summary: summary.value,
        skills: skills.value,
      });
    const value = privateDao.value
      ? await encryptDaoJson(props.dao, member.memberId, id, 1, props.keyEpoch, records, plain)
      : plain;
    if (new TextEncoder().encode(value).length > 4096) throw new Error('SERVICE_OFFER_SIZE');
    if (
      disposed ||
      domain !== context.value ||
      started !== generation ||
      !signerReady.value ||
      (privateDao.value && !vaultUnlocked.value)
    )
      return;
    await relayInstruction(
      makeInstruction(
        props.dao,
        member.memberId,
        member.nonce,
        Math.floor(Date.now() / 1000) + 300,
        props.dao.contract,
        'putjson',
        encodeAction('putjson', {
          runtime: props.dao.contract,
          dao_id: props.dao.daoId,
          member_id: member.memberId,
          document_id: id,
          version: 1,
          value,
          envelope_version: privateDao.value ? 1 : 0,
          key_epoch: privateDao.value ? props.keyEpoch : '0',
        }),
      ),
    );
    if (disposed || domain !== context.value || started !== generation) return;
    await workspace.refresh();
    emit('updated');
    title.value = '';
    summary.value = '';
    skills.value = '';
    open.value = false;
    notice.value = 'Service offer published.';
  } catch (cause) {
    if (!disposed && domain === context.value && started === generation)
      error.value = friendlyError(cause);
  } finally {
    if (!disposed && domain === context.value && started === generation) busy.value = false;
  }
}
async function readPrivateOffers() {
  const records = props.content,
    member = props.member,
    domain = context.value,
    started = generation;
  if (!records || !member?.active || !vaultUnlocked.value || privateBusy.value) return;
  privateBusy.value = true;
  error.value = '';
  const documents = records.documents.filter((row) => !row.cid && row.envelope_version === 1);
  try {
    for (const doc of documents.slice(privateOffset.value, privateOffset.value + 25)) {
      try {
        const plain = await decryptDaoJson(props.dao, member.memberId, doc, records);
        if (disposed || domain !== context.value || started !== generation || !vaultUnlocked.value)
          return;
        const offer = ServiceOfferDocumentSchema.safeParse(JSON.parse(plain));
        if (
          offer.success &&
          offer.data.memberId === doc.author &&
          daoPaymentKey(offer.data.dao) === daoPaymentKey(props.dao)
        )
          privateOffers.value.set(doc.id, plain);
      } catch {
        /* Documents without granted keys remain unavailable. */
      }
    }
    if (!disposed && domain === context.value && started === generation && vaultUnlocked.value)
      privateOffset.value = Math.min(privateOffset.value + 25, documents.length);
  } finally {
    if (!disposed && domain === context.value && started === generation) privateBusy.value = false;
  }
}
const offers = computed(() => {
  const latest = new Map<string, NonNullable<typeof props.content>['documents'][number]>();
  for (const doc of props.content?.documents ?? [])
    if (!latest.has(doc.document_id) || doc.version > (latest.get(doc.document_id)?.version ?? 0))
      latest.set(doc.document_id, doc);
  return [...latest.values()].flatMap((doc) => {
    if (doc.cid || (doc.envelope_version !== 0 && !privateOffers.value.has(doc.id))) return [];
    if (
      doc.envelope_version === 0 &&
      Checksum256.hash(new TextEncoder().encode(doc.metadata)).toString() !== doc.commitment
    )
      return [];
    let raw: unknown;
    try {
      raw = JSON.parse(privateOffers.value.get(doc.id) ?? doc.metadata);
    } catch {
      return [];
    }
    const result = ServiceOfferDocumentSchema.safeParse(raw);
    if (
      !result.success ||
      result.data.memberId !== doc.author ||
      JSON.stringify(result.data.dao) !== JSON.stringify(props.dao) ||
      !props.content?.members.some((m) => m.id === doc.author && m.active)
    )
      return [];
    const offer = result.data;
    return `${offer.title} ${offer.summary} ${offer.skills.join(' ')}`
      .toLocaleLowerCase()
      .includes(query.value.toLocaleLowerCase())
      ? [{ ...offer, document: doc.document_id }]
      : [];
  });
});
</script>
<template>
  <section class="panel" aria-label="Member services">
    <p>
      Member services are a directory of skills and offers. A work proposal is a specific project
      with agreed deliverables and milestone payments. Choose a provider here, then propose the work
      and request funding separately.
    </p>
    <label for="service-search">Search member services</label
    ><input id="service-search" v-model="query" type="search" />
    <button type="button" :disabled="!member?.active || busy" @click="open = true">
      Offer a service
    </button>
    <button
      v-if="privateDao && member?.active"
      type="button"
      class="secondary"
      :disabled="
        !vaultUnlocked ||
        privateBusy ||
        privateOffset >=
          (content?.documents.filter((row) => !row.cid && row.envelope_version === 1).length ?? 0)
      "
      @click="readPrivateOffers"
    >
      Read encrypted offers {{ privateOffset ? '(next 25)' : '' }}
    </button>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error && !open" class="alert" role="alert">{{ error }}</p>
    <WorkspaceDialog v-model:open="open" title="Offer a service" :busy="busy">
      <form @submit.prevent="publish">
        <p>
          {{
            privateDao
              ? 'This offer is encrypted for members with document access.'
              : 'This offer will be public on chain.'
          }}
        </p>
        <label>Service name<input v-model="title" maxlength="160" required /></label>
        <label>What you offer<textarea v-model="summary" maxlength="1000" required /></label>
        <label
          >Skills (one per line)<textarea v-model="skills" placeholder="Pruning&#10;Watering" />
        </label>
        <p v-if="!signerReady" class="field-help">Choose an enabled approval method to publish.</p>
        <p v-if="privateDao && !vaultUnlocked" class="field-help">
          Unlock your account keys to encrypt this offer.
        </p>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <div class="button-row">
          <button
            :disabled="
              busy ||
              !signerReady ||
              !title.trim() ||
              !summary.trim() ||
              (privateDao && !vaultUnlocked)
            "
          >
            {{ busy ? 'Publishing…' : 'Publish offer' }}</button
          ><button type="button" class="secondary" :disabled="busy" @click="open = false">
            Cancel
          </button>
        </div>
      </form>
    </WorkspaceDialog>
    <p v-if="!offers.length" class="muted">
      No matching offers. Encrypted offers require your granted document keys.
    </p>
    <article v-for="offer in offers" :key="offer.document">
      <h2>{{ offer.title }}</h2>
      <p>{{ offer.summary }}</p>
      <p>
        {{ memberLabels?.[offer.memberId] ?? `Member ${offer.memberId}` }} ·
        {{ offer.skills.join(', ') }}
      </p>
      <button
        type="button"
        class="secondary"
        :disabled="!canPropose"
        @click="emit('choose', offer.memberId)"
      >
        Propose work with this member
      </button>
    </article>
    <RouterLink to="/docs/contribution-agreements" class="help-link"
      >Agreement and service templates ↗</RouterLink
    >
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
}
article {
  padding-block: 20px;
  border-bottom: 1px solid var(--border-default);
}
</style>
