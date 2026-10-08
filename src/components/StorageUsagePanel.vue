<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ApiRoutes, type DaoRef, type UserMembership } from '@daclify/core-protocol';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{
  dao: DaoRef;
  member: UserMembership;
  revision: string;
  headingLevel?: 2;
}>();
const workspace = useWorkspace();
const usage = ref<z.infer<typeof ApiRoutes.storageUsage.response>>();
const loading = ref(false),
  error = ref('');
let generation = 0;
function megabytes(value: string): string {
  const bytes = BigInt(value);
  if (bytes < 1_000_000n) return `${bytes.toLocaleString()} bytes`;
  const hundredths = bytes / 10_000n;
  return `${(hundredths / 100n).toLocaleString()}.${(hundredths % 100n).toString().padStart(2, '0')} MB`;
}
async function refresh() {
  const request = ++generation;
  usage.value = undefined;
  error.value = '';
  loading.value = true;
  try {
    const result = await api.storageUsage(props.dao);
    if (request === generation) usage.value = result;
  } catch (cause) {
    if (request === generation) error.value = friendlyError(cause);
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      props.dao,
      props.member.memberId,
      props.member.active,
      workspace.account?.id,
      props.revision,
    ]),
  () => {
    if (props.member.active) void refresh();
    else {
      generation++;
      usage.value = undefined;
      error.value = '';
      loading.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>
<template>
  <aside class="notice" aria-labelledby="hosted-storage-heading">
    <component :is="props.headingLevel === 2 ? 'h2' : 'h4'" id="hosted-storage-heading"
      >Hosted storage</component
    >
    <p v-if="loading" role="status">Reading storage usage…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="usage">
      <p>
        {{ megabytes(usage.totalBytes) }} used of {{ megabytes(usage.capacityBytes) }} capacity.
      </p>
      <p class="field-help">
        {{ megabytes(usage.verifiedBytes) }} verified; {{ megabytes(usage.reservedBytes) }} held for
        unfinished uploads. {{ usage.objects }} unique files · {{ usage.references }} references. A
        repeated CID counts once per DAO.
      </p>
      <p class="field-help">
        Encrypted bytes, previous versions and archives share this allowance. 1 MB = 1,000,000
        bytes. Automatic deletion is disabled. Administrators manage approved storage capacity in
        Resources.
      </p>
    </template>
    <button type="button" class="secondary" :disabled="loading" @click="refresh">
      Refresh storage usage
    </button>
    <RouterLink to="/docs/documents">Storage documentation ↗</RouterLink>
    <RouterLink :to="{ path: '/resources', query: { dao: JSON.stringify(props.dao) } }"
      >Manage resources →</RouterLink
    >
  </aside>
</template>
