<script setup lang="ts">
import { computed } from 'vue';
import { Clock, Code, GitBranch, KeyRound, Shield } from '@lucide/vue';
import type { API } from '@wharfkit/antelope';
import {
  permissionActionLinks,
  type PermissionBranch,
  type PermissionNode,
  type permissionGraph,
} from '../content/contract-map';

const props = defineProps<{
  branch: PermissionBranch;
  graph: ReturnType<typeof permissionGraph>;
  account?: API.v1.AccountObject | undefined;
  highlighted: Set<string>;
  flat?: boolean;
  child?: boolean;
}>();
const focused = defineModel<string>({ required: true });
const permission = computed(() => props.branch.permission);
const id = computed(() => 'permission:' + permission.value.name);
const definition = computed(() => props.graph.nodes.find((node) => node.id === id.value));
const contributors = computed(() =>
  props.graph.edges
    .filter((edge) => edge.to === id.value && edge.kind !== 'hierarchy')
    .flatMap((edge) => {
      const node = props.graph.nodes.find((node) => node.id === edge.from);
      return node ? [{ node, weight: edge.weight }] : [];
    }),
);
const actionLinks = computed(() =>
  permissionActionLinks(permission.value, props.account?.permissions),
);
function icon(kind: PermissionNode['kind']) {
  return kind === 'key' ? KeyRound : kind === 'code' ? Code : kind === 'wait' ? Clock : GitBranch;
}
function contributorName(node: PermissionNode) {
  return (
    (node.kind === 'key'
      ? 'Public key '
      : node.kind === 'code'
        ? 'Code authority '
        : node.kind === 'account'
          ? 'Delegated permission '
          : '') + node.label
  );
}
</script>

<template>
  <li class="authority-branch" :data-edge-kind="child && !flat ? 'hierarchy' : undefined">
    <article
      class="permission-row"
      :aria-label="'Permission ' + permission.name"
      :data-related="!!focused && highlighted.has(id)"
      :data-focused="focused === id"
    >
      <div class="permission-identity">
        <button
          type="button"
          class="permission-select"
          :aria-label="definition?.label"
          :title="definition?.detail"
          :aria-pressed="focused === id"
          @click="focused = id"
        >
          <Shield :size="18" aria-hidden="true" />
          <strong>{{ permission.name }}</strong>
          <span class="threshold" :title="'Threshold ' + permission.threshold">
            <span class="sr-only">Threshold </span>{{ permission.threshold }}
          </span>
        </button>
        <small class="permission-parent">{{
          permission.parent ? 'Parent: ' + permission.parent : 'Root authority'
        }}</small>
      </div>
      <ul class="inline-contributors" :aria-label="permission.name + ' contributors'">
        <li v-for="contributor in contributors" :key="contributor.node.id">
          <button
            type="button"
            class="contributor-select"
            :data-kind="contributor.node.kind"
            :data-edge-kind="contributor.node.kind"
            :data-focused="focused === contributor.node.id"
            :aria-label="contributorName(contributor.node)"
            :aria-pressed="focused === contributor.node.id"
            :title="contributor.node.detail + ' · weight ' + contributor.weight"
            @click="focused = contributor.node.id"
          >
            <span class="signer-weight"
              ><span class="sr-only">Weight </span>+{{ contributor.weight }}</span
            >
            <component :is="icon(contributor.node.kind)" :size="16" aria-hidden="true" />
            <span class="signer-label">{{ contributor.node.label }}</span>
          </button>
        </li>
        <li v-if="!contributors.length" class="no-contributors">No contributors returned</li>
      </ul>
      <div v-if="actionLinks?.length" class="linked-actions" aria-label="Reported linked actions">
        <small>Linked actions</small>
        <code v-for="link in actionLinks.slice(0, 3)" :key="link">{{ link }}</code>
        <details v-if="actionLinks.length > 3" class="more-actions">
          <summary>{{ actionLinks.length - 3 }} more actions</summary>
          <ul
            class="action-link-list"
            :aria-label="'More linked actions for ' + permission.name"
            tabindex="0"
          >
            <li v-for="link in actionLinks.slice(3)" :key="link">
              <code>{{ link }}</code>
            </li>
          </ul>
        </details>
      </div>
    </article>
    <ul
      v-if="!flat && branch.children.length"
      class="permission-children"
      :aria-label="'Children of ' + permission.name"
    >
      <PermissionBranch
        v-for="branchChild in branch.children"
        :key="branchChild.permission.name"
        :branch="branchChild"
        :graph="graph"
        :account="account"
        :highlighted="highlighted"
        child
        v-model="focused"
      />
    </ul>
  </li>
