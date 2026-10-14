<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { api, friendlyError } from '../api/client';
import { downloadFile } from '../content/files';
const props = defineProps<{ daoId: string; ballotId: string }>();
const busy = ref(false),
  error = ref(''),
  notice = ref('');
let generation = 0,
  disposed = false;
watch(
  () => [props.daoId, props.ballotId],
  () => {
    generation++;
    busy.value = false;
    error.value = '';
    notice.value = '';
  },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
async function exportBallot() {
  if (busy.value) return;
  const current = ++generation;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const value = await api.ballotExport(props.daoId, props.ballotId);
    if (disposed || current !== generation) return;
    downloadFile(new TextEncoder().encode(JSON.stringify(value, null, 2)), {
      version: 1,
      filename: `ballot-${props.ballotId}.json`,
      mediaType: 'application/json',
    });
    notice.value =
      value.coverage === 'complete-live'
        ? 'All recorded live votes are included.'
        : value.archiveNotice;
  } catch (cause) {
    if (!disposed && current === generation) error.value = friendlyError(cause);
  } finally {
    if (!disposed && current === generation) busy.value = false;
  }
}
</script>
<template>
  <button type="button" class="secondary" :disabled="busy" @click="exportBallot">
    {{ busy ? 'Preparing export…' : 'Export ballot and votes' }}
  </button>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="notice" role="status">{{ notice }}</p>
</template>
