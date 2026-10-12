<script setup lang="ts">
import { ref, watch } from 'vue';
import { percentageText, percentageToBasisPoints } from '../content/governance-inputs';
const props = defineProps<{
  id: string;
  label: string;
  modelValue: number;
  kind: 'quorum' | 'approval';
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();
const text = ref(percentageText(props.modelValue)),
  error = ref('');
const input = ref<HTMLInputElement>();
watch(
  () => props.modelValue,
  (value) => {
    if (!Number.isFinite(value)) return;
    text.value = percentageText(value);
    error.value = '';
    input.value?.setCustomValidity('');
  },
);
function update(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  text.value = event.target.value;
  try {
    const value = percentageToBasisPoints(text.value, props.kind);
    error.value = '';
    event.target.setCustomValidity('');
    emit('update:modelValue', value);
  } catch {
    error.value = `Enter ${props.kind === 'approval' ? '50.01' : '0.01'}% to 100%, with up to two decimal places.`;
    event.target.setCustomValidity(error.value);
    emit('update:modelValue', Number.NaN);
  }
}
</script>
<template>
  <div class="percentage-input">
    <label :for="id">{{ label }}</label>
    <input
      :id="id"
      ref="input"
      :value="text"
      type="number"
      inputmode="decimal"
      :min="kind === 'approval' ? 50.01 : 0.01"
      max="100"
      step="0.01"
      required
      :disabled="disabled"
      :aria-invalid="!!error"
      :aria-describedby="error ? id + '-error' : undefined"
      @input="update"
    />
    <p v-if="error" :id="id + '-error'" class="field-help danger" role="alert">{{ error }}</p>
  </div>
</template>
