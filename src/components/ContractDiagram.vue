<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { Maximize, Minimize, Minus, Plus, Scan } from '@lucide/vue';
import type { ContractConnection, ContractReading } from '../content/contract-map';

const props = defineProps<{
  contracts: ContractReading[];
  connections: ContractConnection[];
  runtime: string;
  selected: string;
  related: Set<string>;
  roles?: Record<string, string>;
}>();
const emit = defineEmits<{ select: [account: string] }>();
const card = ref<HTMLElement>(),
  viewport = ref<HTMLElement>();
const size = ref({ width: 1000, height: 580 });
const zoom = ref(1),
  pan = ref({ x: 0, y: 0 });
const expanded = ref(new Set<string>()),
  showAll = ref(false);
const fullscreen = ref(false),
  fullscreenAvailable = ref(false),
  notice = ref('');
const markerId = useId();
const kinds = ['delegation', 'action', 'configuration'] as const;
const accounts = computed(() => props.contracts.map((contract) => contract.account));
const anchors = computed(
  () => new Set(showAll.value ? accounts.value : [props.selected, ...expanded.value]),
);
const highlighted = computed(
  () =>
    new Set([
      ...anchors.value,
      ...props.connections.flatMap((edge) =>
        anchors.value.has(edge.from) ? [edge.to] : anchors.value.has(edge.to) ? [edge.from] : [],
      ),
    ]),
);
const highlightedEdge = (edge: ContractConnection) =>
  anchors.value.has(edge.from) || anchors.value.has(edge.to);
const neighbors = (account: string) =>
  new Set(
    props.connections.flatMap((edge) =>
      edge.from === account ? [edge.to] : edge.to === account ? [edge.from] : [],
    ),
  );
