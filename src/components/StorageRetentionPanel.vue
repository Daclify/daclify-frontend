<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { ApiRoutes, type DaoRef, type UserMembership } from '@daclify/core-protocol';
import type { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoRef; member: UserMembership }>(),
  workspace = useWorkspace(),
  status = ref<z.infer<typeof ApiRoutes.curation.response>>(),
  keep = ref<string[]>([]),
  busy = ref(false),
  error = ref(''),
  page = ref(0),
  saved = ref(false);
let sequence = 0;
const visible = computed(
    () => status.value?.objects.slice(page.value * 25, page.value * 25 + 25) ?? [],
  ),
  selectedBytes = computed(
    () =>
      status.value?.objects.reduce(
        (n, o) => n + (keep.value.includes(o.id) ? BigInt(o.bytes) : 0n),
        0n,
      ) ?? 0n,
  ),
  fits = computed(
    () => !!status.value && selectedBytes.value <= BigInt(status.value.funding.pricing.freeBytes),
  );
async function load() {
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api.storageCuration(props.dao);
    if (request === sequence) {
      status.value = result;
      keep.value = result.objects.filter((o) => o.selected).map((o) => o.id);
      page.value = 0;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
async function save() {
  if (!status.value || busy.value || !fits.value) return;
  const request = ++sequence,
    dao = props.dao,
    generation = status.value.generation,
    selection = [...keep.value];
  busy.value = true;
  error.value = '';
  saved.value = false;
  try {
    const result = await api.storageRetain({ dao, generation, keep: selection });
    if (request === sequence) {
      status.value = result;
      keep.value = result.objects.filter((o) => o.selected).map((o) => o.id);
      saved.value = true;
    }
  } catch (cause) {
    if (request === sequence) error.value = friendlyError(cause);
  } finally {
    if (request === sequence) busy.value = false;
  }
}
watch(
  () =>
    JSON.stringify([
      props.dao,
      props.member.active,
      props.member.admin,
      props.member.memberId,
      workspace.account?.id,
    ]),
  () => {
    sequence++;
    status.value = undefined;
    keep.value = [];
    error.value = '';
    busy.value = false;
    saved.value = false;
    if (props.member.active && props.member.admin) void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section
    v-if="member.active && member.admin"
    class="panel"
    aria-labelledby="storage-retention-heading"
  >
    <h2 id="storage-retention-heading">Choose files to keep</h2>
    <p>
      Prioritize whole files for the free allowance if paid storage ends. Remaining space keeps
      newer files first. A shared CID counts once for your DAO.
    </p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="busy" role="status">Checking storage retention…</p>
    <p v-if="saved" role="status">Your file priorities were saved.</p>
    <template v-if="status"
      ><p>
        Selected {{ selectedBytes.toLocaleString() }} of
        {{ BigInt(status.funding.pricing.freeBytes).toLocaleString() }} free bytes.
        {{
          status.cleanup === 'disabled'
            ? 'Automatic deletion is disabled on this deployment.'
            : 'Qualified cleanup follows the original grace deadline.'
        }}
      </p>
      <p v-if="status.funding.graceEndsAt">
        Original grace deadline: {{ new Date(status.funding.graceEndsAt).toLocaleString() }}.
      </p>
      <p v-if="!fits" role="alert">Select fewer whole files to fit the free allowance.</p>
      <form @submit.prevent="save">
        <ul class="plain-list">
          <li v-for="object in visible" :key="object.id">
            <label class="choice"
              ><input
                v-model="keep"
                type="checkbox"
                :value="object.id"
                :disabled="busy || !!object.releasedAt"
              /><span
                ><code class="retention-cid">{{ object.cid }}</code
                ><br />{{ BigInt(object.bytes).toLocaleString() }} bytes ·
                {{ object.kinds.join(', ') }} ·
                {{
                  object.releasedAt
                    ? 'Hosting ended'
                    : object.retained
                      ? 'Within current retained allowance'
                      : 'Above current retained allowance'
                }}</span
              ></label
            >
          </li>
        </ul>
        <p v-if="!status.objects.length">No verified hosted files for this DAO.</p>
        <button class="secondary" type="button" :disabled="busy || page === 0" @click="page--">
          Previous files
        </button>
        <button
          class="secondary"
          type="button"
          :disabled="busy || (page + 1) * 25 >= status.objects.length"
          @click="page++"
        >
          Next files
        </button>
        <p><button :disabled="busy || !fits">Save free-allowance priorities</button></p>
      </form> </template
    ><button class="secondary" :disabled="busy" @click="load">Refresh file retention</button>
    <p class="field-help">
      Grace lasts 30 days from the original paid term end. Archiving does not stop normal IPFS
      storage billing. Hosting cleanup does not remove your on-chain rights, keys, balances or
      purchased RAM.
    </p>
    <RouterLink to="/docs/retention" class="help-link">Retention and recovery guide ↗</RouterLink>
  </section>
</template>
<style scoped>
.retention-cid {
  overflow-wrap: anywhere;
}
.choice {
  align-items: flex-start;
}
</style>
