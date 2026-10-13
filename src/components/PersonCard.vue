<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MapPin, ArrowUpRight } from '@lucide/vue';
import type { PublicProfile } from '@daclify/core-protocol';
import { profileContacts, type CommunityLink } from '../state/public-people';
import LastDaoActivity from './LastDaoActivity.vue';
const props = defineProps<{
  profile?: PublicProfile | undefined;
  label: string;
  to: string;
  own?: boolean;
  badges?: string[];
  heading?: 'h2' | 'h3';
  communities?: CommunityLink[];
  lastActive?: number | null | undefined;
}>();
const failed = ref(false);
const contacts = computed(() => profileContacts(props.profile));
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
  <article class="person-card">
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
        <component :is="heading ?? 'h2'"
          ><RouterLink class="person-profile-link" :to="to">{{
            profile?.fullName || label
          }}</RouterLink></component
        >
        <span v-if="own" class="pill success">You</span>
      </div>
      <p v-if="profile?.name" class="person-handle">@{{ profile.name }}</p>
      <p v-if="profile?.motto" class="person-motto">{{ profile.motto }}</p>
      <small v-if="profile?.location"><MapPin aria-hidden="true" />{{ profile.location }}</small>
      <div v-if="badges?.length" class="button-row">
        <span v-for="badge in badges" :key="badge" class="pill">{{ badge }}</span>
      </div>
      <div v-if="communities?.length" class="person-communities">
        <span class="person-section-label">{{
          communities.length === 1 ? 'Community' : 'Communities'
        }}</span>
        <div class="button-row">
          <RouterLink
            v-for="community in communities"
            :key="community.key"
            class="pill person-direct-link"
            :to="community.to"
            >{{ community.title }}<span v-if="!community.active"> · Inactive</span></RouterLink
          >
        </div>
      </div>
      <div v-if="contacts.length" class="person-contacts">
        <template v-for="contact in contacts.slice(0, 3)" :key="contact.key">
          <a
            v-if="contact.href"
            class="person-direct-link"
            :href="contact.href"
            :target="contact.key === 'email' ? undefined : '_blank'"
            rel="noopener noreferrer"
            >{{ contact.label
            }}<span v-if="contact.key !== 'email'" class="sr-only"> (opens in a new tab)</span></a
          >
          <span v-else>{{ contact.label }}</span>
        </template>
        <RouterLink v-if="contacts.length > 3" class="person-direct-link" :to="to"
          >{{ contacts.length - 3 }} more contact links</RouterLink
        >
      </div>
      <LastDaoActivity v-if="lastActive !== undefined" :last-active="lastActive" />
      <slot />
    </div>
    <ArrowUpRight class="person-card-arrow" aria-hidden="true" />
  </article>
</template>
