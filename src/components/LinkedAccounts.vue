<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import {
  browserEvmProvider,
  messageHex,
  providerCode,
  TELOS_EVM,
  type TelosEvmChainId,
} from '../auth/telos-evm';

interface LinkedAddress {
  chainId: TelosEvmChainId;
  address: string;
}
const state = useWorkspace();
const chainId = ref<TelosEvmChainId>(41);
const picked = ref(false);
const links = ref<LinkedAddress[]>([]);
const busy = ref(false);
const error = ref('');
const note = ref('');
watch(
  () => state.network?.environment,
  (environment) => {
    if (!picked.value && environment === 'mainnet') chainId.value = 40;
  },
  { immediate: true },
);
function problem(cause: unknown): string {
  if (providerCode(cause) === 4001) return 'The wallet request was cancelled.';
  if (cause instanceof Error && cause.message === 'EVM_WALLET_MISSING') {
    return 'No EVM wallet was found in this browser.';
  }
  if (cause instanceof Error && cause.message === 'EVM_ACCOUNT_UNAVAILABLE') {
    return 'The wallet did not provide a Telos EVM address.';
  }
  return friendlyError(cause);
}
async function load() {
  links.value = (await api.evmLinks()).links;
}
onMounted(() => {
  void load().catch((cause: unknown) => {
    error.value = problem(cause);
  });
});
async function ensureChain(chain: TelosEvmChainId): Promise<void> {
  const provider = browserEvmProvider();
  if (!provider) throw new Error('EVM_WALLET_MISSING');
  const network = TELOS_EVM[chain];
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: network.hex }],
    });
  } catch (cause) {
    if (providerCode(cause) !== 4902) throw cause;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: network.hex,
          chainName: network.name,
          nativeCurrency: { name: 'Telos', symbol: 'TLOS', decimals: 18 },
          rpcUrls: [network.rpc],
          blockExplorerUrls: [network.explorer],
        },
      ],
    });
  }
}
async function link() {
  busy.value = true;
  error.value = '';
  note.value = '';
  try {
    const provider = browserEvmProvider();
    if (!provider) throw new Error('EVM_WALLET_MISSING');
    await ensureChain(chainId.value);
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error('EVM_ACCOUNT_UNAVAILABLE');
    }
    const challenge = await api.evmChallenge(chainId.value);
    const signature = await provider.request({
      method: 'personal_sign',
      params: [messageHex(challenge.message), address],
    });
    if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error('EVM_SIGNATURE_INVALID');
    }
    const linked = await api.linkEvm({ chainId: chainId.value, address, signature });
    links.value = [...links.value.filter((item) => item.chainId !== linked.chainId), linked].sort(
      (left, right) => left.chainId - right.chainId,
    );
    note.value = 'Telos EVM address linked.';
  } catch (cause) {
    error.value = problem(cause);
  } finally {
    busy.value = false;
  }
}
async function unlink(chain: TelosEvmChainId) {
  busy.value = true;
  error.value = '';
  note.value = '';
  try {
    await api.unlinkEvm(chain);
    links.value = links.value.filter((item) => item.chainId !== chain);
    note.value = 'Telos EVM address unlinked.';
  } catch (cause) {
    error.value = problem(cause);
  } finally {
    busy.value = false;
  }
}
function networkName(chain: TelosEvmChainId): string {
  return TELOS_EVM[chain].name;
}
</script>
<template>
  <section class="panel narrow" aria-label="Linked Telos EVM addresses">
    <h2>Linked accounts</h2>
    <p>
      Link a Telos EVM address you control, the same way a Telos account can hold a linked EVM
      address. The signature proves control of that address. It does not unlock the vault, create a
      Telos account, or grant DAO membership.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="note" class="notice" role="status">{{ note }}</p>
    <ul v-if="links.length" class="method-list">
      <li v-for="item in links" :key="item.chainId" class="method-row">
        <span class="evm-link">
          <strong>{{ networkName(item.chainId) }}</strong>
          <span class="mono wrap">{{ item.address }}</span>
        </span>
        <button type="button" class="secondary" :disabled="busy" @click="unlink(item.chainId)">
          Unlink
        </button>
      </li>
    </ul>
    <p v-else class="muted">No Telos EVM address is linked to this account.</p>
    <form @submit.prevent="link">
      <label for="evm-chain">Telos EVM network</label>
      <select id="evm-chain" v-model.number="chainId" :disabled="busy" @change="picked = true">
        <option :value="40">Telos EVM</option>
        <option :value="41">Telos EVM Testnet</option>
      </select>
      <button :disabled="busy">
        {{ busy ? 'Waiting for the wallet…' : 'Link Telos EVM address' }}
      </button>
    </form>
  </section>
</template>