const layout = computed(() =>
  size.value.width < 600 && highlighted.value.size > 3 ? { width: 1000, height: 620 } : size.value,
);
const actionNeighbors = computed(
  () =>
    new Set(
      props.connections
        .filter((edge) => edge.kind === 'action')
        .flatMap((edge) =>
          edge.from === props.selected ? [edge.to] : edge.to === props.selected ? [edge.from] : [],
        ),
    ),
);
const nodes = computed(() => {
  const { width, height } = layout.value;
  const center = { x: width / 2, y: height / 2 - 24 };
  const direct = neighbors(props.selected);
  const close = accounts.value.filter(
    (account) => account !== props.selected && direct.has(account),
  );
  const distant = accounts.value.filter(
    (account) => account !== props.selected && !direct.has(account),
  );
  const positions = new Map([[props.selected, center]]);
  const ring = (members: string[], outer: boolean) => {
    const rx = Math.max(
      0,
      Math.min(width / 2 - 96, width * (outer || members.length > 4 ? 0.4 : 0.28)),
    );
    const ry = height * (outer || members.length > 4 ? 0.36 : 0.29);
    members.forEach((account, index) => {
      const start = outer
        ? width < 600
          ? -Math.PI
          : -Math.PI / 2
        : width < 600
          ? -Math.PI / 2
          : -2.35;
      const angle = start + (index * Math.PI * 2) / members.length;
      positions.set(account, {
        x: center.x + Math.cos(angle) * rx,
        y: center.y + Math.sin(angle) * ry,
      });
    });
  };
  ring(close, false);
  ring(distant, true);
  return accounts.value.map((account) => ({ account, ...(positions.get(account) ?? center) }));
});
function descriptions(account: string) {
  return props.connections
    .filter((edge) => edge.from === account || edge.to === account)
    .flatMap((edge) => edge.descriptions)
    .join('\n');
}
function canExpand(account: string) {
  return (
    !showAll.value &&
    account !== props.selected &&
    highlighted.value.has(account) &&
    (expanded.value.has(account) ||
      props.connections.some(
        (edge) => (edge.from === account || edge.to === account) && !highlightedEdge(edge),
      ))
  );
}
function expand(account: string) {
  const next = new Set(expanded.value);
  if (next.has(account)) next.delete(account);
  else next.add(account);
  expanded.value = next;
}
const paths = computed(() =>
  props.connections.flatMap((connection) => {
    const from = nodes.value.find((node) => node.account === connection.from),
      to = nodes.value.find((node) => node.account === connection.to);
    if (!from || !to || from === to) return [];
    const dx = to.x - from.x,
      dy = to.y - from.y,
      distance = Math.hypot(dx, dy);
    if (!distance) return [];
    const ux = dx / distance,
      uy = dy / distance;
    const siblings = props.connections.filter(
      (edge) =>
        (edge.from === connection.from && edge.to === connection.to) ||
        (edge.from === connection.to && edge.to === connection.from),
    );
    const offset =
      siblings.length > 1
        ? (siblings.indexOf(connection) - (siblings.length - 1) / 2) *
          76 *
          (connection.from < connection.to ? 1 : -1)
        : 22;
    const start = {
      x: from.x + ux * (from.account === props.selected ? 36 : 29),
      y: from.y + uy * (from.account === props.selected ? 36 : 29),
    };
    const end = {
      x: to.x - ux * (to.account === props.selected ? 36 : 29),
      y: to.y - uy * (to.account === props.selected ? 36 : 29),
    };
    const control = {
      x: (start.x + end.x) / 2 - uy * offset,
      y: (start.y + end.y) / 2 + ux * offset,
    };
    const label =
      connection.kind === 'delegation'
        ? 'Delegates authority'
        : connection.kind === 'configuration'
          ? 'Platform configuration'
          : connection.descriptions.length === 1
            ? (connection.descriptions[0]?.match(/::([a-z1-5.*]+)/)?.[1] ?? 'Linked actions')
            : 'Linked actions';
    const midpoint = {
      x: (start.x + 2 * control.x + end.x) / 4,
      y: (start.y + 2 * control.y + end.y) / 4 - 10,
    };
    const labelPosition = [
      midpoint,
      { ...midpoint, x: midpoint.x + 80 },
      { ...midpoint, x: midpoint.x - 80 },
      { ...midpoint, y: midpoint.y - 40 },
      { ...midpoint, y: midpoint.y + 40 },
    ].find((point) =>
      nodes.value.every(
        (node) =>
          Math.abs(point.x - node.x) > 90 + label.length * 3.5 ||
          point.y < node.y - 40 ||
          point.y > node.y + 110,
      ),
    );
    return [
      {
        connection,
        label,
        d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
        labelPosition,
      },
    ];
  }),
);
const edgeLabels = computed(
  () =>
    size.value.width >= 600 &&
    paths.value.filter((path) => highlightedEdge(path.connection)).length <= 5,
);
const worldStyle = computed(() => ({
  width: layout.value.width + 'px',
  height: layout.value.height + 'px',
  left: (size.value.width - layout.value.width) / 2 + 'px',
  top: (size.value.height - layout.value.height) / 2 + 'px',
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
}));
function fit() {
  zoom.value = Math.min(
    1,
    size.value.width / layout.value.width,
    size.value.height / layout.value.height,
  );
  pan.value = { x: 0, y: 0 };
}
function scale(factor: number, point = { x: size.value.width / 2, y: size.value.height / 2 }) {
  const next = Math.max(0.25, Math.min(3, Math.round(zoom.value * factor * 10000) / 10000));
  const ratio = next / zoom.value;
  pan.value = {
    x: point.x - size.value.width / 2 - (point.x - size.value.width / 2 - pan.value.x) * ratio,
    y: point.y - size.value.height / 2 - (point.y - size.value.height / 2 - pan.value.y) * ratio,
  };
  zoom.value = next;
}
function reveal(account: string, event: FocusEvent) {
  if (!(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible')) return;
  const node = nodes.value.find((entry) => entry.account === account);
  if (!node) return;
  const x = size.value.width / 2 + (node.x - layout.value.width / 2) * zoom.value + pan.value.x;
  const y = size.value.height / 2 + (node.y - layout.value.height / 2) * zoom.value + pan.value.y;
  if (x < 90 || x > size.value.width - 90 || y < 32 || y > size.value.height - 110)
    pan.value = {
      x: (layout.value.width / 2 - node.x) * zoom.value,
      y: (layout.value.height / 2 - node.y) * zoom.value,
    };
}
function wheel(event: WheelEvent) {
  const bounds = viewport.value?.getBoundingClientRect();
  if (bounds && event.deltaY)
    scale(event.deltaY < 0 ? 1.12 : 1 / 1.12, {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
}
let drag: { id: number; x: number; y: number; origin: { x: number; y: number } } | undefined;
function startPan(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...pan.value } };
  viewport.value?.setPointerCapture(event.pointerId);
}
function movePan(event: PointerEvent) {
  if (drag?.id === event.pointerId)
    pan.value = {
      x: drag.origin.x + event.clientX - drag.x,
      y: drag.origin.y + event.clientY - drag.y,
    };
}
function stopPan(event: PointerEvent) {
  if (drag?.id === event.pointerId) drag = undefined;
}
function keyboard(event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  const arrows: Record<string, { x: number; y: number }> = {
    ArrowLeft: { x: -40, y: 0 },
    ArrowRight: { x: 40, y: 0 },
    ArrowUp: { x: 0, y: -40 },
    ArrowDown: { x: 0, y: 40 },
  };
  const delta = arrows[event.key];
  if (delta) pan.value = { x: pan.value.x + delta.x, y: pan.value.y + delta.y };
  else if (event.key === '+' || event.key === '=') scale(1.2);
  else if (event.key === '-') scale(1 / 1.2);
  else if (event.key === 'Home' || event.key === '0') fit();
  else return;
  event.preventDefault();
}
function fullscreenChanged() {
  fullscreen.value = document.fullscreenElement === card.value;
}
async function toggleFullscreen() {
  notice.value = '';
  try {
    if (fullscreen.value) await document.exitFullscreen();
    else await card.value?.requestFullscreen();
  } catch {
    notice.value = 'Fullscreen is unavailable in this browser.';
  }
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  fullscreenAvailable.value = document.fullscreenEnabled;
  document.addEventListener('fullscreenchange', fullscreenChanged);
  observer = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width && entry.contentRect.height)
      size.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  if (viewport.value) observer.observe(viewport.value);
});
function resetFocus() {
  expanded.value = new Set();
  showAll.value = false;
  pan.value = { x: 0, y: 0 };
}
function select(account: string) {
  resetFocus();
  emit('select', account);
}
watch(() => props.selected, resetFocus);
onUnmounted(() => {
  observer?.disconnect();
  document.removeEventListener('fullscreenchange', fullscreenChanged);
});
</script>