</template>

<style scoped>
.authority-branch {
  position: relative;
  min-width: 0;
  margin-top: 12px;
  list-style: none;
}
.permission-row {
  display: grid;
  grid-template-columns: 158px minmax(0, 1fr);
  gap: 8px 16px;
  align-items: start;
  padding: 10px 14px;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-md);
  background: linear-gradient(115deg, var(--surface-soft), transparent 65%), var(--surface-raised);
}
.permission-row[data-related='true'] {
  border-color: var(--accent-amber);
}
.permission-row[data-focused='true'] {
  box-shadow: inset 3px 0 var(--accent-amber);
}
.permission-identity {
  min-width: 0;
}
.permission-select,
.contributor-select {
  width: 100%;
  min-height: 44px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  box-shadow: none;
  transform: none;
  text-align: left;
  justify-content: start;
}
.permission-select {
  padding: 8px 4px;
  gap: 8px;
  color: var(--text-primary);
  font-size: 0.875rem;
}
.permission-select > svg {
  flex-shrink: 0;
  color: var(--accent-amber);
}
.permission-select strong {
  overflow-wrap: anywhere;
}
.threshold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  padding: 2px 6px;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--accent-amber);
  background: var(--accent-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.permission-parent {
  display: block;
  padding: 0 4px 4px;
  color: var(--text-muted);
  font-size: 0.6875rem;
  overflow-wrap: anywhere;
}
.inline-contributors {
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.contributor-select {
  display: grid;
  grid-template-columns: 32px 16px minmax(0, 1fr);
  gap: 10px;
  padding: 9px 8px;
  color: var(--accent-amber);
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1.6;
}
.signer-weight {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.signer-label {
  font-family: var(--font-mono, ui-monospace, monospace);
  overflow-wrap: anywhere;
}
.contributor-select[data-kind='code'] {
  color: var(--state-success);
}
.contributor-select[data-kind='account'],
.contributor-select[data-kind='wait'] {
  color: var(--text-secondary);
}
.contributor-select[data-focused='true'],
.permission-select[aria-pressed='true'] {
  background: var(--accent-soft);
  border-color: var(--accent-amber);
}
.contributor-select:hover,
.permission-select:hover {
  background: var(--surface-soft);
  border-color: var(--border-control);
  box-shadow: none;
  transform: none;
}
.linked-actions {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 0 8px 4px;
  min-width: 0;
}
.linked-actions small,
.no-contributors {
  color: var(--text-muted);
  font-size: 0.6875rem;
}
.linked-actions code {
  font-size: 0.75rem;
  color: var(--state-success);
  background: var(--state-success-bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  overflow-wrap: anywhere;
}
.more-actions {
  width: 100%;
  min-width: 0;
}
.more-actions summary {
  min-height: 44px;
  padding: 12px 0;
  color: var(--accent-amber);
  font-size: 0.75rem;
  cursor: pointer;
}
.action-link-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  padding: 8px 4px;
  margin: 0;
  max-height: 260px;
  overflow: auto;
}
.action-link-list li {
  min-width: 0;
  max-width: 100%;
}
.action-link-list code {
  display: block;
}
.no-contributors {
  padding: 14px 8px;
}
.permission-children {
  margin: 0 0 0 18px;
  padding: 0 0 0 26px;
  border-left: 1px solid var(--border-control);
  list-style: none;
}
.authority-branch[data-edge-kind='hierarchy']::before {
  content: '';
  position: absolute;
  top: 32px;
  left: -27px;
  width: 26px;
  height: 12px;
  border-left: 1px solid var(--border-control);
  border-bottom: 1px solid var(--border-control);
  border-bottom-left-radius: 8px;
}
button:focus-visible,
summary:focus-visible,
.action-link-list:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 3px;
}
@media (min-width: 1100px) {
  .permission-row:has(.linked-actions) {
    grid-template-columns: 158px minmax(0, 1fr) minmax(0, 240px);
  }
  .linked-actions {
    grid-column: 3;
    grid-row: 1;
    align-self: center;
  }
}
@media (max-width: 720px) {
  .permission-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 10px;
  }
  .permission-identity {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0 10px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 6px;
  }
  .permission-select {
    width: auto;
  }
  .linked-actions {
    grid-column: 1;
  }
  .permission-children {
    margin-left: 8px;
    padding-left: 12px;
  }
  .authority-branch[data-edge-kind='hierarchy']::before {
    left: -13px;
    width: 12px;
  }
  .contributor-select {
    grid-template-columns: 24px 16px minmax(0, 1fr);
    gap: 6px;
    padding: 9px 4px;
  }
}
</style>
