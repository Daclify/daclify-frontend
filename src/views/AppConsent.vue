<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { z } from 'zod';
import { daoPaymentKey, appConfigurationHash, ApiRoutes } from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { invitationCredential, makeAppJoinProof, signAppInvitation } from '@daclify/core-protocol/connected-apps';
import { api, friendlyError, ApiFailure } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import ActionSigner from '../components/ActionSigner.vue';
import { appSignInMethod, appJoinDestination, appInvitation } from '../auth/app-entry';
const route = useRoute(),
  state = useWorkspace(),
  consent = ref<z.infer<typeof ApiRoutes.appConsent.response>>(),
  error = ref(''),
  busy = ref(false),
  joinRequired = ref(false),
  admission = ref<z.infer<typeof ApiRoutes.appJoinPreview.response>>(),
  reload = ref(0),
  approvedSession = ref<string>();
const requestId = computed(() =>
    typeof route.query.request === 'string' ? route.query.request : '',
  ),
  member = computed(() =>
    state.memberships.find(
      (member) =>
        consent.value &&
        member.memberId === consent.value.member.memberId &&
        daoPaymentKey(member.dao) === daoPaymentKey(consent.value.member.dao),
    ),
  ),
  ready = computed(
    () => !!member.value?.active && (!consent.value?.signingKey || canSignMember(member.value)),
  );
