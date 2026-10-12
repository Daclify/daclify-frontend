<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  durationFromInput,
  durationUntil,
  durationUnits,
  preferredDurationUnit,
  type DurationUnit,
} from '../content/governance-inputs';
const props = defineProps<{
  id: string;
  label: string;
  modelValue: number;
  disabled?: boolean;
  allowDate?: boolean;
  now?: number;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();
const unit = ref<DurationUnit>(preferredDurationUnit(props.modelValue));
const text = ref(String(props.modelValue / durationUnits[unit.value]));
const calendar = ref(false),
  date = ref(''),
  error = ref('');
const input = ref<HTMLInputElement>();
let durationBeforeDate = props.modelValue;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const now = () => props.now ?? Math.floor(Date.now() / 1000);
function localTime(seconds: number) {
  const value = new Date(seconds * 1000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
watch(
  () => props.modelValue,
  (value) => {
    if (!Number.isFinite(value) || calendar.value) return;
    try {
      if (durationFromInput(text.value, unit.value) === value) return;
    } catch {
      /* Replace externally loaded values. */
    }
    unit.value = preferredDurationUnit(value);
    text.value = String(value / durationUnits[unit.value]);
    error.value = '';
    input.value?.setCustomValidity('');
  },
);
function invalid(element: HTMLInputElement) {
  error.value = 'Choose a duration between 1 minute and 30 days.';
  element.setCustomValidity(error.value);
  emit('update:modelValue', Number.NaN);
}
function update(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  text.value = event.target.value;
  try {
    const value = durationFromInput(text.value, unit.value);
    error.value = '';
    event.target.setCustomValidity('');
    emit('update:modelValue', value);
  } catch {
    invalid(event.target);
  }
}
function changeUnit() {
  if (Number.isFinite(props.modelValue))
    text.value = String(props.modelValue / durationUnits[unit.value]);
}
function updateDate() {
  if (!input.value) return;
  try {
    const value = durationUntil(Math.floor(new Date(date.value).getTime() / 1000), now());
    error.value = '';
    input.value.setCustomValidity('');
    emit('update:modelValue', value);
  } catch {
    invalid(input.value);
  }
}
function chooseDate() {
  error.value = '';
  if (calendar.value) {
    durationBeforeDate = props.modelValue;
    date.value = localTime(now() + props.modelValue);
  } else {
    emit('update:modelValue', durationBeforeDate);
    text.value = String(durationBeforeDate / durationUnits[unit.value]);
  }
}
watch(
  () => props.now,
  () => {
    if (calendar.value && !props.disabled) updateDate();
  },
);
</script>
<template>
  <div class="voting-duration">
    <template v-if="!calendar">
      <label :for="id">{{ label }}</label>
      <div class="duration-fields">
        <input
          :id="id"
          ref="input"
          :value="text"
          type="number"
          inputmode="decimal"
          step="any"
          required
          :min="60 / durationUnits[unit]"
          :max="2592000 / durationUnits[unit]"
          :disabled="disabled"
          :aria-invalid="!!error"
          :aria-describedby="id + '-help'"
          @input="update"
        />
        <select
          :id="id + '-unit'"
          v-model="unit"
          :aria-label="label + ' unit'"
          :disabled="disabled"
          @change="changeUnit"
        >
          <option value="minutes">Minutes</option>
          <option value="hours">Hours</option>
          <option value="days">Days</option>
          <option value="weeks">Weeks</option>
        </select>
      </div>
    </template>
    <template v-else>
      <label :for="id + '-date'">Closing date and time</label>
      <input
        :id="id + '-date'"
        ref="input"
        v-model="date"
        type="datetime-local"
        step="1"
        required
        :min="localTime(now() + 60)"
        :max="localTime(now() + 2592000)"
        :disabled="disabled"
        :aria-invalid="!!error"
        :aria-describedby="id + '-help'"
        @input="updateDate"
      />
    </template>
    <label v-if="allowDate && !disabled" class="choice"
      ><input
        v-model="calendar"
        type="checkbox"
        :disabled="!calendar && !Number.isFinite(modelValue)"
        @change="chooseDate"
      />Choose a closing date</label
    >
    <p
      :id="id + '-help'"
      class="field-help"
      :class="{ danger: error }"
      :role="error ? 'alert' : undefined"
    >
      <template v-if="error">{{ error }}</template>
      <template v-else-if="allowDate && Number.isFinite(modelValue)"
        >Closes around {{ new Date((now() + modelValue) * 1000).toLocaleString() }} ({{
          timezone
        }}).</template
      >
      <template v-else>Between 1 minute and 30 days.</template>
    </p>
  </div>
</template>
<style scoped>
.duration-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.duration-fields input,
.duration-fields select {
  min-width: 0;
}
.choice {
  font-weight: 400;
}
.choice input {
  flex: 0 0 auto;
}
</style>
