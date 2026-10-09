<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const router = useRouter(),
  state = useWorkspace(),
  error = ref(''),
  unlinked = ref(false);
let generation = 0,
  disposed = false;
async function resolve() {
  const request = ++generation;
  error.value = '';
  unlinked.value = false;
  try {
    const status = await api.platformStatus();
    if (disposed || request !== generation) return;
    const dao = status.chain?.platformDao;
    if (!dao) {
      unlinked.value = true;
      return;
    }
    if (dao.chainId !== state.network?.chainId || dao.contract !== state.network.runtime)
      throw new Error('NETWORK_MISMATCH');
    await router.replace(`/dao/${dao.daoId}`);
  } catch (cause) {
    if (!disposed && request === generation) error.value = friendlyError(cause);
  }
}
watch(
  () => JSON.stringify([state.network?.chainId, state.network?.runtime]),
  () => {
    if (state.network) void resolve();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
</script>
<template>
  <section class="panel narrow">
    <h1>Daclify DAO</h1>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="unlinked">
      The platform operator has not linked a Daclify DAO on this network yet.
    </p>
    <p v-else role="status">Opening the DAO workspace…</p>
    <button v-if="error" class="secondary" @click="resolve">Retry</button
    ><RouterLink class="help-link" to="/status">Platform status ↗</RouterLink>
  </section>
</template>
