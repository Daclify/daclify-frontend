<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { z } from 'zod';
import { ApiRoutes, daoPaymentKey, type McpGrantSchema } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { canSignMember } from '../auth/action-signer';
import ActionSigner from '../components/ActionSigner.vue';
const route = useRoute(),
  state = useWorkspace(),
  consent = ref<z.infer<typeof ApiRoutes.mcpOAuthConsent.response>>(),
  grants = ref<z.infer<typeof McpGrantSchema>[]>([]),
  selected = ref(''),
  grantId = ref(''),
  nativeScopes = ref<Array<'proposal' | 'vote' | 'review' | 'activity'>>([]),
  busy = ref(false),
  error = ref('');
const member = computed(() =>
    state.memberships.find(
      (value) => value.active && daoPaymentKey(value.dao) + ':' + value.memberId === selected.value,
    ),
  ),
  availableGrants = computed(() =>
    grants.value.filter(
      (value) =>
        member.value &&
        daoPaymentKey(value.dao) === daoPaymentKey(member.value.dao) &&
        value.memberId === member.value.memberId,
    ),
  ),
  grant = computed(() => availableGrants.value.find((value) => value.id === grantId.value)),
  ready = computed(
    () =>
      !!consent.value &&
      !!member.value &&
      canSignMember(member.value) &&
      (consent.value.scopes.some((scope) => scope !== 'daclify:submit') || !!grant.value),
  );
let generation = 0;
watch(
  () => JSON.stringify([route.query.request, state.account?.id, state.network?.chainId]),
  async () => {
    const started = ++generation;
    consent.value = undefined;
    grants.value = [];
    selected.value = '';
    grantId.value = '';
    nativeScopes.value = [];
    error.value = '';
    if (!state.account || typeof route.query.request !== 'string') return;
    try {
      const [value, inventory] = await Promise.all([
        api.mcpOAuthConsent(route.query.request),
        api.mcpGrants(),
      ]);
      if (started !== generation) return;
      consent.value = value;
      grants.value = inventory;
    } catch (cause) {
      if (started === generation) error.value = friendlyError(cause);
    }
  },
  { immediate: true },
);
watch(selected, () => {
  grantId.value = '';
  nativeScopes.value = [];
});
watch(grantId, () => {
  nativeScopes.value = grant.value?.scopes ?? [];
});
onBeforeUnmount(() => generation++);
async function approve() {
  const value = consent.value,
    current = member.value,
    started = generation;
  if (!value || !current || !ready.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await state.refresh();
    if (started !== generation) return;
    if (!member.value?.active || Date.parse(value.expires) <= Date.now())
      throw Error('MCP_CONTEXT_CHANGED');
    const result = await api.mcpOAuthApprove({
      id: value.id,
      dao: current.dao,
      memberId: current.memberId,
      nativeScopes: nativeScopes.value,
      localGrantId: grant.value?.id ?? null,
    });
    if (started !== generation) return;
    const target = new URL(result.redirectUrl),
      registered = new URL(value.redirectUri);
    if (
      target.origin !== registered.origin ||
      target.pathname !== registered.pathname ||
      target.hash ||
      !target.searchParams.get('code')
    )
      throw Error('MCP_CONTEXT_CHANGED');
    window.location.assign(target.toString());
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <div class="page">
    <h1>Connect a hosted AI harness</h1>
    <p v-if="!state.account">
      <RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }"
        >Sign in with your Daclify account</RouterLink
      >
      to review this request.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <section v-if="consent" aria-label="Hosted connection permissions">
      <p>Client {{ consent.clientId }} requests {{ consent.scopes.join(', ') }}.</p>
      <p>
        Approved return address: <span class="identifier">{{ consent.redirectUri }}</span>
      </p>
      <label
        >Community membership<select v-model="selected">
          <option value="">Choose a membership</option>
          <option
            v-for="value in state.memberships.filter((item) => item.active)"
            :key="daoPaymentKey(value.dao) + ':' + value.memberId"
            :value="daoPaymentKey(value.dao) + ':' + value.memberId"
          >
            DAO {{ value.dao.daoId }}, member {{ value.memberId }}
          </option>
        </select></label
      >
      <label v-if="member"
        >Native signing companion<select v-model="grantId">
          <option value="">Read and preview only</option>
          <option v-for="value in availableGrants" :key="value.id" :value="value.id">
            {{ value.scopes.join(', ') }} — session {{ value.sessionId }}
          </option>
        </select></label
      >
      <p v-if="consent.scopes.includes('daclify:submit') && !grant">
        This connection will receive read and preview access only. Signed submission requires an
        approved local companion; connect one through Mini apps and request hosted consent again.
      </p>
      <fieldset v-if="consent.scopes.includes('daclify:prepare')">
        <legend>Permitted preparation</legend>
        <label
          v-for="scope in grant?.scopes ?? (['proposal', 'vote', 'review'] as const)"
          :key="scope"
          ><input v-model="nativeScopes" type="checkbox" :value="scope" />{{ scope }}</label
        >
      </fieldset>
      <p>
        The remote harness receives public community data and scoped instructions. Private keys and
        profile decryption stay with you. Access lasts five minutes; refresh authorization lasts at
        most seven days.
      </p>
      <ActionSigner v-if="member" :member="member" label="hosted connection approval" /><button
        :disabled="busy || !ready"
        @click="approve"
      >
        {{ busy ? 'Approving…' : 'Approve hosted connection' }}
      </button>
    </section>
  </div>
</template>
<style scoped>
.identifier {
  overflow-wrap: anywhere;
}
label {
  display: block;
  margin: 0.75rem 0;
}
select {
  display: block;
  max-width: 100%;
}
</style>
