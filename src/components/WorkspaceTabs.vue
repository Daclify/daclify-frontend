<script setup lang="ts">
defineProps<{
  modelValue: string;
  prefix: string;
  label: string;
  items: readonly { value: string; label: string }[];
}>();
defineEmits<{ 'update:modelValue': [value: string] }>();
function navigate(event: KeyboardEvent) {
  if (
    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
    !(event.currentTarget instanceof HTMLElement)
  )
    return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const index = buttons.findIndex((button) => button === event.target);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
  buttons[next]?.click();
}
</script>
<template>
  <div class="account-tabs" role="tablist" :aria-label="label" @keydown="navigate">
    <button
      v-for="item in items"
      :id="`${prefix}-tab-${item.value}`"
      :key="item.value"
      type="button"
      role="tab"
      :aria-controls="`${prefix}-${item.value}`"
      :aria-selected="modelValue === item.value"
      :tabindex="modelValue === item.value ? 0 : -1"
      @click="$emit('update:modelValue', item.value)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
