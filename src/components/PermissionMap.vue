<script setup lang="ts">
import { computed, ref } from 'vue';
import { Code, GitBranch, KeyRound, List, Network, Shield, ZoomIn, ZoomOut } from '@lucide/vue';
import type {
  ContractReading,
  PermissionEdge,
  PermissionNode,
  permissionGraph,
} from '../content/contract-map';
const props = defineProps<{
  selected: ContractReading;
  graph: ReturnType<typeof permissionGraph>;
}>();
const focused = defineModel<string>({ required: true });
const selected = computed(() => props.selected),
  graph = computed(() => props.graph);
const node = computed(() => graph.value.nodes.find((n) => n.id === focused.value));
const view = ref<'map' | 'list'>('map'),
  zoom = ref(1),
  viewport = ref<HTMLElement>();
const highlighted = computed(
  () =>
    new Set(
      node.value
        ? [
            node.value.id,
            ...graph.value.edges
              .filter((e) => e.from === node.value?.id || e.to === node.value?.id)
              .flatMap((e) => [e.from, e.to]),
          ]
        : graph.value.nodes.map((n) => n.id),
    ),
);
function icon(kind: PermissionNode['kind']) {
  return kind === 'key'
    ? KeyRound
    : kind === 'code'
      ? Code
      : kind === 'permission'
        ? Shield
        : GitBranch;
}
function nodeName(value: PermissionNode) {
  return value.kind === 'key'
    ? 'Public key ' + value.label
    : value.kind === 'account'
      ? 'Delegated permission ' + value.label
      : value.kind === 'code'
        ? 'Code authority ' + value.label
        : value.label;
}
function edgeMiddle(edge: PermissionEdge) {
  const from = graph.value.nodes.find((n) => n.id === edge.from),
    to = graph.value.nodes.find((n) => n.id === edge.to);
  return ((from?.y ?? 0) + (to?.y ?? 0)) / 2 + 40;
}
function edgePath(edge: PermissionEdge) {
  const from = graph.value.nodes.find((n) => n.id === edge.from),
    to = graph.value.nodes.find((n) => n.id === edge.to);
  if (!from || !to) return '';
  if (edge.kind === 'hierarchy')
    return `M ${from.x + 300} ${from.y + 40} C 744 ${from.y + 40}, 744 ${to.y + 40}, ${to.x + 300} ${to.y + 40}`;
  return `M ${from.x + 300} ${from.y + 40} C 355 ${from.y + 40}, 355 ${to.y + 40}, ${to.x} ${to.y + 40}`;
}
function fitMap() {
  zoom.value = Math.max(0.5, Math.min(1, (viewport.value?.clientWidth ?? 760) / graph.value.width));
}
</script>
<template>
  <div class="map-panel">
    <div class="map-heading">
      <div>
        <p class="eyebrow">PERMISSION MAP</p>
        <h3>{{ selected.account }}</h3>
      </div>
      <div class="view-switch" role="group" aria-label="Authority view">
        <button
          type="button"
          :aria-pressed="view === 'map'"
          aria-label="Map view"
          @click="view = 'map'"
        >
          <Network :size="16" aria-hidden="true" /> Map
        </button>
        <button
          type="button"
          :aria-pressed="view === 'list'"
          aria-label="List view"
          @click="view = 'list'"
        >
          <List :size="16" aria-hidden="true" /> List
        </button>
      </div>
    </div>
    <p class="map-explanation">
      <strong>Owner is the root; active is its child.</strong> Each has its own keys or delegated
      authorities. A parent can satisfy a child’s minimum permission; a child does not gain its
      parent’s authority. Contract checks still apply.
    </p>
    <div v-show="view === 'map'">
      <div class="map-tools">
        <span>Scroll to pan · select a node</span>
        <div role="group" aria-label="Map zoom">
          <button
            type="button"
            class="text-button"
            aria-label="Zoom out"
            :disabled="zoom <= 0.5"
            @click="zoom = Math.max(0.5, zoom - 0.1)"
          >
            <ZoomOut :size="18" aria-hidden="true" /></button
          ><span>{{ Math.round(zoom * 100) }}%</span
          ><button
            type="button"
            class="text-button"
            aria-label="Zoom in"
            :disabled="zoom >= 1.5"
            @click="zoom = Math.min(1.5, zoom + 0.1)"
          >
            <ZoomIn :size="18" aria-hidden="true" /></button
          ><button type="button" class="text-button" @click="fitMap">Fit</button>
        </div>
      </div>
      <div
        ref="viewport"
        class="map-viewport"
        role="region"
        aria-label="Permission map"
        tabindex="0"
      >
        <div :style="{ width: graph.width * zoom + 'px', height: graph.height * zoom + 'px' }">
          <div
            class="map-scene"
            :style="{
              width: graph.width + 'px',
              height: graph.height + 'px',
              transform: 'scale(' + zoom + ')',
            }"
          >
            <span class="lane-label" style="left: 24px">AUTHORITY CONTRIBUTORS</span
            ><span class="lane-label" style="left: 390px">ACCOUNT PERMISSIONS</span>
            <svg :width="graph.width" :height="graph.height" aria-hidden="true" class="map-edges">
              <defs>
                <marker
                  id="contract-authority-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
                </marker>
              </defs>
              <g
                v-for="(edge, index) in graph.edges"
                :key="index"
                :class="{
                  'edge-dimmed': node && edge.from !== node.id && edge.to !== node.id,
                }"
              >
                <path
                  :d="edgePath(edge)"
                  :data-edge-kind="edge.kind"
                  marker-end="url(#contract-authority-arrow)"
                />
                <text
                  v-if="
                    focused &&
                    edge.kind !== 'hierarchy' &&
                    (edge.from === focused || edge.to === focused)
                  "
                  x="357"
                  :y="edgeMiddle(edge)"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  class="edge-weight"
                >
                  {{ edge.weight }}
                </text>
              </g>
            </svg>
            <button
              v-for="item in graph.nodes"
              :key="item.id"
              type="button"
              class="map-node"
              :data-kind="item.kind"
              :data-focused="focused === item.id"
              :class="{ 'node-dimmed': !highlighted.has(item.id) }"
              :style="{ left: item.x + 'px', top: item.y + 'px' }"
              :aria-label="nodeName(item)"
              :aria-pressed="focused === item.id"
              @click="focused = item.id"
            >
              <component :is="icon(item.kind)" :size="20" aria-hidden="true" /><span
                ><strong>{{ item.label }}</strong
                ><small>{{ item.detail }}</small></span
              >
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-show="view === 'list'"
      class="permission-list"
      role="region"
      aria-label="Permission list"
    >
      <div
        v-for="permission in selected.permissions"
        :key="permission.name"
        class="list-permission"
      >
        <button
          type="button"
          class="list-select"
          :aria-pressed="focused === 'permission:' + permission.name"
          @click="focused = 'permission:' + permission.name"
        >
          <Shield :size="18" aria-hidden="true" /><strong
            >{{ selected.account }}@{{ permission.name }}</strong
          ><span>Threshold {{ permission.threshold }}</span>
        </button>
        <p>{{ permission.parent ? 'Parent: ' + permission.parent : 'Root permission' }}</p>
        <ul>
          <li
            v-for="edge in graph.edges.filter(
              (e) => e.to === 'permission:' + permission.name && e.kind !== 'hierarchy',
            )"
            :key="edge.from"
          >
            <button type="button" class="list-authority" @click="focused = edge.from">
              {{ graph.nodes.find((n) => n.id === edge.from)?.label }}
              <span>Weight {{ edge.weight }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
    <div class="map-legend">
      <span><i class="legend-hierarchy"></i> Parent → child</span
      ><span><i class="legend-key"></i> Signing key</span
      ><span><i class="legend-account"></i> Delegation</span
      ><span><i class="legend-code"></i> Code authority</span
      ><span><i class="legend-wait"></i> Delay</span>
      <span>Numbers show weight</span>
    </div>
    <p v-if="!selected.permissions.length" class="map-empty">
      Public permissions were not returned for this contract. Refresh status to try again.
    </p>
  </div>
</template>
<style scoped>
.map-panel {
  min-width: 0;
  background: var(--surface-panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}
.map-heading,
.map-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.map-heading {
  padding: 20px 20px 0;
}
.map-heading .eyebrow {
  font-size: 0.6875rem;
  margin: 0 0 6px;
}
.map-heading h3 {
  font-size: 1.125rem;
  margin: 0;
}
.view-switch {
  display: flex;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  gap: 3px;
}
.view-switch button {
  padding: 8px 12px;
  min-height: 44px;
  background: transparent;
  color: var(--text-secondary);
  border: 0;
  box-shadow: none;
  font-size: 0.8125rem;
}
.view-switch button[aria-pressed='true'] {
  background: var(--surface-raised);
  color: var(--accent-amber);
}
.map-explanation {
  padding: 0 20px;
  color: var(--text-muted);
  font-size: 0.8125rem;
  line-height: 1.6;
  margin: 16px 0;
}
.map-explanation strong {
  color: var(--text-secondary);
}
.map-tools {
  padding: 0 16px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  gap: 4px;
}
.map-tools > span {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.map-tools > div {
  display: flex;
  gap: 3px;
  align-items: center;
  font-size: 0.75rem;
}
.map-tools button {
  min-width: 44px;
  min-height: 44px;
  padding: 8px;
}
.map-viewport {
  overflow: auto;
  max-height: 520px;
  background: var(--accent-soft);
}
.map-scene {
  position: relative;
  transform-origin: top left;
}
.lane-label {
  position: absolute;
  top: 24px;
  font-size: 11px;
  letter-spacing: 0.8px;
  color: var(--text-muted);
}
.map-edges {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.map-edges path[data-edge-kind] {
  stroke-width: 1.8px;
  fill: none;
  stroke: var(--accent-amber);
}
.map-edges path[data-edge-kind='hierarchy'] {
  stroke: var(--text-secondary);
}
.map-edges path[data-edge-kind='account'] {
  stroke: var(--text-muted);
  stroke-dasharray: 5 4;
}
.map-edges path[data-edge-kind='code'] {
  stroke: var(--state-success);
  stroke-dasharray: 3 3;
}
.map-edges path[data-edge-kind='wait'] {
  stroke: var(--state-danger);
  stroke-dasharray: 2 5;
}
.edge-dimmed {
  opacity: 0.18;
}
.edge-weight {
  fill: var(--text-primary);
  font-size: 12px;
  stroke: var(--surface-raised);
  stroke-width: 6px;
  paint-order: stroke;
  stroke-linejoin: round;
}
.map-node {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 300px;
  height: 80px;
  padding: 14px;
  text-align: left;
  background: var(--surface-raised);
  color: var(--text-primary);
  border: 1px solid var(--border-control);
  box-shadow: none;
  border-radius: var(--radius-md);
}
.map-node:hover {
  transform: none;
  box-shadow: none;
  border-color: var(--accent-amber);
}
.map-node > svg {
  flex-shrink: 0;
  color: var(--accent-amber);
}
.map-node[data-kind='code'] > svg {
  color: var(--state-success);
}
.map-node[data-kind='permission'] > svg {
  color: var(--text-secondary);
}
.map-node[data-focused='true'] {
  border: 2px solid var(--accent-amber);
  background: var(--surface-panel);
}
.map-node span {
  min-width: 0;
}
.map-node strong {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 600;
}
.map-node small {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
  margin-top: 8px;
}
.node-dimmed {
  opacity: 0.5;
}
.node-dimmed:focus-visible,
.node-dimmed:hover {
  opacity: 1;
}
.map-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  padding: 14px 20px;
  font-size: 0.6875rem;
  color: var(--text-muted);
  border-top: 1px solid var(--line);
}
.map-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.map-legend i {
  width: 16px;
  border-top: 2px solid var(--text-secondary);
}
.map-legend .legend-key {
  border-color: var(--accent-amber);
}
.map-legend .legend-account {
  border-color: var(--text-muted);
  border-top-style: dashed;
}
.map-legend .legend-code {
  border-color: var(--state-success);
  border-top-style: dashed;
}
.map-legend .legend-wait {
  border-color: var(--state-danger);
  border-top-style: dotted;
}
.map-empty {
  padding: 0 20px;
  color: var(--text-muted);
  font-size: 0.875rem;
}
.permission-list {
  padding: 0 20px 20px;
}
.list-permission {
  padding: 14px 0;
  border-top: 1px solid var(--line);
}
.list-select {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: var(--surface-soft);
  color: var(--text-primary);
  border: 1px solid var(--border-control);
  box-shadow: none;
  min-height: 44px;
  padding: 12px;
  font-size: 0.8125rem;
}
.list-select strong {
  min-width: 0;
  overflow-wrap: anywhere;
}
.list-select span {
  color: var(--text-muted);
  font-weight: 400;
  margin-left: auto;
}
.list-select[aria-pressed='true'] {
  border-color: var(--accent-amber);
}
.list-permission p {
  margin: 10px 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.list-permission ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.list-authority {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  background: transparent;
  color: var(--text-secondary);
  border: 0;
  box-shadow: none;
  text-align: left;
  min-height: 44px;
  font-size: 0.75rem;
  font-weight: 400;
  padding: 10px 8px;
  overflow-wrap: anywhere;
}
.list-authority span {
  color: var(--text-muted);
}
button:focus-visible,
.map-viewport:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .map-heading {
    padding: 16px 16px 0;
  }
  .map-explanation {
    padding: 0 16px;
  }
  .map-tools > span {
    flex-basis: 100%;
    padding-top: 10px;
  }
}
</style>
