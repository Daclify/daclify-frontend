<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { PublicProfileSchema, type PublicProfile, IdSchema } from '@daclify/core-protocol';
import { MapPin, Globe, AtSign, ArrowLeft, UserRoundPen } from '@lucide/vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import Account from './Account.vue';
const route = useRoute(),
  state = useWorkspace(),
  profile = ref<PublicProfile>(),
  error = ref(''),
  busy = ref(false),
  memberNative = ref(''),
  exists = ref(false),
  editing = ref(false),
  profileRevision = ref(0);
const failedImages = ref({ avatar: false, background: false });
const selfRoute = computed(() => route.path === '/users/me');
const identity = computed(() =>
  selfRoute.value
    ? state.memberships[0]
    : state.memberships.find(
        (member) =>
          member.dao.daoId === route.params.daoId &&
          member.memberId === route.params.memberId &&
          member.dao.chainId === state.network?.chainId &&
          member.dao.contract === state.network.runtime,
      ),
);
const own = computed(() => !!state.account && (selfRoute.value || !!identity.value));
const daoId = computed(() =>
  selfRoute.value
    ? identity.value?.dao.daoId
    : typeof route.params.daoId === 'string'
      ? route.params.daoId
      : undefined,
);
const memberId = computed(() =>
  selfRoute.value
    ? identity.value?.memberId
    : typeof route.params.memberId === 'string'
      ? route.params.memberId
      : undefined,
);
const dao = computed(() =>
  state.daos.find(
    (item) =>
      item.reference.daoId === daoId.value &&
      item.reference.contract === state.network?.runtime &&
      item.reference.chainId === state.network.chainId,
  ),
);
let generation = 0,
  disposed = false;
watch(
  () =>
    JSON.stringify([
      state.network?.chainId,
      state.network?.runtime,
      state.account?.id,
      daoId.value,
      memberId.value,
      profileRevision.value,
    ]),
  async () => {
    const request = ++generation;
    profile.value = undefined;
    failedImages.value = { avatar: false, background: false };
    error.value = '';
    exists.value = false;
    memberNative.value = '';
    editing.value = false;
    busy.value = true;
    try {
      if (!daoId.value || !memberId.value) {
        exists.value = selfRoute.value;
        return;
      }
      const d = IdSchema.parse(daoId.value),
        m = IdSchema.parse(memberId.value);
      const people = await api.contentPage(d, {
        documents: 'done',
        keyGrants: 'done',
        epochs: 'done',
        members: m,
      });
      if (disposed || request !== generation) return;
      const row = people.members.find((person) => person.id === m);
      if (!row) return;
      exists.value = true;
      memberNative.value = row.native_account;
      if (own.value) {
        const stored = await api.memberProfile(d, m);
        if (disposed || request !== generation) return;
        profile.value = stored.profile
          ? PublicProfileSchema.parse(JSON.parse(stored.profile))
          : undefined;
      } else {
        const page = await api.people({ daoId: d, memberId: m });
        if (disposed || request !== generation) return;
        profile.value = page.profiles.find((person) => person.memberId === m)?.profile;
      }
    } catch (cause) {
      if (request === generation) error.value = friendlyError(cause);
    } finally {
      if (request === generation) busy.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
const title = computed(
  () =>
    profile.value?.fullName ||
    profile.value?.name ||
    (own.value ? 'Your profile' : `Member ${memberId.value ?? ''}`),
);
const links = computed(() =>
  (['website', 'facebook', 'instagram', 'youtube', 'linkedin'] as const).flatMap((key) => {
    const url = profile.value?.[key];
    return url ? [{ key, url }] : [];
  }),
);
function saved() {
  profileRevision.value++;
  void state.refresh();
  editing.value = false;
}
</script>
<template>
  <RouterLink class="help-link" to="/users"><ArrowLeft aria-hidden="true" />All users</RouterLink>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="busy" role="status">Loading profile…</p>
  <Account v-else-if="selfRoute && !state.account" />
  <template v-else-if="exists || own">
    <section class="profile-hero">
      <div class="profile-cover">
        <img
          v-if="profile?.background && !failedImages.background"
          :src="`https://ipfs.io/ipfs/${profile.background}`"
          alt=""
          referrerpolicy="no-referrer"
          @error="failedImages.background = true"
        />
      </div>
      <div class="profile-identity">
        <span class="person-avatar large"
          ><img
            v-if="profile?.avatar && !failedImages.avatar"
            :src="`https://ipfs.io/ipfs/${profile.avatar}`"
            alt=""
            referrerpolicy="no-referrer"
            @error="failedImages.avatar = true"
          /><template v-else>{{ title.slice(0, 2).toUpperCase() }}</template></span
        >
        <div>
          <p class="eyebrow">{{ own ? 'YOUR PUBLIC PROFILE' : 'PUBLIC PROFILE' }}</p>
          <h1>{{ title }}</h1>
          <p v-if="profile?.name" class="person-handle">@{{ profile.name }}</p>
        </div>
        <button
          v-if="own"
          type="button"
          class="secondary"
          :aria-expanded="editing"
          @click="editing = !editing"
        >
          <UserRoundPen aria-hidden="true" />{{
            editing ? 'Close account settings' : 'Edit profile & account'
          }}
        </button>
      </div>
      <p v-if="profile?.motto" class="lead">{{ profile.motto }}</p>
      <p v-if="profile?.introduction" class="profile-introduction">{{ profile.introduction }}</p>
      <p v-if="!profile" class="muted">
        {{
          own
            ? 'Publish your profile to introduce yourself.'
            : 'This member has not published a profile.'
        }}
      </p>
      <div class="profile-facts">
        <span v-if="profile?.location"><MapPin aria-hidden="true" />{{ profile.location }}</span
        ><a
          v-for="link in links"
          :key="link.key"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          ><Globe aria-hidden="true" />{{ link.key }}</a
        ><span v-if="profile?.telegram"><AtSign aria-hidden="true" />{{ profile.telegram }}</span>
      </div>
      <p v-if="profile?.email" class="muted">Public contact: {{ profile.email }}</p>
    </section>
    <section v-if="dao" class="panel">
      <h2>DAO context</h2>
      <RouterLink :to="`/dao/${dao.reference.daoId}/members`"
        >{{ dao.title }} · member {{ memberId }}</RouterLink
      >
      <p v-if="memberNative">
        On-chain governance account: <span class="mono">{{ memberNative }}</span>
      </p>
      <p class="field-help">
        This is a public member record. Private sign-in pairings are not displayed.
      </p>
    </section>
    <Account
      v-if="own && editing"
      embedded
      :profile-dao-id="daoId"
      :profile-member-id="memberId"
      @profile-updated="saved"
    />
  </template>
  <section v-else class="empty-state">
    <h1>User unavailable</h1>
    <p>Check this member's DAO or browse published profiles.</p>
    <RouterLink to="/users">Browse users</RouterLink>
  </section>
</template>
