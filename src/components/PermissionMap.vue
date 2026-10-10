<script setup lang="ts">
import { computed } from 'vue';
import { Clock, Code, GitBranch, KeyRound } from '@lucide/vue';
import type { API } from '@wharfkit/antelope';
import type { ContractReading, permissionGraph } from '../content/contract-map';
import PermissionBranch from './PermissionBranch.vue';

const props = defineProps<{
  selected: ContractReading;
  graph: ReturnType<typeof permissionGraph>;
  account?: API.v1.AccountObject | undefined;
}>();
const focused = defineModel<string>({ required: true });
const node = computed(() => props.graph.nodes.find((node) => node.id === focused.value));
const highlighted = computed(
  () =>
    new Set(
      node.value
        ? [
            node.value.id,
            ...props.graph.edges
              .filter((edge) => edge.from === focused.value || edge.to === focused.value)
              .flatMap((edge) => [edge.from, edge.to]),
          ]
        : [],
    ),
);
</script>

<template>
  <div class="map-panel">
    <div class="map-heading"><h4>Permission tree</h4></div>
    <p class="map-explanation">
      <strong>Owner is the root; active is its child.</strong> Each row has its own threshold and
      contributors. A parent can satisfy a child’s minimum permission; a child does not gain its
      parent’s authority. Contract checks still apply.
    </p>
    <div class="tree-caption">
      <span>Select a permission or signer to follow its connections</span>
      <button v-if="focused" type="button" class="text-button" @click="focused = ''">
        Clear selection
      </button>
    </div>
    <div class="permission-viewport" role="region" aria-label="Permission map">
      <ul class="permission-roots" :aria-label="selected.account + ' permissions'">
        <PermissionBranch
          v-for="branch in graph.roots"
          :key="branch.permission.name"
          :branch="branch"
          :graph="graph"
          :account="account"
          :highlighted="highlighted"
          v-model="focused"
        />
      </ul>
    </div>
    <div class="map-legend">
      <span><KeyRound :size="14" aria-hidden="true" /> Signing key</span>
      <span><GitBranch :size="14" aria-hidden="true" /> Delegation</span>
      <span><Code :size="14" aria-hidden="true" /> Code authority</span>
      <span><Clock :size="14" aria-hidden="true" /> Delay</span>
      <span>Badge = threshold · +number = weight</span>
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
.map-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 20px 20px 0;
}
.map-heading h4 {
  font-size: 0.875rem;
  margin: 0;
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
.tree-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 12px;
  min-height: 44px;
  padding: 0 20px;
  border-top: 1px solid var(--line);
  font-size: 0.75rem;
  color: var(--text-muted);
}
.tree-caption button {
  font-size: 0.75rem;
  min-height: 44px;
}
.permission-viewport {
  padding: 0 20px 20px;
}
.permission-roots {
  list-style: none;
  padding: 0;
  margin: 0;
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
.map-empty {
  padding: 0 20px;
  color: var(--text-muted);
  font-size: 0.875rem;
}
button:focus-visible {
  outline: 2px solid var(--accent-amber);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .map-heading {
    padding: 16px 16px 0;
  }
  .map-explanation,
  .tree-caption {
    padding-left: 16px;
    padding-right: 16px;
  }
  .permission-viewport {
    padding: 0 12px 16px;
  }
}
</style>
