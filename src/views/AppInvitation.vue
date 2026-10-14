<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import {useRoute} from 'vue-router';
import {z} from 'zod';
import {ApiRoutes,daoPaymentKey} from '@daclify/core-protocol';
import {encodeAppJoin,makeInstruction} from '@daclify/core-protocol/sdk';
import {api,friendlyError} from '../api/client';
import {useWorkspace} from '../state/workspace';
import {relayInstruction} from '../auth/session';
import {canSignMember} from '../auth/action-signer';
import ActionSigner from '../components/ActionSigner.vue';
const route=useRoute(),state=useWorkspace(),details=ref<z.infer<typeof ApiRoutes.appInvitation.response>>(),error=ref(''),busy=ref(false);
const requestId=computed(()=>typeof route.query.request==='string'?route.query.request:''),member=computed(()=>state.memberships.find(row=>details.value&&row.memberId===details.value.inviter&&daoPaymentKey(row.dao)===daoPaymentKey(details.value.app.config.dao)));
let generation=0;
watch(()=>[requestId.value,state.account?.id,state.network?.chainId,state.network?.runtime],async()=>{const started=++generation;details.value=undefined;error.value='';if(!state.account)return;try{const value=await api.appInvitation(requestId.value);if(started===generation)details.value=value;}catch(cause){if(started===generation)error.value=friendlyError(cause);}},{immediate:true});
onBeforeUnmount(()=>generation++);
async function approve(){
 const started=generation,value=details.value;
 if(!value||busy.value)return;busy.value=true;error.value='';
 try{
  await state.refresh();
  if(started!==generation)return;
  const current=member.value;
  if(!current?.active||!current.admin||!canSignMember(current))throw new Error('ADMIN_REQUIRED');
  const admission=await api.appJoinConfiguration(value.app.clientId);
  if(!admission.source||!admission.available)throw new Error('APP_JOIN_UNAVAILABLE');
  const invite=value.invitation,dao=value.app.config.dao;
  await relayInstruction(makeInstruction(dao,current.memberId,current.nonce,Math.floor(Date.now()/1000)+120,admission.source,'appinvite',encodeAppJoin('appinvite',{runtime:dao.contract,dao_id:dao.daoId,member_id:current.memberId,app_id:value.app.config.appId,app_revision:value.app.config.revision,invitation_id:invite.invitationId,token_hash:invite.tokenHash,invitation_key:invite.invitationKey,admin:invite.role==='admin',expires:invite.expires,revoke:invite.revoke})));
  const confirmed=await api.appInvitation(requestId.value);
  if(started!==generation)return;
  details.value=confirmed;
  if(!confirmed.confirmed)throw new Error('APP_JOIN_PENDING');
 }catch(cause){if(started===generation)error.value=friendlyError(cause);}finally{if(started===generation)busy.value=false;}
}
</script>
<template>
<section class="panel">
 <h1>DAO invitation approval</h1>
 <template v-if="!state.account"><p>Sign in with the Daclify account that created this invitation.</p><RouterLink :to="{path:'/account',query:{returnTo:route.fullPath}}">Sign in</RouterLink></template>
 <template v-else-if="details">
  <h2>{{ details.app.config.name }} · {{ details.invitation.name }}</h2>
  <p v-if="details.invitation.role==='admin'">DAO administrator and executive, with voting eligibility. This person can manage members and shared app settings.</p>
  <p v-else>Normal DAO member without voting rights.</p>
  <p>DAO {{ details.app.config.dao.daoId }} · {{ details.app.config.dao.contract }}</p>
  <p>Anyone holding this private link can accept it first with an eligible account. Share administrator links only with the intended person.</p>
  <p>Expires {{ new Date(details.invitation.expires*1000).toLocaleString() }}</p>
  <p v-if="details.confirmed" role="status">{{ details.invitation.revoke?'Invitation revoked.':'Invitation approved.' }} Return to Garden Care and check the invitation.</p>
  <template v-else><ActionSigner :member="member"/><button :disabled="busy||!member?.active||!member.admin||!canSignMember(member)" @click="approve">{{ busy?'Approving…':details.invitation.revoke?'Approve revocation':'Approve invitation' }}</button></template>
 </template>
 <p v-if="error" role="alert">{{ error }}</p>
</section>
</template>
