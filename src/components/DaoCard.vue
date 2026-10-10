<script setup lang="ts">
import { computed, onUnmounted, ref, watch, type Component } from 'vue';
import {
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  Gamepad2,
  HandHeart,
  Network as NetworkIcon,
  Users,
} from '@lucide/vue';
import { DaoPresets, type DaoSummary, type Network } from '@daclify/core-protocol';
import { api } from '../api/client';
const props = defineProps<{ dao: DaoSummary; member: boolean; network: Network | undefined }>();
const purposeIcons = {
  community: Users,
  'ngo-grants': HandHeart,
  'gaming-guild': Gamepad2,
  team: BriefcaseBusiness,
  custom: NetworkIcon,
} satisfies Record<NonNullable<DaoSummary['purpose']>, Component>;
const purposeIcon = computed(() =>
  props.dao.participantMode === 'agents-guarded'
    ? Bot
    : purposeIcons[props.dao.purpose ?? 'custom'],
);
const initials = computed(() =>
  props.dao.title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase(),
);
const contextId = computed(
  () =>
    `dao-context-${props.dao.reference.chainId}-${props.dao.reference.contract}-${props.dao.reference.daoId}`,
);
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
  <RouterLink
    :to="`/dao/${dao.reference.daoId}`"
    class="dao-card"
    :aria-label="`${member ? 'Open' : 'View'} ${dao.title}`"
    :aria-describedby="contextId"
  >
    <div class="dao-cover" :class="{ 'dao-cover-fallback': !images.cover }" aria-hidden="true">
      <img v-if="images.cover" :src="images.cover" alt="" loading="lazy" @error="failed('cover')" />
      <template v-else>
        <svg
          class="cover-connections"
          viewBox="0 0 320 112"
          fill="none"
          preserveAspectRatio="xMidYMid slice"
        >
          <path d="M24 88L80 32L160 56L238 24L296 84M80 32L238 24M160 56L228 104" />
          <circle cx="24" cy="88" r="4" />
          <circle cx="80" cy="32" r="6" />
          <circle cx="238" cy="24" r="5" />
          <circle cx="296" cy="84" r="4" />
          <circle cx="228" cy="104" r="6" />
        </svg>
        <span class="cover-symbol"><component :is="purposeIcon" /></span>
      </template>
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
          /><template v-else>{{ initials }}</template></span
        >
        <span class="pill">{{ dao.privacy === 'public' ? 'Public' : 'Encrypted documents' }}</span>
      </div>
      <h3 class="dao-card-title">{{ dao.title }}</h3>
      <div class="dao-card-badges">
        <span class="pill">{{
          DaoPresets.find((p) => p.id === (dao.purpose ?? 'custom'))?.title
        }}</span
        ><span v-if="member" class="pill success">Member</span>
      </div>
      <p class="dao-card-description">
        {{
          dao.branding?.summary ||
          dao.description ||
          'A community workspace for decisions, contributions and shared resources.'
        }}
      </p>
      <p v-if="dao.participantMode === 'agents-guarded'" class="dao-card-mode">
        <Bot aria-hidden="true" />Agents · human emergency controls
      </p>
      <div :id="contextId" class="dao-card-context">
        <span class="sr-only">{{ network?.environment ?? 'Configured' }} network · </span
        ><span>{{ dao.reference.contract }}</span
        ><span>DAO {{ dao.reference.daoId }}</span>
      </div>
      <div class="dao-card-footer">
        <span class="dao-card-members"
          ><Users aria-hidden="true" />{{ dao.members.toLocaleString() }}
          {{ dao.members === 1 ? 'member' : 'members' }}</span
        ><span class="card-action"
          >{{ member ? 'Open workspace' : 'View DAO' }}<ArrowUpRight aria-hidden="true"
        /></span>
      </div>
    </div>
  </RouterLink>
</template>