<template>
  <section ref="card" class="contract-diagram" aria-label="Contract connections">
    <header class="diagram-header">
      <div>
        <h3>Contract overview</h3>
        <p>Focus on one account. Explore its connections.</p>
      </div>
      <div class="diagram-controls">
        <div class="zoom-controls" role="group" aria-label="Graph zoom">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            :disabled="zoom <= 0.25"
            @click="scale(1 / 1.2)"
          >
            <Minus :size="16" aria-hidden="true" />
          </button>
          <output aria-label="Zoom level" aria-live="polite">{{ Math.round(zoom * 100) }}%</output>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            :disabled="zoom >= 3"
            @click="scale(1.2)"
          >
            <Plus :size="16" aria-hidden="true" />
          </button>
        </div>
        <button type="button" aria-label="Fit graph" title="Fit graph" @click="fit">
          <Scan :size="16" aria-hidden="true" /><span>Fit</span>
        </button>
        <button
          type="button"
          :aria-label="fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
          :title="
            fullscreenAvailable
              ? fullscreen
                ? 'Exit fullscreen'
                : 'Enter fullscreen'
              : 'Fullscreen is not supported in this browser'
          "
          :disabled="!fullscreenAvailable"
          @click="toggleFullscreen"
        >
          <component :is="fullscreen ? Minimize : Maximize" :size="16" aria-hidden="true" />
        </button>
      </div>
      <div class="focus-controls">
        <span aria-live="polite">{{ showAll ? 'All accounts' : 'Focused: ' + selected }}</span>
        <button v-if="!showAll" type="button" @click="showAll = true">Show all</button>
        <button
          v-else
          type="button"
          @click="
            showAll = false;
            expanded = new Set();
          "
        >
          Focus selected
        </button>
      </div>
    </header>
    <p v-if="notice" class="diagram-notice" role="status">{{ notice }}</p>
    <div
      ref="viewport"
      class="diagram-viewport"
      role="group"
      aria-label="Pan and zoom contract graph"
      tabindex="0"
      aria-description="Arrow keys pan, plus and minus zoom, Home fits the graph. Tab to an account and press Enter to select it."
      @keydown="keyboard"
      @wheel.prevent="wheel"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="stopPan"
      @pointercancel="stopPan"
      @lostpointercapture="stopPan"
    >
      <div class="diagram-world" :style="worldStyle">
        <svg class="diagram-lines" aria-hidden="true">
          <defs>
            <marker
              v-for="kind in kinds"
              :id="markerId + '-' + kind"
              :key="kind"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" :class="'arrow-' + kind" />
            </marker>
          </defs>
          <g
            v-for="path in paths"
            :key="path.connection.kind + ':' + path.connection.from + ':' + path.connection.to"
            :data-kind="path.connection.kind"
            :data-highlighted="highlightedEdge(path.connection)"
          >
            <path
              :d="path.d"
              :data-connection-kind="path.connection.kind"
              :data-highlighted="highlightedEdge(path.connection)"
              :marker-end="'url(#' + markerId + '-' + path.connection.kind + ')'"
            >
              <title>{{ path.connection.descriptions.join('\n') }}</title>
            </path>
            <text
              v-if="edgeLabels && highlightedEdge(path.connection) && path.labelPosition"
              :x="path.labelPosition.x"
              :y="path.labelPosition.y"
              text-anchor="middle"
            >
              {{ path.label }}
            </text>
          </g>
        </svg>
        <div
          v-for="node in nodes"
          :key="node.account"
          class="graph-node"
          :data-highlighted="highlighted.has(node.account)"
          :style="{
            left: node.x + 'px',
            top: node.y + 'px',
            zIndex: node.account === selected ? 2 : highlighted.has(node.account) ? 1 : 0,
          }"
        >
          <button
            type="button"
            class="account-node"
            :data-account="node.account"
            :data-related="related.has(node.account)"
            :data-action-neighbor="actionNeighbors.has(node.account)"
            :data-highlighted="highlighted.has(node.account)"
            :aria-label="node.account"
            :aria-pressed="selected === node.account"
            aria-controls="contract-account-details"
            :aria-description="descriptions(node.account) || 'No account connection reported.'"
            :title="descriptions(node.account)"
            @pointerdown.stop
            @focus="reveal(node.account, $event)"
            @click="select(node.account)"
          >
            <span class="node-orb" aria-hidden="true"></span>
            <span class="node-name">{{ node.account }}</span>
            <span v-if="highlighted.has(node.account)" class="node-role" aria-hidden="true">{{
              roles?.[node.account] ??
              (node.account === runtime ? 'Runtime contract' : 'Contract account')
            }}</span>
          </button>
          <button
            v-if="canExpand(node.account)"
            type="button"
            class="expand-node"
            :aria-label="
              (expanded.has(node.account) ? 'Collapse' : 'Expand') +
              ' connections for ' +
              node.account
            "
            :aria-expanded="expanded.has(node.account)"
            :title="(expanded.has(node.account) ? 'Collapse' : 'Expand') + ' connections'"
            @pointerdown.stop
            @click="expand(node.account)"
          >
            <component
              :is="expanded.has(node.account) ? Minus : Plus"
              :size="14"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
    <footer class="diagram-footer">
      <div class="diagram-legend">
        <span><i class="delegation-line" aria-hidden="true"></i> Delegates authority</span>
        <span><i class="action-line" aria-hidden="true"></i> Linked actions</span>
        <span><i class="configuration-line" aria-hidden="true"></i> Platform configuration</span>
        <span v-if="related.size" class="related-caption"
          >Highlighted names share the selected authority</span
        >
      </div>
      <p>Click to focus · + to expand connections · Scroll to zoom · Drag to move</p>
    </footer>
  </section>
