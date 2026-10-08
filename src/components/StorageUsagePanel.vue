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
const recovery = ref<z.infer<typeof ApiRoutes.storageRecover.response>>(),
  recoveryKind = ref<z.infer<typeof ApiRoutes.storageRecover.input>['kind']>('document-version');
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
  recovery.value = undefined;
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
async function recover(after = '0') {
  if (!props.member.active || !props.member.admin || loading.value) return;
  const request = ++generation,
    dao = props.dao,
    kind = recoveryKind.value;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.recoverStorage({ dao, kind, after });
    if (request !== generation) return;
    recovery.value = result;
    const current = await api.storageUsage(dao);
    if (request === generation) usage.value = current;
  } catch (cause) {
    if (request === generation) error.value = friendlyError(cause);
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(recoveryKind, () => {
  recovery.value = undefined;
  generation++;
  loading.value = false;
});
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
      recovery.value = undefined;
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
        bytes. Administrators manage approved storage capacity in Resources.
      </p>
      <p v-if="usage.cleanup === 'disabled'" class="field-help">
        Automatic deletion is disabled on this operator.
      </p>
      <p v-else class="field-help">
        The operator enabled guarded hosting cleanup after the original unpaid term and 30-day grace
        period. Keep whole files within funded capacity or export them before the deadline.
      </p>
    </template>
    <button type="button" class="secondary" :disabled="loading" @click="refresh">
      Refresh storage usage
    </button>
    <details v-if="member.active && member.admin">
      <summary>Recover hosted records after database loss</summary>
      <p class="field-help">
        Verify surviving on-chain references against this operator's provider inventory. This
        records ownership and bytes; it does not restore paid subscriptions, social pairings or
        missing files. Released hosting remains released. This operation never uploads or deletes a
        file.
      </p>
      <label for="storage-recovery-kind">References to recover</label>
      <select id="storage-recovery-kind" v-model="recoveryKind" :disabled="loading">
        <option value="document-version">Document files</option>
        <option value="branding">Public card images</option>
        <option value="archive">Archive bundles</option>
      </select>
      <button type="button" :disabled="loading" @click="recover()">
        Verify surviving hosted records
      </button>
      <template v-if="recovery">
        <p role="status">
          {{ recovery.objects.length }} references checked. Paid billing has not been restored.
        </p>
        <ul>
          <li v-for="object in recovery.objects" :key="object.referenceKey">
            {{ object.referenceKey }}: {{ object.state }}
          </li>
        </ul>
        <p class="field-help">
          External means no Daclify pin was found in this provider account. Unavailable means
          verification failed; retry or ask the operator to investigate.
        </p>
        <button
          v-if="recovery.next"
          type="button"
          :disabled="loading"
          @click="recover(recovery.next)"
        >
          Verify next batch
        </button>
      </template>
      <RouterLink to="/docs/recovery">Recovery responsibilities ↗</RouterLink>
    </details>
    <RouterLink to="/docs/documents">Storage documentation ↗</RouterLink>
    <RouterLink :to="{ path: '/resources', query: { dao: JSON.stringify(props.dao) } }"
      >Manage resources →</RouterLink
    >
  </aside>
</template>
