<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { EvmLinkedCredentialSchema, type Account } from '@daclify/core-protocol';
import { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { useRouter } from 'vue-router';
import { acceptProviderSession, lockVault } from '../auth/session';
import { selectedSigner } from '../auth/action-signer';
import { connectEvm, signEvmMessage, TELOS_EVM, type TelosEvmChainId } from '../auth/telos-evm';
const props = withDefaults(defineProps<{ mode?: 'enter' | 'manage' }>(), { mode: 'manage' }),
  emit = defineEmits<{ authenticated: [account: Account]; busy: [active: boolean] }>();
const router = useRouter();
const state = useWorkspace(),
  chainId = ref<TelosEvmChainId>(41),
  picked = ref(false),
  links = ref<z.infer<typeof EvmLinkedCredentialSchema>[]>([]),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
let disposed = false,
  revision = 0;
watch(busy, (active) => emit('busy', active), { flush: 'sync' });
const context = () => JSON.stringify([props.mode, state.account?.id]);
watch(
  () => state.network?.environment,
  (environment) => {
    if (!picked.value && environment === 'mainnet') chainId.value = 40;
  },
  { immediate: true },
);
watch(context, () => {
  revision++;
  busy.value = false;
  links.value = [];
  error.value = '';
  notice.value = '';
  if (props.mode === 'manage') void load().catch(() => {});
});
async function load() {
  const generation = revision,
    current = context();
  try {
    const result = await api.evmLinks();
    if (!disposed && generation === revision && context() === current) links.value = result.links;
  } catch (cause) {
    if (!disposed && generation === revision) error.value = friendlyError(cause);
    throw cause;
  }
}
onMounted(() => {
  if (props.mode === 'manage') void load().catch(() => {});
});
onUnmounted(() => {
  disposed = true;
  revision++;
  emit('busy', false);
});
async function useWallet() {
  if (
    props.mode === 'manage' &&
    !window.confirm(
      'Pair the selected Telos EVM wallet with this Daclify account? DAO governance requires separate activation; private documents still need encryption keys.',
    )
  )
    return;
  const current = context(),
    generation = revision;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const wallet = await connectEvm(chainId.value);
    if (disposed || context() !== current || generation !== revision)
      throw new Error('WALLET_CONTEXT_CHANGED');
    const purpose = props.mode === 'enter' ? 'login' : 'pair',
      challenge = await api.evmSignInChallenge(purpose, wallet.chainId, wallet.address);
    if (
      challenge.chainId !== wallet.chainId ||
      challenge.address.toLowerCase() !== wallet.address.toLowerCase() ||
      !challenge.message.startsWith(
        `${window.location.origin} wants you to sign in with your Ethereum account:\n`,
      ) ||
      !challenge.message.includes(`\nURI: ${window.location.origin}/account\n`)
    )
      throw new Error('EVM_CHALLENGE_INVALID');
    const signature = await signEvmMessage(challenge.message);
    if (disposed || context() !== current || generation !== revision)
      throw new Error('WALLET_CONTEXT_CHANGED');
    if (purpose === 'login') {
      const result = await api.loginEvm(challenge.id, signature);
      if (disposed || context() !== current || generation !== revision)
        throw new Error('WALLET_CONTEXT_CHANGED');
      selectedSigner.value = 'evm';
      emit('authenticated', acceptProviderSession(result.account, result.csrfToken));
    } else {
      await api.pairEvm(challenge.id, signature);
      if (disposed || context() !== current || generation !== revision)
        throw new Error('WALLET_CONTEXT_CHANGED');
      await load();
      if (disposed || context() !== current || generation !== revision)
        throw new Error('WALLET_CONTEXT_CHANGED');
      notice.value =
        'Wallet paired for sign-in. DAO governance authorization is activated separately in each workspace.';
    }
  } catch (cause) {
    if (!disposed && generation === revision) error.value = friendlyError(cause);
  } finally {
    if (!disposed && generation === revision) busy.value = false;
  }
}
async function remove(chain: TelosEvmChainId) {
  const current = context(),
    generation = revision;
  const link = links.value.find((l) => l.chainId === chain);
  if (
    !link ||
    !window.confirm(
      'Remove sign-in pairing ' +
        link.address +
        '? Its sessions will be revoked. Revoke DAO governance bindings separately.',
    )
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    await api.unlinkEvm(chain);
    if (disposed || generation !== revision || context() !== current)
      throw new Error('WALLET_CONTEXT_CHANGED');
    try {
      links.value = (await api.evmLinks()).links;
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') {
        lockVault();
        await state.refresh();
        await router.replace({ path: '/account', query: { notice: 'signin-removed' } });
        return;
      }
      throw cause;
    }
    if (disposed || generation !== revision || context() !== current)
      throw new Error('WALLET_CONTEXT_CHANGED');
    notice.value =
      'Sign-in pairing removed and its sessions revoked. Remove DAO wallet authorizations separately in each workspace.';
  } catch (cause) {
    if (!disposed && generation === revision) error.value = friendlyError(cause);
  } finally {
    if (!disposed && generation === revision) busy.value = false;
  }
}
async function useControl() {
  const current = context(),
    generation = revision;
  busy.value = true;
  error.value = '';
  try {
    const wallet = await connectEvm(chainId.value);
    if (disposed || generation !== revision || context() !== current)
      throw new Error('WALLET_CONTEXT_CHANGED');
    if (
      !links.value.some(
        (link) =>
          link.controlVerified &&
          link.chainId === wallet.chainId &&
          link.address.toLowerCase() === wallet.address.toLowerCase(),
      )
    )
      throw new Error('EVM_LINKED_REQUIRED');
    selectedSigner.value = 'evm';
    notice.value = 'Paired EVM wallet selected for account-control proofs.';
  } catch (cause) {
    if (!disposed && generation === revision) error.value = friendlyError(cause);
  } finally {
    if (!disposed && generation === revision) busy.value = false;
  }
}
</script>
<template>
  <section :class="mode === 'manage' ? 'panel narrow' : ''" aria-label="Telos EVM sign-in">
    <h2 v-if="mode === 'manage'">Linked accounts</h2>
    <h3 v-else>Telos EVM</h3>
    <p>
      Sign in with a paired Telos EVM wallet or recover its current on-chain DAO access after a
      service failure. Recovery creates no new DAO membership and does not restore decryption keys.
      EOA signing is supported; ERC-1271 contract-wallet signatures are unavailable.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <ul v-if="mode === 'manage' && links.length" class="method-list">
      <li v-for="link in links" :key="link.chainId" class="method-row">
        <span class="evm-link"
          ><strong>{{ TELOS_EVM[link.chainId].name }}</strong
          ><span class="mono wrap">{{ link.address }}</span
          ><span v-if="!link.controlVerified">Pair again to enable secure sign-in.</span></span
        ><button type="button" class="secondary" :disabled="busy" @click="remove(link.chainId)">
          Remove sign-in pairing
        </button>
      </li>
    </ul>
    <form @submit.prevent="useWallet">
      <label for="evm-chain">Telos EVM network</label
      ><select id="evm-chain" v-model.number="chainId" :disabled="busy" @change="picked = true">
        <option :value="40">Telos EVM</option>
        <option :value="41">Telos EVM Testnet</option></select
      ><button :disabled="busy">
        {{
          busy
            ? 'Waiting for wallet…'
            : mode === 'enter'
              ? 'Continue with Telos EVM'
              : 'Pair Telos EVM wallet'
        }}
      </button>
    </form>
    <button
      v-if="mode === 'manage' && links.some((link) => link.controlVerified)"
      type="button"
      class="secondary"
      :disabled="busy"
      @click="useControl"
    >
      Use paired EVM wallet for account control
    </button>
  </section>
</template>
