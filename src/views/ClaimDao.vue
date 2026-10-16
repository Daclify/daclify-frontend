<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  DaoRefSchema,
  type PrivateRecordPayload,
  type PrivateFounderSetup,
  type DaoClaimView,
  type PlatformStatus,
  type CreationMethod,
  type CreationOrderView,
} from '@daclify/core-protocol';
import { useWorkspace } from '../state/workspace';
import { api, ApiFailure, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import {
  parseClaimFragment,
  saveClaimDestination,
  takeClaimDestination,
} from '../auth/dao-claim-entry';
import {
  openPrivateInvitation,
  openPrivateFounder,
  resealPrivateInvitation,
} from '../content/private-identity-setup';
import { vaultUnlocked } from '../auth/session';
import { createdDaoLocation } from '../auth/destination';
import Account from './Account.vue';
const state = useWorkspace(),
  route = useRoute(),
  router = useRouter();
const claim = ref<DaoClaimView>(),
  platform = ref<PlatformStatus>(),
  error = ref(''),
  busy = ref(false),
  unconfirmed = ref(false),
  loading = ref(false);
const method = ref<CreationMethod>('free');
const privateIdentity = ref<Extract<PrivateRecordPayload, { kind: 'dao-identity' }>>();
let sealedFounder: { context: string; setup: PrivateFounderSetup } | undefined;
const secret = computed(() => {
  try {
    const value = parseClaimFragment(route.hash.slice(1));
    return { success: true as const, data: value.token, contentKey: value.contentKey };
  } catch {
    return { success: false as const };
  }
});
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
    (!claim.value?.request?.privateSetup || (!!privateIdentity.value && vaultUnlocked.value)) &&
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
    const destination = saveClaimDestination(
      sessionStorage,
      route.hash.slice(1),
      resolveApiUrl('/'),
    );
    await router.replace({
      path: '/account',
      query: { returnTo: destination, ...(state.account ? { unlock: '1' } : {}) },
    });
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function confirm() {
  if (!ready.value || !secret.value.success || !claim.value) return;
  const started = ++generation,
    expected = context(),
    token = secret.value.data,
    id = claim.value.id,
    resume = unconfirmed.value || claim.value.state !== 'ready';
  const current = () => started === generation && expected === context();
  busy.value = true;
  unconfirmed.value = false;
  error.value = '';
  async function accept(result: CreationOrderView) {
    if (!current()) return;
    if (
      result.requestId !== id ||
      result.network.chainId !== state.network?.chainId ||
      result.network.runtime !== state.network?.runtime ||
      (result.dao &&
        (result.dao.chainId !== result.network.chainId ||
          result.dao.contract !== result.network.runtime))
    )
      throw new ApiFailure('DAO_REFERENCE');
    if (result.state === 'created') {
      if (!result.founderExecutive || !result.dao) throw new ApiFailure('DAO_CLAIM_PENDING');
      if (result.setup.privateSetup) {
        await router.replace({ path: '/create', query: { order: result.requestId } });
        return;
      }
      const daoId = result.dao.daoId;
      await state.refresh();
      if (current()) await router.replace(createdDaoLocation(daoId));
    } else {
      // Existing immutable payment/resume controls retain the reservation without carrying its secret.
      await router.replace({ path: '/create', query: { order: result.requestId } });
    }
  }
  const interrupted = (cause: unknown) =>
    cause instanceof TypeError ||
    cause instanceof SyntaxError ||
    (cause instanceof DOMException && ['TimeoutError', 'AbortError'].includes(cause.name)) ||
    (cause instanceof ApiFailure &&
      ['SERVICE_UNAVAILABLE', 'DAO_CLAIM_PENDING', 'CREATION_ORDER_PENDING'].includes(cause.code));
  try {
    let result: CreationOrderView | undefined;
    if (resume) {
      try {
        result = await api.creationOrderStatus(id);
      } catch (cause) {
        if (!(cause instanceof ApiFailure && cause.code === 'CREATION_ORDER_UNKNOWN')) throw cause;
      }
    }
    if (!current()) return;
    let privateSetup: PrivateFounderSetup | undefined;
    const draft = claim.value?.request?.privateSetup;
    if (!result && draft?.stage === 'invitation') {
      const contentKey = secret.value.success ? secret.value.contentKey : undefined;
      if (!contentKey) throw Error('PRIVATE_INVITATION_REQUIRED');
      if (sealedFounder?.context !== expected) {
        const dao = DaoRefSchema.parse({
          chainId: claim.value.chainId,
          contract: claim.value.runtime,
          daoId: draft.daoId,
          interfaceVersion: 1,
        });
        const request = claim.value.request;
        if (!request) throw Error('PRIVATE_INVITATION_REQUIRED');
        const setup = await resealPrivateInvitation(dao, draft, contentKey, request);
        if (!current()) return;
        sealedFounder = { context: expected, setup };
      }
      privateSetup = sealedFounder.setup;
    }
    result ??= await api.daoClaimConfirm({
      token,
      method: method.value,
      ...(privateSetup ? { privateSetup } : {}),
    });
    await accept(result);
  } catch (cause) {
    if (!current()) return;
    if (!interrupted(cause)) {
      error.value = friendlyError(cause);
      return;
    }
    // A lost HTTP response cannot establish whether the native transaction succeeded.
    unconfirmed.value = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!current()) return;
      try {
        await accept(await api.creationOrderStatus(id));
        return;
      } catch (statusError) {
        if (!current()) return;
        if (
          !interrupted(statusError) &&
          !(statusError instanceof ApiFailure && statusError.code === 'CREATION_ORDER_UNKNOWN')
        ) {
          unconfirmed.value = false;
          error.value = friendlyError(statusError);
          return;
        }
      }
    }
  } finally {
    if (started === generation) busy.value = false;
  }
}
watch(
  () => JSON.stringify([route.hash, route.query.resume, context(), vaultUnlocked.value]),
  async () => {
    const started = ++generation;
    busy.value = false;
    unconfirmed.value = false;
    claim.value = undefined;
    privateIdentity.value = undefined;
    if (!vaultUnlocked.value || sealedFounder?.context !== context()) sealedFounder = undefined;
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
      const setup = preview.request?.privateSetup;
      if (setup) {
        const dao = DaoRefSchema.parse({
          chainId: preview.chainId,
          contract: preview.runtime,
          daoId: setup.daoId,
          interfaceVersion: 1,
        });
        const contentKey = secret.value.success ? secret.value.contentKey : undefined;
        const request = preview.request;
        if (!request) throw Error('PRIVATE_INVITATION_REQUIRED');
        const opened =
          setup.stage === 'invitation' && contentKey
            ? await openPrivateInvitation(dao, setup, contentKey, request)
            : setup.stage === 'founder' && vaultUnlocked.value
              ? await openPrivateFounder(dao, setup, request)
              : undefined;
        if (started !== generation) return;
        privateIdentity.value = opened;
        if (!opened && setup.stage === 'invitation') throw Error('PRIVATE_INVITATION_REQUIRED');
      }
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
    <h1 id="claim-title">
      {{ privateIdentity?.body.title ?? claim?.request?.metadata.title ?? 'Claim your DAO' }}
    </h1>
    <p v-if="loading" role="status">Loading the invitation…</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="unconfirmed" role="status">
      {{
        busy
          ? 'The response was interrupted. Checking your saved claim…'
          : 'Creation may still be in progress. Resume this claim to check its saved result.'
      }}
    </p>
    <template v-if="claim">
      <p v-if="privateIdentity?.body.description || claim.request?.metadata.description">
        {{ privateIdentity?.body.description ?? claim.request?.metadata.description }}
      </p>
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
            >.
            {{
              claim.request?.privateSetup
                ? 'Your original account keys protect this private setup.'
                : 'Your vault can stay locked.'
            }}
          </p>
          <template v-if="claim.request?.privateSetup && !vaultUnlocked">
            <p>
              Unlock with a paired method that has full access, your own device or your recovery
              kit. Sign-in alone cannot decrypt your keys.
            </p>
            <button type="button" class="secondary" @click="enter">Unlock account to claim</button>
          </template>
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
                : claim.state === 'ready' && !unconfirmed
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