</template>

<style scoped>
.contract-diagram {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  margin-bottom: 24px;
  overflow: hidden;
}
.diagram-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: start;
  flex-wrap: wrap;
  gap: 12px;
  padding: 20px 22px 0;
}
.diagram-header h3 {
  margin: 0 0 4px;
  font-size: 1.25rem;
}
.diagram-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}
.diagram-controls {
  display: flex;
  gap: 10px;
  margin-left: auto;
  align-items: center;
}
.diagram-controls button {
  min-width: 36px;
  min-height: 36px;
  padding: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-panel);
  color: var(--text-primary);
  box-shadow: none;
}
.zoom-controls {
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
.zoom-controls button {
  border: 0;
  border-radius: 0;
}
.zoom-controls output {
  min-width: 52px;
  text-align: center;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.diagram-controls button:disabled {
  opacity: 0.45;
}
.focus-controls {
  display: flex;
  width: 100%;
  justify-content: end;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 0.75rem;
}
.focus-controls > span {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-secondary);
}
.focus-controls button {
  min-height: 32px;
  padding: 4px;
  background: transparent;
  border: none;
  box-shadow: none;
  color: var(--accent-amber);
  text-decoration: underline;
  font-size: inherit;
}
.diagram-viewport {
  position: relative;
  height: clamp(32.5rem, 45vw, 40rem);
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background-image: radial-gradient(var(--line) 0.7px, transparent 0.7px);
  background-size: 20px 20px;
}
.diagram-viewport:active {
  cursor: grabbing;
}
.diagram-viewport:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: -3px;
}
.diagram-world {
  position: absolute;
  inset: 0;
  transform-origin: center;
}
.diagram-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.diagram-lines g {
  fill: none;
  stroke: var(--accent-amber);
  stroke-width: 1.5;
}
.diagram-lines g[data-kind='action'] {
  stroke: var(--state-success);
  stroke-dasharray: 5 5;
}
.diagram-lines g[data-kind='configuration'] {
  stroke: var(--text-secondary);
  stroke-dasharray: 1 5;
  stroke-linecap: round;
}
.diagram-lines g[data-highlighted='false'] {
  opacity: 0.035;
}
.diagram-lines text {
  fill: var(--accent-amber);
  stroke: var(--surface-panel);
  stroke-width: 6px;
  stroke-dasharray: none;
  paint-order: stroke;
  font-size: 12px;
}
.diagram-lines g[data-kind='action'] text {
  fill: var(--state-success);
}
.diagram-lines g[data-kind='configuration'] text {
  fill: var(--text-secondary);
}
.arrow-delegation {
  fill: var(--accent-amber);
}
.arrow-action {
  fill: var(--state-success);
}
.arrow-configuration {
  fill: var(--text-secondary);
}
.graph-node {
  position: absolute;
  width: 180px;
  transform: translate(-50%, -27px);
}
.account-node {
  display: flex;
  align-items: center;
  flex-direction: column;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  box-shadow: none;
}
.account-node:hover,
.diagram-controls button:hover,
.focus-controls button:hover,
.expand-node:hover {
  transform: none;
}
.node-orb {
  display: block;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--accent-amber);
  background: radial-gradient(circle at 42% 35%, #fbd88a, #a36b1b 62%, #684015);
  box-shadow:
    inset 0 0 12px #ffd47b88,
    0 0 22px #f4b35d33;
}
.node-name {
  display: block;
  max-width: 100%;
  margin-top: 10px;
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.node-role {
  color: var(--text-secondary);
  font-size: 0.75rem;
  margin-top: 2px;
  font-weight: 400;
}
.account-node[aria-pressed='true'] .node-orb {
  outline: 2px solid var(--accent-amber);
  outline-offset: 6px;
  background: radial-gradient(circle at 42% 35%, #fff0b4, #ffca63 45%, #bb7a1d 80%);
  box-shadow: 0 0 30px #f4b35d44;
}
.account-node[aria-pressed='true'] .node-name {
  color: var(--text-primary);
  border-color: var(--line-strong, var(--line));
  background: var(--surface-panel);
  font-size: 1.125rem;
}
.account-node[data-highlighted='false'] .node-orb {
  opacity: 0.12;
  box-shadow: none;
}
.account-node[data-highlighted='false'] .node-name {
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 400;
}
.account-node[data-related='true'] .node-orb {
  border-color: var(--state-success);
  outline: 2px solid var(--state-success);
  outline-offset: 4px;
}
.account-node[data-action-neighbor='true'] .node-orb {
  border-color: var(--state-success);
  background: radial-gradient(circle at 42% 35%, #d5ee9d, #687b23 62%, #303b12);
  box-shadow:
    inset 0 0 12px #d5ee9d66,
    0 0 22px #a7d96a33;
}
.account-node:hover .node-name {
  color: var(--accent-amber);
}
.expand-node {
  position: absolute;
  top: -10px;
  left: calc(50% + 22px);
  display: grid;
  place-items: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 4px;
  border-radius: 50%;
  border: 1px solid var(--text-secondary);
  color: var(--text-primary);
  background: var(--surface-panel);
  box-shadow: none;
}
.contract-diagram button:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 3px;
}
.diagram-footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 14px 22px;
  border-top: 1px solid var(--line);
  color: var(--text-secondary);
  font-size: 0.6875rem;
}
.diagram-legend {
  display: flex;
  gap: 12px 20px;
  flex-wrap: wrap;
}
.diagram-legend span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.diagram-legend i {
  width: 24px;
  border-top: 2px solid var(--accent-amber);
}
.diagram-legend .action-line {
  border-top: 2px dashed var(--state-success);
}
.diagram-legend .configuration-line {
  border-top: 2px dotted var(--text-secondary);
}
.related-caption {
  color: var(--state-success);
}
.diagram-footer p {
  margin: 0;
}
.diagram-notice {
  margin: 12px 22px;
  color: var(--text-secondary);
}
.contract-diagram:fullscreen {
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  border-radius: 0;
  display: flex;
  flex-direction: column;
}
.contract-diagram:fullscreen .diagram-viewport {
  flex: 1;
  min-height: 0;
  height: auto;
}
@media (max-width: 600px) {
  .graph-node[data-highlighted='false'],
  .diagram-lines g[data-highlighted='false'] {
    visibility: hidden;
  }
  .diagram-header {
    padding: 16px 12px 0;
  }
  .diagram-controls {
    margin-left: 0;
  }
  .focus-controls {
    justify-content: start;
  }
  .diagram-footer {
    padding: 14px 12px;
  }
}
</style>
