<script setup lang="ts">
import { computed } from 'vue';
import { formatHelpAnswer } from '../help/format';

const props = defineProps<{ text: string }>();
const formatted = computed(() => formatHelpAnswer(props.text));
</script>

<template>
  <div class="help-answer" v-html="formatted" />
</template>
