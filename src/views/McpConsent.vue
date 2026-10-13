<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { z } from 'zod';
import { ApiRoutes, daoPaymentKey } from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import ActionSigner from '../components/ActionSigner.vue';
const route = useRoute(),
  state = useWorkspace(),
  consent = ref<z.infer<typeof ApiRoutes.mcpConsent.response>>(),
  mode = ref<'autonomous' | 'confirm'>('confirm'),
  busy = ref(false),
  error = ref(''),
  approved = ref(false),
  sessionId = ref('');
const requestId = computed(() =>
    typeof route.query.request === 'string' ? route.query.request : '',
  ),
  member = computed(() =>
    state.memberships.find(
      (value) =>
        consent.value &&
        value.active &&
        value.memberId === consent.value.pairing.memberId &&
        daoPaymentKey(value.dao) === daoPaymentKey(consent.value.pairing.dao),
    ),
  ),
  ready = computed(() => !!member.value && canSignMember(member.value));
let generation = 0;
watch(
  () =>
    JSON.stringify([
      requestId.value,
      state.account?.id,
      state.network?.chainId,
      state.network?.runtime,
    ]),
  async () => {
    const started = ++generation;
    consent.value = undefined;
    error.value = '';
    sessionId.value = '';
    approved.value = false;
    busy.value = false;
    if (!state.account || !requestId.value) return;
    try {
      const value = await api.mcpConsent(requestId.value);
      if (started !== generation) return;
      if (
        value.pairing.dao.chainId !== state.network?.chainId ||
        value.pairing.dao.contract !== state.network.runtime ||
        Date.parse(value.pairing.expires) <= Date.now()
      )
        throw Error('MCP_CONTEXT_CHANGED');
      consent.value = value;
    } catch (cause) {
      if (started === generation) error.value = friendlyError(cause);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
async function approve() {
  const value = consent.value,
    started = generation;
  if (!value || busy.value || !ready.value || approved.value) return;
  busy.value = true;
  error.value = '';
  try {
    await state.refresh();
    if (started !== generation) return;
    const current = member.value;
    if (!current?.active || Date.parse(value.pairing.expires) <= Date.now())
      throw Error('MCP_PAIRING_EXPIRED');
    if (!sessionId.value) {
      sessionId.value = (crypto.getRandomValues(new BigUint64Array(1))[0] || 1n).toString();
      const base = {
        runtime: current.dao.contract,
        dao_id: current.dao.daoId,
        member_id: current.memberId,
      };
      const action = value.pairing.app ? 'addappses' : 'addsession';
      const data = value.pairing.app
        ? encodeAction('addappses', {
            ...base,
            app_id: value.pairing.app.appId,
            app_revision: value.pairing.app.revision,
            session_id: sessionId.value,
            signing_key: value.pairing.delegatePublicKey,
            expires: value.grantExpires,
          })
        : encodeAction('addsession', {
            ...base,
            session_id: sessionId.value,
            signing_key: value.pairing.delegatePublicKey,
            expires: value.grantExpires,
            permissions: value.permissions,
          });
      await relayInstruction(
        makeInstruction(
          current.dao,
          current.memberId,
          current.nonce,
          Math.floor(Date.now() / 1000) + 120,
          current.dao.contract,
          action,
          data,
        ),
      );
    }
    if (started !== generation) return;
    await api.mcpApprove({
      id: value.pairing.id,
      dao: value.pairing.dao,
      memberId: value.pairing.memberId,
      scopes: value.pairing.scopes,
      sessionId: sessionId.value,
      mode: mode.value,
    });
    if (started === generation) approved.value = true;
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <div class="page">
    <h1>Connect an AI harness</h1>
    <p v-if="!state.account">
      <RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }"
        >Sign in with your Daclify account</RouterLink
      >
      to review this connection.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <section v-if="consent && !approved" aria-label="Connection permissions">
      <p>
        This local harness requests access as member {{ consent.pairing.memberId }} of DAO
        {{ consent.pairing.dao.daoId }}.
      </p>
      <dl>
        <dt>Network</dt>
        <dd class="identifier">{{ consent.pairing.dao.chainId }}</dd>
        <dt>Runtime</dt>
        <dd>{{ consent.pairing.dao.contract }}</dd>
        <dt>Delegate public key</dt>
        <dd class="identifier">{{ consent.pairing.delegatePublicKey }}</dd>
      </dl>
      <h2>Requested permissions</h2>
      <ul>
        <li v-for="scope in consent.pairing.scopes" :key="scope">{{ scope }}</li>
      </ul>
      <p>
        The delegate expires at {{ new Date(consent.grantExpires * 1000).toLocaleString() }}.
        Daclify checks your current membership and the community’s governance rules on every action.
      </p>
      <fieldset>
        <legend>Local signing</legend>
        <label
          ><input v-model="mode" type="radio" value="confirm" />Ask on my trusted terminal before
          each signature</label
        ><label
          ><input v-model="mode" type="radio" value="autonomous" />Allow the harness to perform
          these scoped actions automatically</label
        >
      </fieldset>
      <p>
        The browser authorizes this new delegate. Keep the harness’s encrypted credential file on a
        trusted host.
      </p>
      <ActionSigner v-if="member" :member="member" label="connection approval" />
      <button :disabled="busy || !ready" @click="approve">
        {{
          busy
            ? 'Approving…'
            : sessionId
              ? 'Retry approval for the existing native grant'
              : 'Approve connection'
        }}
      </button>
      <p v-if="sessionId">
        The existing native grant is reused on retry. If its submission is uncertain, check the
        native session before starting a replacement pairing.
      </p>
    </section>
    <p v-if="approved" role="status">
      Connection approved. Return to your trusted terminal to encrypt the delegate and finish setup.
    </p>
  </div>
</template>
<style scoped>
.identifier {
  overflow-wrap: anywhere;
}
fieldset label {
  display: block;
  margin: 0.5rem 0;
}
dl dd {
  margin-bottom: 1rem;
}
</style>
