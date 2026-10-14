<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  type PublicProfile,
  type PublicMember,
  IdSchema,
  unifyPublicMembers,
} from '@daclify/core-protocol';
import { MapPin, Globe, AtSign, ArrowLeft, UserRoundPen } from '@lucide/vue';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import Account from './Account.vue';
import { usePublicDirectory, profileContacts } from '../state/public-people';
import LastDaoActivity from '../components/LastDaoActivity.vue';
import { vaultUnlocked, logoutAccount } from '../auth/session';
import { readProfileForAudience } from '../auth/profile';
import { decodeRawNativeProfile } from '@daclify/core-protocol/profiles';
const route = useRoute(),
  state = useWorkspace(),
  profile = ref<PublicProfile>(),
  error = ref(''),
  busy = ref(false),
  memberNative = ref(''),
  memberActive = ref(false),
  exists = ref(false),
  editing = ref(false),
  profileRevision = ref(0),
  publicMember = ref<PublicMember>();
const privateNotice = ref('');
const signingOut = ref(false),
  signOutError = ref('');
async function logout() {
  signingOut.value = true;
  signOutError.value = '';
  try {
    await logoutAccount();
  } catch (cause) {
    signOutError.value = friendlyError(cause);
  } finally {
    signingOut.value = false;
  }
}
const directory = usePublicDirectory();
const user = computed(() =>
  unifyPublicMembers([
    ...directory.people.value,
    ...(publicMember.value ? [publicMember.value] : []),
  ]).find((person) =>
    person.memberships.some(
      (member) =>
        member.dao.daoId === daoId.value &&
        member.id === memberId.value &&
        member.dao.chainId === state.network?.chainId &&
        member.dao.contract === state.network.runtime,
    ),
  ),
);
const communities = computed(() => user.value?.memberships ?? []);
const displayProfile = computed(() => profile.value ?? user.value?.profile ?? undefined);
const failedImages = ref({ avatar: false, background: false });
watch(
  () => [displayProfile.value?.avatar, displayProfile.value?.background],
  () => {
    failedImages.value = { avatar: false, background: false };
  },
);
const selfRoute = computed(() => route.path === '/users/me');
const identity = computed(() =>
  selfRoute.value
    ? state.memberships.find(
        (member) =>
          member.dao.chainId === state.network?.chainId &&
          member.dao.contract === state.network.runtime,
      )
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
      vaultUnlocked.value,
    ]),
  async () => {
    const request = ++generation;
    profile.value = undefined;
    privateNotice.value = '';
    failedImages.value = { avatar: false, background: false };
    error.value = '';
    exists.value = false;
    memberNative.value = '';
    publicMember.value = undefined;
    editing.value = false;
    busy.value = true;
    try {
      if (!daoId.value || !memberId.value) {
        exists.value = selfRoute.value;
        return;
      }
      const d = IdSchema.parse(daoId.value),
        m = IdSchema.parse(memberId.value);
      const publicPage = await api.publicMembers({ daoId: d, memberId: m });
      if (disposed || request !== generation) return;
      const row = publicPage.members.find(
        (person) =>
          person.id === m &&
          person.dao.daoId === d &&
          person.dao.chainId === state.network?.chainId &&
          person.dao.contract === state.network.runtime,
      );
      if (!row) return;
      publicMember.value = row;
      exists.value = true;
      memberNative.value = row.native_account;
      memberActive.value = row.active;
      if (state.account && vaultUnlocked.value) {
        const stored = await api.memberProfile(d, m);
        if (disposed || request !== generation) return;
        if (stored.profile) {
          const decoded = decodeRawNativeProfile(stored);
          if (decoded.version === 2)
            privateNotice.value =
              'Encrypted profile. Personal details are available only to its selected audience.';
          try {
            const opened = await readProfileForAudience(stored, row.dao, m);
            if (disposed || request !== generation) return;
            profile.value = opened;
            if (decoded.version === 2)
              privateNotice.value =
                'Decrypted locally for your authorized account. Earlier readers may retain copies.';
          } catch (cause) {
            if (disposed || request !== generation) return;
            privateNotice.value = friendlyError(cause);
          }
        }
      }
    } catch (cause) {
      if (request === generation) error.value = friendlyError(cause);
    } finally {
      if (request === generation) busy.value = false;
    }
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  profile.value = undefined;
});
const title = computed(
  () =>
    displayProfile.value?.fullName ||
    displayProfile.value?.name ||
    memberNative.value ||
    user.value?.nativeAccount ||
    (own.value ? 'Your profile' : `Member ${memberId.value ?? ''}`),
);
const contacts = computed(() => profileContacts(displayProfile.value));
function saved() {
  profileRevision.value++;
  void state.refresh();
  editing.value = false;
  void directory.load(true);
}
</script>
<template>
  <div class="button-row">
    <RouterLink class="help-link" to="/users"><ArrowLeft aria-hidden="true" />All users</RouterLink>
    <button
      v-if="selfRoute && state.account && !editing"
      type="button"
      class="secondary danger"
      :disabled="signingOut"
      @click="logout"
    >
      {{ signingOut ? 'Signing out…' : 'Sign out' }}
    </button>
  </div>
  <p v-if="signOutError" class="alert" role="alert">{{ signOutError }}</p>
  <div v-if="error" class="alert" role="alert">
    <h1>Profile temporarily unavailable</h1>
    <p>Could not read this profile. {{ error }}</p>
    <button type="button" class="secondary" @click="profileRevision++">Retry profile</button>
  </div>
  <p v-if="busy" role="status">Loading profile…</p>
  <Account v-else-if="selfRoute && !state.account" />
  <template v-else-if="!error && (exists || own)">
    <section
      class="profile-hero"
      :class="{ 'profile-without-cover': !displayProfile?.background || failedImages.background }"
    >
      <div v-if="displayProfile?.background && !failedImages.background" class="profile-cover">
        <img
          v-if="displayProfile?.background && !failedImages.background"
          :src="`https://ipfs.io/ipfs/${displayProfile.background}`"
          alt=""
          referrerpolicy="no-referrer"
          @error="failedImages.background = true"
        />
      </div>
      <div class="profile-identity">
        <span class="person-avatar large"
          ><img
            v-if="displayProfile?.avatar && !failedImages.avatar"
            :src="`https://ipfs.io/ipfs/${displayProfile.avatar}`"
            alt=""
            referrerpolicy="no-referrer"
            @error="failedImages.avatar = true"
          /><template v-else>{{ title.slice(0, 2).toUpperCase() }}</template></span
        >
        <div>
          <p class="eyebrow">{{ own ? 'YOUR PROFILE' : 'MEMBER PROFILE' }}</p>
          <h1>{{ title }}</h1>
          <p v-if="displayProfile?.name" class="person-handle">@{{ displayProfile.name }}</p>
        </div>
        <button
          v-if="own"
          type="button"
          class="secondary"
          :aria-expanded="editing"
          aria-controls="profile-account-settings"
          @click="editing = !editing"
        >
          <UserRoundPen aria-hidden="true" />{{
            editing ? 'Close account settings' : 'Edit profile & account'
          }}
        </button>
      </div>
      <p v-if="displayProfile?.motto" class="lead">{{ displayProfile.motto }}</p>
      <p v-if="privateNotice" class="notice" role="status">{{ privateNotice }}</p>
      <p v-else-if="!vaultUnlocked" class="field-help">
        Public aliases and legacy public details are visible here. Sign in and unlock your vault to
        read profiles shared with you.
      </p>
      <p v-if="displayProfile?.introduction" class="profile-introduction">
        {{ displayProfile.introduction }}
      </p>
      <p v-if="!displayProfile" class="muted">
        {{
          own
            ? 'Publish your profile to introduce yourself.'
            : 'This member has not published a profile.'
        }}
      </p>
      <div class="profile-facts">
        <span v-if="displayProfile?.location"
          ><MapPin aria-hidden="true" />{{ displayProfile.location }}</span
        >
        <template v-for="contact in contacts" :key="contact.key">
          <a
            v-if="contact.href"
            :href="contact.href"
            :target="contact.key === 'email' ? undefined : '_blank'"
            rel="noopener noreferrer"
            ><component
              :is="contact.key === 'email' || contact.key === 'telegram' ? AtSign : Globe"
              aria-hidden="true"
            />{{ contact.label
            }}<span v-if="contact.key !== 'email'" class="sr-only"> (opens in a new tab)</span></a
          >
          <span v-else>{{ contact.label }}</span>
        </template>
      </div>
      <LastDaoActivity :last-active="user?.lastActive ?? publicMember?.lastActive ?? null" />
    </section>
    <section v-if="daoId && memberId" class="panel profile-membership">
      <div class="panel-heading">
        <h2>Community memberships</h2>
        <span v-if="!communities.length" class="pill">{{
          memberActive ? 'Active member' : 'Inactive member'
        }}</span>
      </div>
      <ul v-if="communities.length" class="profile-community-list">
        <li v-for="community in communities" :key="`${community.dao.daoId}:${community.id}`">
          <RouterLink :to="`/dao/${community.dao.daoId}`">{{
            state.daos.find(
              (d) =>
                d.reference.daoId === community.dao.daoId &&
                d.reference.chainId === community.dao.chainId &&
                d.reference.contract === community.dao.contract,
            )?.title ?? `DAO ${community.dao.daoId}`
          }}</RouterLink>
          <span class="pill">{{ community.active ? 'Active member' : 'Inactive member' }}</span>
          <RouterLink
            v-if="community.dao.daoId !== daoId || community.id !== memberId"
            class="help-link"
            :to="`/users/${community.dao.daoId}/${community.id}`"
            >Membership profile<span class="sr-only">
              for DAO {{ community.dao.daoId }}</span
            ></RouterLink
          >
        </li>
      </ul>
      <RouterLink :to="`/dao/${dao.reference.daoId}/members`" v-else-if="dao"
        >{{ dao.title }} · member {{ memberId }}</RouterLink
      >
      <RouterLink v-else :to="`/dao/${daoId}/members`"
        >DAO {{ daoId }} · member {{ memberId }}</RouterLink
      >
      <p v-if="memberNative">
        On-chain governance account: <span class="mono">{{ memberNative }}</span>
      </p>
      <p class="field-help">
        These connections come from public on-chain membership records. Private sign-in pairings are
        not displayed.
      </p>
      <p v-if="directory.busy.value" role="status">Loading community connections…</p>
      <p v-if="directory.next.value || directory.busy.value" class="field-help">
        Community links and latest activity cover memberships loaded so far.
      </p>
      <p v-if="directory.error.value" class="alert" role="alert">
        Some community connections could not be loaded. {{ directory.error.value }}
        <button class="text-button" type="button" @click="directory.load()">
          Retry connections
        </button>
      </p>
      <button
        v-else-if="directory.next.value && !directory.busy.value"
        class="secondary"
        type="button"
        @click="directory.load()"
      >
        Load more community connections
      </button>
    </section>
    <div v-if="own" v-show="editing" id="profile-account-settings">
      <Account
        v-if="own && editing"
        embedded
        :profile-dao-id="daoId"
        :profile-member-id="memberId"
        @profile-updated="saved"
      />
    </div>
  </template>
  <section v-else-if="!error" class="empty-state">
    <h1>User unavailable</h1>
    <p>Check this member's DAO or browse published profiles.</p>
    <RouterLink to="/users">Browse users</RouterLink>
  </section>
</template>
<style scoped>
.profile-without-cover {
  padding-top: 1.5rem;
}
.profile-without-cover .profile-identity {
  margin-top: 0;
  align-items: center;
}
.profile-without-cover .eyebrow {
  margin-top: 0;
}
.profile-membership {
  margin-top: 1.5rem;
}
.profile-community-list {
  list-style: none;
  padding: 0;
}
.profile-community-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border-default);
}
.profile-identity > div {
  min-width: 0;
}
.profile-identity h1,
.profile-facts a {
  overflow-wrap: anywhere;
}
@media (max-width: 40rem) {
  .profile-identity button {
    margin-left: 0;
    width: 100%;
  }
}
</style>
