<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { type DaoClaimView, DaoClaimSetupSchema } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { useWorkspace } from '../state/workspace';
import { selectedSigner } from '../auth/action-signer';
import { canUseVaultKey } from '../auth/session';
import { nativeWallet, connectNative } from '../auth/telos-zero';
import { evmWallet, connectEvm } from '../auth/telos-evm';
import SignInMethods from './SignInMethods.vue';
import GoogleSignIn from './GoogleSignIn.vue';
const props = defineProps<{ request: Parameters<typeof api.daoClaimIssue>[0]['request'] | null }>();
const route = useRoute();
const state = useWorkspace(),
  links = ref<DaoClaimView[]>([]),
  link = ref(''),
  error = ref(''),
  busy = ref(false),
  showSignIn = ref(false);
const approval = ref<'sign-in' | 'vault' | 'native' | 'evm'>('sign-in'),
  expires = ref<string | null>(null);
let generation = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
const context = () =>
  JSON.stringify([
    state.account?.id,
    state.network?.chainId,
    state.network?.runtime,
    resolveApiUrl('/'),
  ]);
const ready = computed(
  () =>
    props.request !== null &&
    DaoClaimSetupSchema.safeParse(props.request).success &&
    (approval.value === 'sign-in'
      ? expires.value !== null
      : approval.value === 'vault'
        ? !!state.account?.signingKey && canUseVaultKey(state.account.signingKey)
        : approval.value === 'native'
          ? !!nativeWallet.value
          : !!evmWallet.value),
);
watch(approval, (method) => {
  if (method !== 'sign-in') selectedSigner.value = method;
});
async function load() {
  const started = ++generation,
    expected = context();
  try {
    const [listed, fresh] = await Promise.all([api.daoClaimList(), api.daoClaimSignInApproval()]);
    if (started !== generation || expected !== context()) return;
    links.value = listed;
    clearTimeout(timer);
    expires.value = fresh.expires && Date.parse(fresh.expires) > Date.now() ? fresh.expires : null;
    if (expires.value)
      timer = setTimeout(
        () => {
          expires.value = null;
        },
        Date.parse(expires.value) - Date.now(),
      );
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  }
}
watch(
  context,
  () => {
    link.value = '';
    links.value = [];
    expires.value = null;
    busy.value = false;
    void load();
  },
  { immediate: true, flush: 'sync' },
);
async function signIn() {
  const expected = state.account?.id;
  showSignIn.value = false;
  await state.refresh();
  if (expected !== state.account?.id) {
    error.value =
      'That sign-in opened another account. Review the setup with the correct executive account.';
    return;
  }
  await load();
}
async function connect() {
  error.value = '';
  busy.value = true;
  try {
    if (approval.value === 'native') await connectNative();
    else await connectEvm(state.network?.environment === 'mainnet' ? 40 : 41);
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function issue() {
  if (!ready.value || !props.request || busy.value) return;
  const expected = context();
  busy.value = true;
  error.value = '';
  link.value = '';
  try {
    const result = await api.daoClaimIssue(
      { request: props.request },
      approval.value === 'sign-in',
    );
    if (expected !== context()) return;
    link.value = new URL('/claim-dao#' + result.token, window.location.origin).toString();
    await load();
  } catch (cause) {
    if (expected === context()) error.value = friendlyError(cause);
  } finally {
    if (expected === context()) busy.value = false;
  }
}
async function revoke(id: string) {
  if (busy.value) return;
  const expected = context();
  busy.value = true;
  error.value = '';
  try {
    await api.daoClaimRevoke(id, approval.value === 'sign-in');
    if (expected === context()) {
      link.value = '';
      await load();
    }
  } catch (cause) {
    if (expected === context()) error.value = friendlyError(cause);
  } finally {
    if (expected === context()) busy.value = false;
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
  } catch {
    error.value = 'Select and copy the invitation address below.';
  }
}
onBeforeUnmount(() => {
  generation++;
  clearTimeout(timer);
});
</script>
<template>
  <section class="claim-issuer" aria-labelledby="claim-issuer-title">
    <h2 id="claim-issuer-title">Prepare this DAO for someone else</h2>
    <p>
      Save this setup as a seven-day invitation. The first person to confirm creates the DAO and
      becomes its sole initial member, administrator and executive. You do not join.
    </p>
    <p v-if="!request || !DaoClaimSetupSchema.safeParse(request).success" class="field-help">
      Choose a valid human or mixed setup to create a claim link.
    </p>
    <label for="claim-approver">Approve invitation with</label>
    <select id="claim-approver" v-model="approval" :disabled="busy">
      <option value="sign-in">Paired sign-in</option>
      <option value="vault">Daclify keys</option>
      <option value="native">Paired native wallet</option>
      <option value="evm">Paired EVM wallet</option>
    </select>
    <template v-if="approval === 'sign-in'">
      <p v-if="expires" class="field-help">
        Your recent paired sign-in can approve this invitation.
      </p>
      <template v-else
        ><p>Sign in again with a method paired to this executive account.</p>
        <button type="button" class="secondary" @click="showSignIn = !showSignIn">
          Sign in to approve invitation
        </button></template
      >
      <template v-if="showSignIn"
        ><SignInMethods mode="enter" @authenticated="signIn" /><GoogleSignIn
          :inert="busy"
          @authenticated="signIn"
      /></template>
    </template>
    <p v-else-if="approval === 'vault' && !ready">
      <RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }"
        >Unlock your Daclify account</RouterLink
      >
      to approve.
    </p>
    <button
      v-else-if="(approval === 'native' || approval === 'evm') && !ready"
      type="button"
      class="secondary"
      :disabled="busy"
      @click="connect"
    >
      Connect paired wallet
    </button>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <button type="button" :disabled="busy || !ready" @click="issue">
      {{ busy ? 'Working…' : 'Create claim link' }}
    </button>
    <div v-if="link" class="issued-link" role="status">
      <label for="issued-claim">Private invitation link · copy now</label
      ><input id="issued-claim" :value="link" readonly /><button
        type="button"
        class="secondary"
        @click="copy"
      >
        Copy claim link
      </button>
      <p>This address is shown once. Share it privately with the intended recipient.</p>
    </div>
    <details v-if="links.length">
      <summary>Your recent invitations</summary>
      <ul>
        <li v-for="item in links" :key="item.id">
          <span
            >{{ item.request?.metadata.title ?? 'Saved invitation' }} · {{ item.state }} · expires
            {{ new Date(item.expiresAt).toLocaleDateString() }}</span
          ><button
            v-if="item.state === 'ready'"
            type="button"
            class="secondary"
            :disabled="busy"
            @click="revoke(item.id)"
          >
            Revoke invitation
          </button>
        </li>
      </ul>
    </details>
    <RouterLink to="/docs/dao-claim-links">Claim-link guide</RouterLink>
  </section>
</template>
<style scoped>
.claim-issuer {
  border-top: 1px solid var(--border);
  margin-top: 1.5rem;
  padding-top: 1.5rem;
}
.claim-issuer h2 {
  font-size: 1.2rem;
}
.issued-link,
.claim-issuer li {
  margin-top: 1rem;
  overflow-wrap: anywhere;
}
</style>
