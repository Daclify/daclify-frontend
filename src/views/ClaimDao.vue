<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  DaoClaimTokenSchema,
  type DaoClaimView,
  type PlatformStatus,
  type CreationMethod,
} from '@daclify/core-protocol';
import { useWorkspace } from '../state/workspace';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { saveClaimDestination, takeClaimDestination } from '../auth/dao-claim-entry';
import { createdDaoLocation } from '../auth/destination';
import Account from './Account.vue';
const state = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const claim = ref<DaoClaimView>(),
  platform = ref<PlatformStatus>(),
  error = ref(''),
  busy = ref(false),
  loading = ref(false);
const method = ref<CreationMethod>('free');
const secret = computed(() => DaoClaimTokenSchema.safeParse(route.hash.slice(1)));
const context = () =>
  JSON.stringify([
    state.account?.id,
    state.network?.chainId,
    state.network?.runtime,
    resolveApiUrl('/'),
  ]);
let generation = 0;
const price = computed(() => platform.value?.chain?.creation?.shared_usd);
const matches = computed(
  () =>
    claim.value?.chainId === state.network?.chainId &&
    claim.value?.runtime === state.network?.runtime,
);
const ready = computed(
  () =>
    !!state.account?.signingKey &&
    secret.value.success &&
    matches.value &&
    !loading.value &&
    !busy.value &&
    (claim.value?.state === 'claiming' ||
      claim.value?.state === 'created' ||
      (claim.value?.state === 'ready' &&
        price.value !== undefined &&
        platform.value?.chain?.sharedAvailable)),
);
const usd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
async function enter() {
  if (!secret.value.success) return;
  try {
    const destination = saveClaimDestination(sessionStorage, secret.value.data, resolveApiUrl('/'));
    await router.push({ path: '/account', query: { returnTo: destination } });
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function confirm() {
  if (!ready.value || !secret.value.success) return;
  const started = ++generation,
    expected = context(),
    token = secret.value.data;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.daoClaimConfirm({ token, method: method.value });
    if (started !== generation || expected !== context()) return;
    if (
      result.network.chainId !== state.network?.chainId ||
      result.network.runtime !== state.network?.runtime
    )
      throw Error('DAO_REFERENCE');
    if (result.state === 'created' && result.founderExecutive && result.dao) {
      const daoId = result.dao.daoId;
      await state.refresh();
      if (expected === context()) await router.replace(createdDaoLocation(daoId));
    } else {
      // Existing immutable payment/resume controls retain the reservation without carrying its secret.
      await router.replace({ path: '/create', query: { order: result.requestId } });
    }
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
watch(
  () => JSON.stringify([route.hash, route.query.resume, context()]),
  async () => {
    const started = ++generation;
    busy.value = false;
    claim.value = undefined;
    platform.value = undefined;
    error.value = '';
    loading.value = true;
    try {
      if (route.query.resume) {
        const token = takeClaimDestination(sessionStorage, route.query.resume, resolveApiUrl('/'));
        if (!token) throw Error('DAO_CLAIM_ENTRY_EXPIRED');
        await router.replace({ path: '/claim-dao', hash: '#' + token });
        return;
      }
      if (!secret.value.success) throw Error('DAO_CLAIM_UNKNOWN');
      const [preview, status] = await Promise.all([
        api.daoClaimPreview(secret.value.data),
        api.platformStatus(),
      ]);
      if (started !== generation) return;
      claim.value = preview;
      platform.value = status;
      method.value = preview.method ?? (status.chain?.creation?.shared_usd === 0 ? 'free' : 'card');
    } catch (cause) {
      if (started === generation) error.value = friendlyError(cause);
    } finally {
      if (started === generation) loading.value = false;
    }
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  generation++;
});
</script>
<template>
  <section class="panel claim-card" aria-labelledby="claim-title" :aria-busy="busy || loading">
    <p class="eyebrow">COMMUNITY INVITATION</p>
    <h1 id="claim-title">{{ claim?.request?.metadata.title ?? 'Claim your DAO' }}</h1>
    <p v-if="loading" role="status">Loading the invitation…</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <template v-if="claim">
      <p v-if="claim.request?.metadata.description">{{ claim.request.metadata.description }}</p>
      <dl class="fact-list">
        <dt>Setup</dt>
        <dd>
          {{ claim.request?.setup?.presetId }} · {{ claim.request?.setup?.participantMode }} ·
          Shared hosting
        </dd>
        <dt>Initial roles</dt>
        <dd>
          You are the sole initial member, administrator and executive. The issuer does not join.
        </dd>
        <dt>Document privacy</dt>
        <dd>
          {{
            claim.request?.privacy === 'public'
              ? 'Public documents'
              : claim.request?.privacy === 'encrypted-user-controlled'
                ? 'Encrypted · own keys required'
                : claim.request?.privacy === 'encrypted-managed-allowed'
                  ? 'Encrypted · managed recovery allowed'
                  : 'Saved in your order'
          }}
        </dd>
        <dt>Network</dt>
        <dd>{{ state.network?.environment }} · {{ claim.runtime }}</dd>
        <dt>Invitation expires</dt>
        <dd>{{ new Date(claim.expiresAt).toLocaleString() }}</dd>
        <dt>Creation cost</dt>
        <dd>
          {{
            claim.method
              ? 'Your reserved order retains its original terms'
              : price === undefined
                ? 'Currently unavailable'
                : usd(price)
          }}{{ price === 0 ? ' · governance slots included' : '' }}
        </dd>
      </dl>
      <details v-if="claim.request">
        <summary>Complete fixed setup</summary>
        <pre>{{ JSON.stringify(claim.request, null, 2) }}</pre>
      </details>
      <p v-if="claim.state === 'revoked' || claim.state === 'expired'">
        This invitation is {{ claim.state }}. Ask its issuer for a new link.
      </p>
      <p v-else-if="!matches">Switch to the invitation’s network before continuing.</p>
      <template v-else>
        <p>Opening this page and signing in do not reserve the invitation.</p>
        <button v-if="!state.account" @click="enter">Sign in or create an account</button>
        <template v-else-if="state.account.signingKey === null">
          <p>Finish this account’s public identity and save its recovery kit before claiming.</p>
          <Account access-setup />
        </template>
        <template v-else>
          <p class="account-reference">
            Claim with account <code>{{ state.account.id }}</code
            >. Your vault can stay locked.
          </p>
          <label v-if="!claim.method && price !== undefined && price > 0" for="claim-payment"
            >Creation payment</label
          >
          <select
            v-if="!claim.method && price !== undefined && price > 0"
            id="claim-payment"
            v-model="method"
            :disabled="busy"
          >
            <option value="card">Card</option>
            <option value="tlos">TLOS</option>
          </select>
          <p v-if="claim.state === 'claiming' || claim.state === 'created'">
            This invitation is reserved. Its original claimant can resume the same order.
          </p>
          <button :disabled="!ready" @click="confirm">
            {{
              busy
                ? 'Checking your claim…'
                : claim.state === 'ready'
                  ? 'Claim and create DAO'
                  : 'Resume my claim'
            }}
          </button>
        </template>
      </template>
      <p class="field-help">
        Public governance remains visible. Private documents follow your chosen access policy.
        <RouterLink to="/docs/dao-claim-links">Claim guide</RouterLink>
      </p>
    </template>
  </section>
</template>
<style scoped>
.claim-card {
  max-width: 36rem;
  margin: 2rem auto;
  padding: 1.5rem;
}
.claim-card h1 {
  font-size: 1.5rem;
}
.claim-card button {
  width: 100%;
  margin-top: 0.75rem;
}
.claim-card pre,
.account-reference {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.claim-card .fact-list {
  grid-template-columns: 7.5rem minmax(0, 1fr);
  gap: 0.5rem;
}
.claim-card dd {
  margin: 0;
}
@media (max-width: 32rem) {
  .claim-card {
    padding: 1.1rem;
    margin: 1rem auto;
  }
  .claim-card .fact-list {
    grid-template-columns: 6.5rem minmax(0, 1fr);
    gap: 0.4rem;
    font-size: 0.9rem;
  }
}
</style>
