<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { X } from '@lucide/vue';
const props = defineProps<{ open: boolean; title: string; busy?: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
let disposed = false;
watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (disposed || props.open !== open) return;
    if (open && !dialog.value?.open) dialog.value?.showModal();
    if (!open && dialog.value?.open) dialog.value.close();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  dialog.value?.close();
});
function close() {
  if (!props.busy) emit('update:open', false);
}
</script>
<template>
  <dialog
    ref="dialog"
    class="panel workspace-dialog"
    :aria-labelledby="titleId"
    @cancel="busy && $event.preventDefault()"
    @close="emit('update:open', false)"
  >
    <div class="panel-heading">
      <h2 :id="titleId">{{ title }}</h2>
      <button
        type="button"
        class="workspace-icon-button"
        :aria-label="`Close ${title}`"
        :disabled="busy"
        @click="close"
      >
        <X aria-hidden="true" />
      </button>
    </div>
    <fieldset :disabled="busy"><slot /></fieldset>
    <div class="button-row">
      <button type="button" class="secondary" :disabled="busy" @click="close">Cancel</button>
    </div>
  </dialog>
</template>
<style scoped>
.workspace-dialog {
  width: min(840px, calc(100% - 32px));
  max-height: calc(100dvh - 48px);
  overflow: auto;
  margin: auto;
  color: var(--text-primary);
}
.workspace-dialog.document-dialog {
  width: min(560px, calc(100% - 32px));
}
.workspace-dialog::backdrop {
  background: rgb(0 0 0 / 72%);
  backdrop-filter: blur(6px);
}
fieldset {
  border: 0;
  margin: 0 0 24px;
  padding: 0;
  min-width: 0;
}
.workspace-dialog :deep(.panel) {
  max-width: none;
  margin-bottom: 16px;
}
@media (max-width: 600px) {
  .workspace-dialog {
    padding: 20px;
  }
}
</style>
