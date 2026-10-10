<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted, nextTick, watch } from 'vue';
import { Bot, Minus, Move, Maximize2, Minimize2, RotateCcw } from '@lucide/vue';
import DocsAssistant from './DocsAssistant.vue';
const open = defineModel<boolean>({ required: true });
const x = ref(Math.max(12, window.innerWidth - 472)),
  y = ref(100),
  expanded = ref(false);
const viewport = ref({
  width: window.innerWidth,
  height: window.visualViewport?.height ?? window.innerHeight,
});
const windowStyle = computed(() => ({
  maxWidth: `${viewport.value.width - 24}px`,
  maxHeight: `${viewport.value.height - 24}px`,
  minHeight: `${Math.min(320, viewport.value.height - 24)}px`,
  ...(!expanded.value
    ? {
        left: `${x.value}px`,
        top: `${y.value}px`,
      }
    : {}),
}));
let drag: { x: number; y: number; pointer: number } | undefined;
const frame = ref<HTMLElement>();
function constrain() {
  if (expanded.value) return;
  x.value = Math.max(
    12,
    Math.min(x.value, viewport.value.width - (frame.value?.offsetWidth ?? 440) - 12),
  );
  y.value = Math.max(
    12,
    Math.min(y.value, viewport.value.height - (frame.value?.offsetHeight ?? 600) - 12),
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
async function keyMove(event: KeyboardEvent) {
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
  await nextTick();
  constrain();
}
async function resize() {
  viewport.value = {
    width: window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
  await nextTick();
  constrain();
}
async function toggleExpanded() {
  expanded.value = !expanded.value;
  await nextTick();
  constrain();
}
function focusQuestion() {
  if (!open.value) return;
  frame.value?.querySelector<HTMLElement>('textarea')?.focus();
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  observer = new ResizeObserver(constrain);
  if (frame.value) observer.observe(frame.value);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  window.visualViewport?.removeEventListener('resize', resize);
  observer?.disconnect();
});
watch(
  open,
  async (value) => {
    await nextTick();
    if (value) {
      constrain();
      const target =
        frame.value?.querySelector<HTMLElement>('textarea') ??
        frame.value?.querySelector<HTMLElement>('button');
      target?.focus();
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
    aria-label="Daxi Help"
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
        <span class="help-bot-mark"><Bot aria-hidden="true" /></span
        ><span class="help-window-title"
          ><strong>Daxi Help</strong><small>Daclify · Telos · DAOs</small></span
        ><Move class="help-move-icon" aria-hidden="true" />
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
        :title="expanded ? 'Restore size' : 'Expand window'"
        @click="toggleExpanded"
      >
        <Minimize2 v-if="expanded" aria-hidden="true" /><Maximize2 v-else aria-hidden="true" />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Minimize help"
        title="Minimize help"
        @click="open = false"
      >
        <Minus aria-hidden="true" />
      </button>
    </header>
    <DocsAssistant @ready="focusQuestion" />
  </aside>
</template>
