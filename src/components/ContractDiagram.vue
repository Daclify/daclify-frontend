<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ContractConnection, ContractReading } from '../content/contract-map';

const props = defineProps<{
  contracts: ContractReading[];
  connections: ContractConnection[];
  runtime: string;
  selected: string;
  related: Set<string>;
}>();
const emit = defineEmits<{ select: [account: string] }>();
const scene = ref<HTMLElement>();
const paths = ref<{ connection: ContractConnection; d: string }[]>([]);
const layers = computed(() => {
  const accounts = props.contracts.map((contract) => contract.account);
  const root = accounts.find((account) => account === props.runtime) ?? accounts[0];
  if (!root) return [];
  const remaining = new Set(accounts);
  remaining.delete(root);
  const rows = [[root]];
  let frontier = new Set([root]);
  while (frontier.size) {
    const neighbors = new Set(
      props.connections.flatMap((edge) =>
        frontier.has(edge.from) ? [edge.to] : frontier.has(edge.to) ? [edge.from] : [],
      ),
    );
    const next = accounts.filter((account) => remaining.has(account) && neighbors.has(account));
    if (!next.length) break;
    next.forEach((account) => remaining.delete(account));
    rows.push(next);
    frontier = new Set(next);
  }
  if (remaining.size) rows.push([...remaining]);
  return rows;
});
function descriptions(account: string) {
  return props.connections
    .filter((edge) => edge.from === account || edge.to === account)
    .flatMap((edge) => edge.descriptions)
    .join('\n');
}
function measure() {
  if (!scene.value) return;
  const origin = scene.value.getBoundingClientRect();
  const bounds = new Map(
    [...scene.value.querySelectorAll<HTMLButtonElement>('[data-account]')].map((button) => [
      button.dataset.account,
      button.getBoundingClientRect(),
    ]),
  );
  paths.value = props.connections.flatMap((connection, index) => {
    const from = bounds.get(connection.from),
      to = bounds.get(connection.to);
    if (!from || !to) return [];
    const x1 = from.left + from.width / 2 - origin.left;
    const y1 = from.top + from.height / 2 - origin.top;
    const x2 = to.left + to.width / 2 - origin.left;
    const y2 = to.top + to.height / 2 - origin.top;
    const dx = x2 - x1,
      dy = y2 - y1;
    const source = Math.min(
      from.width / 2 / (Math.abs(dx) || 1),
      from.height / 2 / (Math.abs(dy) || 1),
    );
    const target = Math.min(
      to.width / 2 / (Math.abs(dx) || 1),
      to.height / 2 / (Math.abs(dy) || 1),
    );
    const start = { x: x1 + dx * source, y: y1 + dy * source };
    const end = { x: x2 - dx * target, y: y2 - dy * target };
    const offset = connection.kind === 'delegation' ? -18 : 18;
    const midX = (start.x + end.x) / 2 + offset;
    const midY = (start.y + end.y) / 2;
    // Route long, vertically aligned links around intervening mobile nodes.
    const sideX = connection.kind === 'delegation' ? 8 + index * 2 : origin.width - 8 - index * 2;
    const d =
      Math.abs(dx) < 10 && Math.abs(dy) > 150
        ? `M ${start.x} ${start.y} C ${sideX} ${start.y}, ${sideX} ${end.y}, ${end.x} ${end.y}`
        : `M ${start.x} ${start.y} Q ${midX} ${midY}, ${end.x} ${end.y}`;
    return [{ connection, d }];
  });
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (scene.value) observer.observe(scene.value);
  measure();
});
watch(layers, () => void nextTick(measure));
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <section class="contract-diagram" aria-label="Contract connections">
    <div ref="scene" class="diagram-scene">
      <svg class="diagram-lines" aria-hidden="true">
        <defs>
          <marker
            id="contract-delegation-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-amber)" />
          </marker>
          <marker
            id="contract-action-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--state-success)" />
          </marker>
        </defs>
        <path
          v-for="path in paths"
          :key="path.connection.kind + ':' + path.connection.from + ':' + path.connection.to"
          :d="path.d"
          :data-connection-kind="path.connection.kind"
          :marker-end="'url(#contract-' + path.connection.kind + '-arrow)'"
        >
          <title>{{ path.connection.descriptions.join('\n') }}</title>
        </path>
      </svg>
      <div
        v-for="(layer, index) in layers"
        :key="index"
        class="diagram-layer"
        :data-root="index === 0"
      >
        <button
          v-for="account in layer"
          :key="account"
          type="button"
          :data-account="account"
          :data-related="related.has(account)"
          :aria-pressed="selected === account"
          aria-controls="contract-account-details"
          :aria-description="descriptions(account) || 'No cross-contract permission link reported.'"
          :title="descriptions(account)"
          @click="emit('select', account)"
        >
          {{ account }}
        </button>
      </div>
    </div>
    <div class="diagram-legend">
      <span><i class="delegation-line" aria-hidden="true"></i> Delegates authority</span>
      <span><i class="action-line" aria-hidden="true"></i> Linked actions</span>
      <span v-if="related.size" class="related-caption"
        >Highlighted names share the selected authority</span
      >
    </div>
    <p>
      Click a contract to view its account details. Lines show reported permission links; accounts
      without a reported link remain separate.
    </p>
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
.diagram-scene {
  position: relative;
  padding: 28px 22px;
  display: grid;
  gap: 56px;
  background-image: radial-gradient(var(--line) 1px, transparent 1px);
  background-size: 20px 20px;
}
.diagram-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.diagram-lines > path {
  fill: none;
  stroke: var(--accent-amber);
  stroke-width: 1.5;
}
.diagram-lines > path[data-connection-kind='action'] {
  stroke: var(--state-success);
  stroke-dasharray: 5 5;
}
.diagram-layer {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  gap: 28px;
  justify-items: center;
}
.diagram-layer[data-root='true'] {
  grid-template-columns: minmax(0, 1fr);
}
.diagram-layer button {
  position: relative;
  min-width: 0;
  width: 100%;
  max-width: 200px;
  min-height: 48px;
  padding: 12px 16px;
  border: 1px solid var(--line-strong, var(--line));
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-secondary);
  box-shadow: none;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.diagram-layer button:hover,
.diagram-layer button[aria-pressed='true'] {
  color: var(--accent-amber);
  border-color: var(--accent-amber);
  transform: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-amber) 8%, transparent);
}
.diagram-layer button[data-related='true'] {
  border-color: var(--state-success);
}
.diagram-layer button:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 4px;
}
.diagram-legend {
  display: flex;
  gap: 12px 22px;
  flex-wrap: wrap;
  padding: 16px 22px 0;
  border-top: 1px solid var(--line);
  font-size: 0.75rem;
  color: var(--text-secondary);
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
.related-caption {
  color: var(--state-success);
}
.contract-diagram > p {
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--text-muted);
  padding: 0 22px;
  margin: 10px 0 16px;
}
</style>
