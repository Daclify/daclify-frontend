<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { ArrowUpRight } from '@lucide/vue';
import { DaoPresets, type DaoSummary, type Network } from '@daclify/core-protocol';
import { api } from '../api/client';
const props = defineProps<{ dao: DaoSummary; member: boolean; network: Network | undefined }>();
const images = ref<{ logo?: string; cover?: string }>({});
let revision = 0;
function clear() {
  for (const url of Object.values(images.value)) URL.revokeObjectURL(url);
  images.value = {};
}
function failed(slot: 'logo' | 'cover') {
  const url = images.value[slot];
  if (url) URL.revokeObjectURL(url);
  delete images.value[slot];
}
watch(
  () => JSON.stringify([props.dao.reference, props.dao.branding]),
  async () => {
    const generation = ++revision;
    clear();
    for (const slot of ['logo', 'cover'] as const) {
      if (!props.dao.branding?.[slot]) continue;
      try {
        const result = await api.brandImage(props.dao.reference.daoId, slot);
        if (generation !== revision) return;
        const bytes = Uint8Array.from(atob(result.content), (c) => c.charCodeAt(0));
        images.value[slot] = URL.createObjectURL(new Blob([bytes], { type: result.mediaType }));
      } catch {
        /* Unavailable or unsafe imagery retains the accessible card fallback. */
      }
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  revision++;
  clear();
});
</script>
<template>
  <RouterLink :to="`/dao/${dao.reference.daoId}`" class="dao-card">
    <div class="dao-cover" aria-hidden="true">
      <img
        v-if="images.cover"
        :src="images.cover"
        alt=""
        loading="lazy"
        @error="failed('cover')"
      /><span v-else class="cover-monogram">{{ dao.title.slice(0, 1).toUpperCase() }}</span>
    </div>
    <div class="dao-card-body">
      <div class="dao-card-top">
        <span class="dao-avatar" aria-hidden="true"
          ><img
            v-if="images.logo"
            :src="images.logo"
            alt=""
            loading="lazy"
            @error="failed('logo')"
          /><template v-else>{{ dao.title.slice(0, 2).toUpperCase() }}</template></span
        ><span class="pill">{{ dao.privacy === 'public' ? 'Public' : 'Encrypted documents' }}</span>
      </div>
      <h2>{{ dao.title }}</h2>
      <div class="button-row">
        <span class="pill">{{
          DaoPresets.find((p) => p.id === (dao.purpose ?? 'custom'))?.title
        }}</span
        ><span v-if="member" class="pill success">Member</span>
      </div>
      <p>
        {{
          dao.branding?.summary ||
          dao.description ||
          'A community workspace for decisions, contributions, and shared resources.'
        }}
      </p>
      <p v-if="dao.participantMode === 'agents-guarded'" class="field-help">
        Agents · human emergency controls
      </p>
      <div class="dao-card-context">
        <span>{{ network?.environment ?? 'Configured' }} network</span
        ><span
          >{{
            dao.reference.contract === network?.runtime ? 'Configured runtime' : 'Other runtime'
          }}
          · {{ dao.reference.contract }}</span
        >
      </div>
      <div class="dao-card-footer">
        <span>{{ dao.members }} members</span
        ><span class="card-action"
          >{{ member ? 'Open workspace' : 'View DAO' }} <ArrowUpRight aria-hidden="true"
        /></span>
      </div>
    </div>
  </RouterLink>
</template>