const preferredMethod = computed(() =>
  appSignInMethod(new URLSearchParams(route.hash.slice(1)).get('daclify_method')),
);
let generation = 0;
const context = computed(() =>
  JSON.stringify([
    requestId.value,
    route.hash,
    reload.value,
    state.account?.id,
    state.network?.chainId,
    state.network?.runtime,
  ]),
);
watch(
  context,
  async () => {
    const started = ++generation;
    consent.value = undefined;
    admission.value = undefined;
    approvedSession.value = undefined;
    error.value = '';
    busy.value = false;
    joinRequired.value = false;
    if (!state.account || !requestId.value) return;
    try {
      const invite=appInvitation(route.hash);
      const preview=await api.appJoinPreview(requestId.value,invite?{invitationId:invite.invitationId,tokenHash:invitationCredential(invite.token).tokenHash}:{});
      if(started!==generation)return;
      if(preview.app.config.dao.chainId!==state.network?.chainId||preview.app.config.dao.contract!==state.network.runtime)throw new Error('DAO_REFERENCE');
      admission.value=preview;
      if(invite||!preview.member){joinRequired.value=true;return;}
      const value = await api.appConsent(requestId.value);
      if (started !== generation) return;
      if (
        value.app.configHash !== appConfigurationHash(value.app.config) ||
        !value.app.native ||
        value.app.native.config_hash !== value.app.configHash ||
        value.member.dao.chainId !== state.network?.chainId ||
        value.member.dao.contract !== state.network.runtime
      )
        throw new Error('APP_REVISED');
      consent.value = value;
    } catch (cause) {
      if (started === generation) {
        error.value = friendlyError(cause);
        joinRequired.value = cause instanceof ApiFailure && cause.code === 'MEMBERSHIP_REQUIRED';
      }
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
async function declineJoin(){try{window.location.assign((await api.rejectApp(requestId.value)).redirect);}catch(cause){error.value=friendlyError(cause);}}
async function join() {
 const started=generation, value=admission.value,account=state.account;
 if(!value||!account||busy.value||!value.available)return;
 busy.value=true;error.value='';
 try {
  const invite=appInvitation(route.hash);
  if(invite){
   if(!value.source)throw new Error('APP_JOIN_UNAVAILABLE');
   const proof=makeAppJoinProof(value.app.config,account,value.source,invite.invitationId,invitationCredential(invite.token).tokenHash);
   await api.joinApp(requestId.value,{invitationId:invite.invitationId,tokenHash:proof.token_hash,proofExpires:proof.expires,signature:signAppInvitation(invite.token,proof)});
  } else await api.joinApp(requestId.value,{});
  await state.refresh();
  const next=await api.appConsent(requestId.value);
  if(started!==generation)return;
  consent.value=next;joinRequired.value=false;admission.value=undefined;
 }catch(cause){if(started===generation)error.value=friendlyError(cause);}
 finally{if(started===generation)busy.value=false;}
}
async function decide(approve: boolean) {
  const value = consent.value,
    started = generation;
  if (!value || !state.account || busy.value || (!ready.value && approve)) return;
  busy.value = true;
  error.value = '';
  try {
    if (!approve) {
      const result = await api.rejectApp(value.id);
      if (started === generation) window.location.assign(result.redirect);
      return;
    }
    await state.refresh();
    if (started !== generation) return;
    const current = state.memberships.find(
      (member) =>
        member.memberId === value.member.memberId &&
        daoPaymentKey(member.dao) === daoPaymentKey(value.member.dao),
    );
    if (!current?.active) throw new Error('MEMBERSHIP_REQUIRED');
    if (value.signingKey && approvedSession.value) {
      try {
        const result = await api.approveApp(value.id, approvedSession.value);
        if (started === generation) window.location.assign(result.redirect);
        return;
      } catch (cause) {
        if (!(cause instanceof ApiFailure) || cause.code !== 'APP_GRANT_REQUIRED') throw cause;
        approvedSession.value = undefined;
      }
    }
    if (value.signingKey && !approvedSession.value) {
      if (!value.grantExpires || value.grantExpires <= Date.now() / 1000)
        throw new Error('APP_REQUEST_EXPIRED');
      const bytes = crypto.getRandomValues(new Uint8Array(8)),
        id = bytes.reduce((sum, byte) => (sum << 8n) | BigInt(byte), 0n) || 1n;
      approvedSession.value = id.toString();
      await relayInstruction(
        makeInstruction(
          current.dao,
          current.memberId,
          current.nonce,
          Math.floor(Date.now() / 1000) + 120,
          current.dao.contract,
          'addappses',
          encodeAction('addappses', {
            runtime: current.dao.contract,
            dao_id: current.dao.daoId,
            member_id: current.memberId,
            app_id: value.app.config.appId,
            app_revision: value.app.config.revision,
            session_id: id.toString(),
            signing_key: value.signingKey,
            expires: value.grantExpires,
          }),
        ),
      );
    }
    if (started !== generation) return;
    const result = await api.approveApp(value.id, approvedSession.value);
    if (started === generation) window.location.assign(result.redirect);
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <section class="panel consent-panel">
    <p class="eyebrow">CONNECTED COMMUNITY APP</p>
    <h1>App access</h1>
    <template v-if="!state.account"
      ><p>Sign in with your Daclify account to check your DAO membership.</p>
      <RouterLink
        class="button"
        :to="{ path: '/account', query: { returnTo: route.fullPath, method: preferredMethod } }"
        >Sign in</RouterLink
      ></template
    >
    <template v-else-if="consent"
      ><h2>{{ consent.app.config.name }}</h2>
      <p>
        This app will receive your member identity and current administrator or reviewer role in DAO
        {{ consent.member.dao.daoId }}.
      </p>
      <dl>
        <dt>App destination</dt>
        <dd class="wrap">{{ consent.app.config.origins.join(', ') }}</dd>
        <dt>Membership</dt>
        <dd>
          Member {{ consent.member.memberId }} ·
          {{
            consent.member.admin ? 'Administrator' : consent.member.reviewer ? 'Reviewer' : 'Member'
          }}
        </dd>
      </dl>
      <template v-if="consent.signingKey"
        ><h3>Allow selected activity recording</h3>
        <p>
          The app can record completions and submit items for review as you until
          {{ new Date((consent.grantExpires ?? 0) * 1000).toLocaleString() }}. Approval replaces
          your previous signing grant for this app.
        </p>
        <p>Independent reviews and DAO decisions still use your Daclify signer.</p>
        <ActionSigner :member="member"
      /></template>
      <div class="actions">
        <button :disabled="busy || !ready" @click="decide(true)">
          {{
            busy
              ? 'Approving…'
              : consent.signingKey
                ? 'Approve sign-in and recording'
                : 'Approve sign-in'
          }}</button
        ><button class="secondary" :disabled="busy" @click="decide(false)">Decline</button>
      </div>
    </template>
    <template v-else-if="admission && joinRequired">
      <h2>{{ admission.app.config.name }}</h2>
      <p v-if="admission.invitation?.role==='admin'">This invitation makes you a DAO administrator and executive, with voting eligibility. You can manage members and shared app settings.</p>
      <p v-else-if="admission.member">Your existing DAO membership and permissions will be kept.</p>
      <p v-else>You will join this DAO as a normal member without voting rights. You can use its shared app.</p>
      <p>DAO {{ admission.app.config.dao.daoId }} · {{ admission.app.config.dao.contract }}</p>
      <button v-if="admission.available && (admission.invitation || admission.policy?.public_join || admission.member)" :disabled="busy" @click="join">{{ busy?'Joining…':admission.invitation?.role==='admin'?'Accept administrator invitation':'Join and continue' }}</button>
      <p v-else>App joining is not enabled. Ask this DAO’s administrator to enable it.</p>
      <button class="secondary" :disabled="busy" @click="declineJoin">Decline</button>
    </template>
    <p v-else-if="!error" role="status">Checking membership…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="joinRequired && !admission?.available && appJoinDestination(route.hash, state.network)">
      <p>
        Complete this community's membership steps before opening the app. Its admission rules still
        apply.
      </p>
      <RouterLink
        class="button"
        :to="{
          path: appJoinDestination(route.hash, state.network),
          query: { returnTo: route.fullPath },
        }"
        >Join this community</RouterLink
      >
      <button class="secondary" @click="reload++">Check membership again</button>
    </template>
    <RouterLink to="/docs/connected-apps">How app access works</RouterLink>
  </section>
</template>
<style scoped>
.consent-panel {
  max-width: 44rem;
  margin: 2rem auto;
}
.actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
</style>
