<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { UserMembership } from '@daclify/core-protocol';
import { makeInstruction } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import {
  draftFromProfile,
  emptyProfile,
  encodeSetprofile,
  profileError,
  profileJson,
  type ProfileDraft,
} from '../auth/profile';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
const signerReady = computed(() => canSignMember(membership.value));
import { useWorkspace } from '../state/workspace';

const state = useWorkspace();
const draft = ref<ProfileDraft>(emptyProfile());
const savedName = ref('');
const selected = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const edited = ref(false);
let profileRequest = 0;

const membership = computed(() =>
  state.memberships.find((item) => membershipKey(item) === selected.value),
);
const daoTitle = (item: UserMembership) =>
  state.daos.find((dao) => dao.reference.daoId === item.dao.daoId)?.title ??
  `DAO ${item.dao.daoId}`;

watch([selected, signerReady], () => {
  if (!signerReady.value) {
    draft.value = emptyProfile();
    savedName.value = '';
    edited.value = false;
    return;
  }
  if (membership.value) void load(membership.value);
});
watch(
  () => state.memberships.map(membershipKey).join('|'),
  () => {
    if (!state.memberships.some((item) => membershipKey(item) === selected.value))
      selected.value = state.memberships[0] ? membershipKey(state.memberships[0]) : '';
  },
  { immediate: true },
);

function membershipKey(item: UserMembership): string {
  return `${item.dao.daoId}:${item.memberId}`;
}
async function load(item: UserMembership) {
  const request = ++profileRequest;
  error.value = '';
  try {
    const row = await api.memberProfile(item.dao.daoId, item.memberId);
    if (request !== profileRequest || edited.value) return;
    savedName.value = row.accountName ?? '';
    draft.value = row.profile ? draftFromProfile(row.profile) : emptyProfile();
    if (savedName.value && draft.value.name === '') draft.value.name = savedName.value;
  } catch (cause) {
    if (request === profileRequest) error.value = friendlyError(cause);
  }
}
async function publish() {
  const item = membership.value;
  if (!item) return;
  const problem = profileError(draft.value);
  if (problem) {
    error.value = problem;
    return;
  }
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const profile = profileJson(draft.value);
    await relayInstruction(
      makeInstruction(
        item.dao,
        item.memberId,
        item.nonce,
        Math.floor(Date.now() / 1000) + 300,
        item.dao.contract,
        'setprofile',
        encodeSetprofile({
          runtime: item.dao.contract,
          daoId: item.dao.daoId,
          memberId: item.memberId,
          accountName: draft.value.name,
          profile,
        }),
      ),
    );
    savedName.value = draft.value.name;
    notice.value = 'Profile published.';
    edited.value = false;
    await state.refresh();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="panel narrow">
    <h2>Public profile</h2>
    <p>
      You publish this from your browser vault. The runtime stores one JSON object. Avatar and
      background are IPFS CIDs, the same identifier a document uses. The image file stays on IPFS.
      Email and links are public on the chain.
    </p>
    <p v-if="!signerReady" class="notice">Connect an authorized signer to edit this profile.</p>
    <p v-else-if="state.memberships.length === 0" class="notice">
      Create or join a DAO to publish. The contract accepts a profile only from a member.
    </p>
    <form v-else @input="edited = true" @submit.prevent="publish">
      <template v-if="state.memberships.length > 1">
        <label for="profile-dao">Publish as a member of</label>
        <select id="profile-dao" v-model="selected">
          <option
            v-for="item in state.memberships"
            :key="membershipKey(item)"
            :value="membershipKey(item)"
          >
            {{ daoTitle(item) }}
          </option>
        </select>
      </template>
      <p v-else-if="membership" class="muted">Publishing for {{ daoTitle(membership) }}.</p>
      <label for="profile-name">Account name</label>
      <input
        id="profile-name"
        v-model="draft.name"
        :disabled="savedName !== ''"
        autocomplete="off"
        spellcheck="false"
        required
        maxlength="12"
      />
      <p class="field-help">
        At most 12 characters: a–z, 1–5, and a dot. This is your public handle. It does not create a
        Telos account, and it stays fixed after the first publish.
      </p>
      <label for="profile-full-name">Full name</label>
      <input id="profile-full-name" v-model="draft.fullName" maxlength="80" autocomplete="name" />
      <label for="profile-location">Location</label>
      <input id="profile-location" v-model="draft.location" maxlength="80" autocomplete="off" />
      <label for="profile-email">Email</label>
      <input id="profile-email" v-model="draft.email" maxlength="254" autocomplete="email" />
      <label for="profile-telegram">Telegram</label>
      <input id="profile-telegram" v-model="draft.telegram" maxlength="32" autocomplete="off" />
      <label for="profile-motto">Motto</label>
      <input id="profile-motto" v-model="draft.motto" maxlength="140" />
      <label for="profile-introduction">Introduction</label>
      <textarea
        id="profile-introduction"
        v-model="draft.introduction"
        maxlength="2000"
        rows="4"
      ></textarea>
      <label for="profile-website">Company website</label>
      <input id="profile-website" v-model="draft.website" maxlength="300" autocomplete="url" />
      <label for="profile-facebook">Facebook</label>
      <input id="profile-facebook" v-model="draft.facebook" maxlength="300" autocomplete="url" />
      <label for="profile-instagram">Instagram</label>
      <input id="profile-instagram" v-model="draft.instagram" maxlength="300" autocomplete="url" />
      <label for="profile-youtube">YouTube</label>
      <input id="profile-youtube" v-model="draft.youtube" maxlength="300" autocomplete="url" />
      <label for="profile-linkedin">LinkedIn</label>
      <input id="profile-linkedin" v-model="draft.linkedin" maxlength="300" autocomplete="url" />
      <label for="profile-avatar">Avatar CID</label>
      <input id="profile-avatar" v-model="draft.avatar" spellcheck="false" autocomplete="off" />
      <label for="profile-background">Background CID</label>
      <input
        id="profile-background"
        v-model="draft.background"
        spellcheck="false"
        autocomplete="off"
      />
      <p class="field-help">
        Leave an image blank, or paste its IPFS CID. An image address is not stored.
      </p>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <button :disabled="busy || !signerReady">
        {{ busy ? 'Publishing…' : 'Publish profile' }}
      </button>
    </form>
  </section>
</template>
