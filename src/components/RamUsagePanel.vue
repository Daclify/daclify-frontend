<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { ApiRoutes, type DaoRef, type UserMembership } from '@daclify/core-protocol';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoRef; member: UserMembership }>(),
  workspace = useWorkspace(),
  usage = ref<z.infer<typeof ApiRoutes.ramUsage.response>>(),
  busy = ref(false),
  error = ref('');
let sequence = 0;
const bytes = (value: string) => `${BigInt(value).toLocaleString()} bytes`;
async function refresh() {
  const request = ++sequence;
  usage.value = undefined;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.ramUsage(props.dao);
    if (request === sequence) usage.value = result;
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
watch(
  () =>
    JSON.stringify([props.dao, props.member.memberId, props.member.active, workspace.account?.id]),
  () => {
    sequence++;
    usage.value = undefined;
    error.value = '';
    busy.value = false;
    if (props.member.active) void refresh();
  },
  { immediate: true },
);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section class="panel narrow" aria-labelledby="ram-heading">
    <h2 id="ram-heading">Blockchain RAM</h2>
    <p>
      RAM pays for live contract records across core and installed modules. IPFS storage has a
      separate allowance. Purchased RAM is permanent and reusable after pruning.
    </p>
    <p v-if="busy" role="status">Reading contract RAM…</p>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <template v-if="usage">
      <p v-if="usage.totalObservedBytes !== null" role="status">
        <strong>{{ bytes(usage.totalObservedBytes) }}</strong> recorded for this DAO across its
        payer contracts.
      </p>
      <p v-else class="notice" role="status">
        A complete DAO RAM total is unavailable.
        {{
          usage.observation === 'disabled'
            ? 'DAO-level observation is disabled on this deployment.'
            : 'At least one payer does not match its approved accounting source.'
        }}
      </p>
      <p>
        <strong>{{ bytes(usage.purchasedBytes) }}</strong> credited by settled RAM purchases.
      </p>
      <ul class="plain-list">
        <li v-for="payer in usage.payers" :key="payer.payer">
          <h3>
            {{
              payer.moduleId ?? (payer.payer === dao.contract ? 'Core runtime' : 'Contract payer')
            }}
            · {{ payer.payer }}
          </h3>
          <p v-if="!payer.sourceVerified" class="notice">
            This contract does not match its approved accounting source. Recorded counters may be
            incomplete.
          </p>
          <p v-if="payer.usage">
            Identity and recovery {{ bytes(payer.usage.identity) }} · activity
            {{ bytes(payer.usage.activity) }} · retained records {{ bytes(payer.usage.retained) }} ·
            platform category {{ bytes(payer.usage.platform) }}.
          </p>
          <p>Purchased credit {{ bytes(payer.purchasedBytes) }}.</p>
          <details>
            <summary>Whole payer account</summary>
            <p>
              {{ bytes(payer.globalUsedBytes) }} used ·
              {{
                payer.globalQuotaBytes === null
                  ? 'No finite quota reported'
                  : bytes(payer.globalQuotaBytes) + ' total quota'
              }}.
            </p>
            <p class="field-help">
              These figures include other DAOs, code, permissions and shared infrastructure. They
              are not this DAO’s remaining allowance.
            </p>
          </details>
        </li>
      </ul>
      <p v-if="usage.policy" class="field-help">
        Configured policy budgets {{ bytes(usage.policy.includedActivityBytes) }} activity and
        {{ bytes(usage.policy.identityBytesPerSlot) }} per approved member slot. These values do not
        prove a funded allocation.
      </p>
      <p class="field-help">
        Live account reads completed {{ new Date(usage.read.completedAt).toLocaleString() }}. They
        are not an atomic billing snapshot.
      </p>
    </template>
    <button class="secondary" :disabled="busy" @click="refresh">Refresh RAM usage</button>
    <p class="field-help">
      Funded pools, protected completion reserves and quota enforcement are still being qualified.
      This screen cannot purchase RAM yet. Hosting arrears do not sell purchased RAM or erase
      financial and recovery records.
    </p>
    <RouterLink to="/docs/documents" class="help-link">RAM and storage guide ↗</RouterLink>
  </section>
</template>
