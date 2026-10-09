<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MapPin, ArrowUpRight } from '@lucide/vue';
import type { PublicProfile } from '@daclify/core-protocol';
const props = defineProps<{
  profile?: PublicProfile | undefined;
  label: string;
  to: string;
  own?: boolean;
  badges?: string[];
  heading?: 'h2' | 'h3';
}>();
const failed = ref(false);
watch(
  () => props.profile?.avatar,
  () => {
    failed.value = false;
  },
);
const avatar = computed(() =>
  !failed.value && props.profile?.avatar
    ? `https://ipfs.io/ipfs/${props.profile.avatar}`
    : undefined,
);
</script>
<template>
  <RouterLink :to="to" class="person-card">
    <span class="person-avatar" aria-hidden="true"
      ><img
        v-if="avatar"
        :src="avatar"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        @error="failed = true"
      /><template v-else>{{
        (profile?.fullName || label).slice(0, 2).toUpperCase()
      }}</template></span
    >
    <div class="person-card-body">
      <div class="person-card-title">
        <component :is="heading ?? 'h2'">{{ profile?.fullName || label }}</component>
        <span v-if="own" class="pill success">You</span>
      </div>
      <p class="person-handle">{{ profile?.name ? '@' + profile.name : label }}</p>
      <p v-if="profile?.motto" class="person-motto">{{ profile.motto }}</p>
      <small v-if="profile?.location"><MapPin aria-hidden="true" />{{ profile.location }}</small>
      <div v-if="badges?.length" class="button-row">
        <span v-for="badge in badges" :key="badge" class="pill">{{ badge }}</span>
      </div>
    </div>
    <ArrowUpRight class="person-card-arrow" aria-hidden="true" />
  </RouterLink>
</template>
