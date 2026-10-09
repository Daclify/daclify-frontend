<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted, nextTick, watch } from 'vue';
import { Bot, Minus, Move, Maximize2, RotateCcw } from '@lucide/vue';
import DocsAssistant from './DocsAssistant.vue';
const open = defineModel<boolean>({ required: true });
const x = ref(Math.max(12, window.innerWidth - 472)),
  y = ref(100),
  expanded = ref(false);
const windowStyle = computed(() =>
  expanded.value
    ? {}
    : {
        left: `${x.value}px`,
        top: `${y.value}px`,
        maxWidth: `${window.innerWidth - x.value - 12}px`,
        maxHeight: `${window.innerHeight - y.value - 12}px`,
      },
);
let drag: { x: number; y: number; pointer: number } | undefined;
const frame = ref<HTMLElement>();
function constrain() {
  x.value = Math.max(
    12,
    Math.min(x.value, window.innerWidth - (frame.value?.offsetWidth ?? 440) - 12),
  );
  y.value = Math.max(
    12,
    Math.min(y.value, window.innerHeight - (frame.value?.offsetHeight ?? 560) - 12),
  );
}
async function reset() {
  expanded.value = false;
  x.value = Math.max(12, window.innerWidth - 472);
  y.value = 80;
  await nextTick();
  constrain();
}
function start(event: PointerEvent) {
  if (expanded.value || event.button !== 0) return;
  drag = { x: event.clientX - x.value, y: event.clientY - y.value, pointer: event.pointerId };
  if (event.currentTarget instanceof HTMLElement)
    event.currentTarget.setPointerCapture(event.pointerId);
  event.preventDefault();
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return;
  x.value = event.clientX - drag.x;
  y.value = event.clientY - drag.y;
  constrain();
}
function keyMove(event: KeyboardEvent) {
  const step = event.shiftKey ? 40 : 10;
  switch (event.key) {
    case 'ArrowLeft':
      x.value -= step;
      break;
    case 'ArrowRight':
      x.value += step;
      break;
    case 'ArrowUp':
      y.value -= step;
      break;
    case 'ArrowDown':
      y.value += step;
      break;
    default:
      return;
  }
  event.preventDefault();
  expanded.value = false;
  constrain();
}
onMounted(() => window.addEventListener('resize', constrain));
onBeforeUnmount(() => window.removeEventListener('resize', constrain));
watch(
  open,
  async (value) => {
    await nextTick();
    if (value) {
      frame.value?.querySelector<HTMLElement>('textarea,button')?.focus();
    } else {
      const launcher = document.getElementById('help-launcher');
      if (launcher?.offsetParent) launcher.focus();
      else document.querySelector<HTMLElement>('.mobile-menu')?.focus();
    }
  },
  { immediate: true },
);
</script>
<template>
  <aside
    v-show="open"
    id="help-window"
    ref="frame"
    class="help-window"
    :class="{ expanded }"
    :style="windowStyle"
    aria-label="Daclify Help"
    @keydown.esc="open = false"
  >
    <header class="help-window-bar">
      <button
        type="button"
        class="help-drag"
        aria-label="Move help window with arrow keys or drag"
        @pointerdown="start"
        @pointermove="move"
        @pointerup="drag = undefined"
        @pointercancel="drag = undefined"
        @keydown="keyMove"
      >
        <Bot aria-hidden="true" /><strong>Daclify Help</strong><Move aria-hidden="true" />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Reset help position"
        title="Reset position"
        @click="reset"
      >
        <RotateCcw aria-hidden="true" />
      </button>
      <button
        type="button"
        class="icon-button"
        :aria-label="expanded ? 'Restore help size' : 'Expand help window'"
        @click="expanded = !expanded"
      >
        <Maximize2 aria-hidden="true" />
      </button>
      <button type="button" class="icon-button" aria-label="Minimize help" @click="open = false">
        <Minus aria-hidden="true" />
      </button>
    </header>
    <DocsAssistant />
  </aside>
</template>
