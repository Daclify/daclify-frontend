<script setup lang="ts">
import { Plus, CircleHelp } from '@lucide/vue';
defineProps<{ addLabel: string; helpTo: string; disabled?: boolean }>();
defineEmits<{ add: [] }>();
</script>
<template>
  <div class="workspace-tools-actions">
    <button
      type="button"
      class="workspace-icon-button workspace-add"
      :aria-label="addLabel"
      :title="addLabel"
      aria-haspopup="dialog"
      :disabled="disabled"
      @click="$emit('add')"
    >
      <Plus aria-hidden="true" />
    </button>
    <RouterLink
      class="workspace-icon-button"
      :to="helpTo"
      aria-label="Rules & help"
      title="Rules & help"
      ><CircleHelp aria-hidden="true"
    /></RouterLink>
  </div>
</template>
