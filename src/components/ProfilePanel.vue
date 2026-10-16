<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { UserMembership, ProfileRecipient, KeyDeletionStatus } from '@daclify/core-protocol';
import { makeInstruction, encodeAction } from '@daclify/core-protocol/sdk';
import {
  decodeRawNativeProfile,
  profileCiphertextCommitment,
} from '@daclify/core-protocol/profiles';
import { api, friendlyError } from '../api/client';
import {
  emptyProfile,
  draftFromProfile,
  encodeSetEncryptedProfile,
  prepareEncryptedProfile,
  readProfileForAudience,
  profileError,
  encryptedProfileAllowed,
  type ProfileDraft,
} from '../auth/profile';
import { relayInstruction, vaultUnlocked } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
const signerReady = computed(() => vaultUnlocked.value && canSignMember(membership.value));
import { useWorkspace } from '../state/workspace';

const props = defineProps<{ daoId?: string | undefined; memberId?: string | undefined }>();
const emit = defineEmits<{ updated: [] }>();
const state = useWorkspace();
const draft = ref<ProfileDraft>(emptyProfile());
const savedName = ref('');
const selected = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const edited = ref(false);
const stored = ref<{ accountName: string | null; profile: string | null }>();
const recipients = ref<ProfileRecipient[]>([]);
const recipientIds = ref<string[]>([]);
const nextRecipient = ref<string | null>(null);
const recipientError = ref('');
const includeImages = ref(false);
const removeConfirmed = ref(false);
const deletion = ref<KeyDeletionStatus>();
const legacy = ref(false);
let profileRequest = 0;

const membership = computed(() =>
  state.memberships.find(
    (item) =>
      membershipKey(item) === selected.value &&
      item.dao.chainId === state.network?.chainId &&
      item.dao.contract === state.network.runtime,
  ),
);
const daoTitle = (item: UserMembership) =>
  state.daos.find(
    (dao) =>
      dao.reference.daoId === item.dao.daoId &&
      dao.reference.chainId === item.dao.chainId &&
      dao.reference.contract === item.dao.contract,
  )?.title ?? `DAO ${item.dao.daoId}`;

function clear() {
  profileRequest++;
  draft.value = emptyProfile();
  savedName.value = '';
  stored.value = undefined;
  recipients.value = [];
  recipientIds.value = [];
  nextRecipient.value = null;
  includeImages.value = false;
  removeConfirmed.value = false;
  deletion.value = undefined;
  edited.value = false;
  legacy.value = false;
  busy.value = false;
  error.value = '';
  notice.value = '';
  recipientError.value = '';
}
watch(
  () =>
    JSON.stringify([
      selected.value,
      signerReady.value,
      state.account?.id,
      state.network?.chainId,
      state.network?.runtime,
    ]),
  () => {
    clear();
    if (signerReady.value && membership.value) void load(membership.value);
  },
  { flush: 'sync' },
);
watch(
  () => state.memberships.map(membershipKey).join('|'),
  () => {
    if (!state.memberships.some((item) => membershipKey(item) === selected.value)) {
      const preferred =
        state.memberships.find(
          (item) => item.dao.daoId === props.daoId && item.memberId === props.memberId,
        ) ??
        state.memberships.find(
          (item) =>
            item.dao.chainId === state.network?.chainId &&
            item.dao.contract === state.network.runtime,
        );
      selected.value = preferred ? membershipKey(preferred) : '';
    }
  },
  { immediate: true },
);

function membershipKey(item: UserMembership): string {
  return `${item.dao.chainId}:${item.dao.contract}:${item.dao.daoId}:${item.memberId}`;
}
function guard(request: number) {
  if (request !== profileRequest || !signerReady.value) throw new Error('VAULT_LOCKED');
}
async function load(item: UserMembership) {
  const request = ++profileRequest;
  error.value = '';
  try {
    const row = await api.memberProfile(item.dao.daoId, item.memberId);
    guard(request);
    if (edited.value) return;
    stored.value = row;
    savedName.value = row.accountName ?? '';
    draft.value.name = savedName.value;
    legacy.value = !!row.profile && decodeRawNativeProfile(row).version === 1;
    const profile = await readProfileForAudience(row, item.dao, item.memberId);
    guard(request);
    if (edited.value) return;
    draft.value = profile ? draftFromProfile(JSON.stringify(profile)) : emptyProfile();
    if (savedName.value && draft.value.name === '') draft.value.name = savedName.value;
    includeImages.value = false;
  } catch (cause) {
    if (request === profileRequest) error.value = friendlyError(cause);
  }
}
async function loadRecipients() {
  const item = membership.value,
    request = profileRequest;
  if (!item || !signerReady.value) return;
  recipientError.value = '';
  try {
    const page = await api.profileRecipients(item.dao.daoId, nextRecipient.value ?? undefined);
    guard(request);
    const unique = new Map(recipients.value.map((recipient) => [recipient.memberId, recipient]));
    for (const recipient of page.recipients)
      if (recipient.memberId !== item.memberId) unique.set(recipient.memberId, recipient);
    recipients.value = [...unique.values()];
    nextRecipient.value = page.next;
  } catch (cause) {
    if (request === profileRequest) recipientError.value = friendlyError(cause);
  }
}
async function publish() {
  const item = membership.value;
  if (!item) return;
  const problem = profileError({
    ...draft.value,
    ...(!includeImages.value ? { avatar: '', background: '' } : {}),
  });
  if (problem) {
    error.value = problem;
    return;
  }
  busy.value = true;
  error.value = '';
  notice.value = '';
  const request = profileRequest;
  try {
    if (!encryptedProfileAllowed(state.network)) throw new Error('PROFILE_KEYS_UNAVAILABLE');
    const accountName = draft.value.name;
    const prepared = await prepareEncryptedProfile(
      draft.value,
      {
        version: 2,
        chainId: item.dao.chainId,
        runtime: item.dao.contract,
        daoId: item.dao.daoId,
        memberId: item.memberId,
        profileRevision: crypto.randomUUID(),
      },
      recipients.value
        .filter((recipient) => recipientIds.value.includes(recipient.memberId))
        .map((recipient) => recipient.encryptionKey),
      includeImages.value,
    );
    guard(request);
    await api.shareProfileKeys({ context: prepared.cipher.context, grants: prepared.grants });
    guard(request);
    await relayInstruction(
      makeInstruction(
        item.dao,
        item.memberId,
        item.nonce,
        Math.floor(Date.now() / 1000) + 300,
        item.dao.contract,
        'setencprof',
        encodeSetEncryptedProfile(accountName, prepared.cipher),
      ),
    );
    guard(request);
    savedName.value = accountName;
    stored.value = { accountName, profile: JSON.stringify(prepared.cipher) };
    legacy.value = false;
    notice.value = 'Encrypted profile published. Key confirmation may still be pending.';
    edited.value = false;
    recipientIds.value = [];
    if (!includeImages.value) {
      draft.value.avatar = '';
      draft.value.background = '';
    }
    await state.refresh();
    guard(request);
    emit('updated');
  } catch (cause) {
    if (request === profileRequest) error.value = friendlyError(cause);
  } finally {
    if (request === profileRequest) busy.value = false;
  }
}
async function remove() {
  const item = membership.value,
    row = stored.value,
    request = profileRequest;
  if (!item || !row?.profile || !removeConfirmed.value || !signerReady.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const decoded = decodeRawNativeProfile(row);
    if (decoded.version === 2) {
      deletion.value = await api.removeProfileKeys({
        context: decoded.context,
        ciphertextCommitment: await profileCiphertextCommitment(decoded),
      });
      guard(request);
      if (deletion.value.state === 'unavailable') throw new Error('PROFILE_DELETION_UNAVAILABLE');
      draft.value = emptyProfile();
    }
    await relayInstruction(
      makeInstruction(
        item.dao,
        item.memberId,
        item.nonce,
        Math.floor(Date.now() / 1000) + 300,
        item.dao.contract,
        'delprofile',
        encodeAction('delprofile', {
          actor: { runtime: item.dao.contract, dao_id: item.dao.daoId, member_id: item.memberId },
        }),
      ),
    );
    guard(request);
    draft.value = emptyProfile();
    stored.value = undefined;
    savedName.value = '';
    recipientIds.value = [];
    includeImages.value = false;
    removeConfirmed.value = false;
    edited.value = false;
    legacy.value = false;
    notice.value =
      'Current profile removed. Public chain history and copies retained by readers remain.';
    await state.refresh();
    guard(request);
    emit('updated');
  } catch (cause) {
    if (request === profileRequest) error.value = friendlyError(cause);
  } finally {
    if (request === profileRequest) busy.value = false;
  }
}
onBeforeUnmount(clear);
</script>
<template>
  <section class="panel profile-settings">
    <h2>Private profile</h2>
    <p>
      Your alias and native membership remain public. Personal fields are encrypted locally and
      stored on chain, readable only by you and people you select. Joining a DAO grants no profile
      access.
    </p>
    <p v-if="state.memberships.length === 0" class="notice">
      Join or create a DAO to publish a profile.
    </p>
    <div v-else-if="!signerReady">
      <slot name="unlock">
        <p class="notice">Unlock your account vault to read or edit your private profile.</p>
      </slot>
    </div>
    <form v-else @input="edited = true" @submit.prevent="publish">
      <fieldset :disabled="busy" class="profile-editor-fields">
        <legend class="sr-only">Private profile editor</legend>
        <template v-if="state.memberships.length > 1">
          <label for="profile-dao">Publish as a member of</label>
          <select id="profile-dao" v-model="selected" :disabled="busy">
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
        <div class="profile-fields">
          <div class="profile-wide">
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
              At most 12 characters: a–z, 1–5, and a dot. This is your public handle. It does not
              create a Telos account. It stays fixed while this profile exists. Chain history
              retains it.
            </p>
          </div>
          <div>
            <label for="profile-full-name">Full name</label>
            <input
              id="profile-full-name"
              v-model="draft.fullName"
              maxlength="80"
              autocomplete="name"
            />
          </div>
          <div>
            <label for="profile-location">Location</label>
            <input
              id="profile-location"
              v-model="draft.location"
              maxlength="80"
              autocomplete="off"
            />
          </div>
          <div class="profile-wide">
            <label for="profile-motto">Motto</label>
            <input id="profile-motto" v-model="draft.motto" maxlength="140" />
          </div>
          <div class="profile-wide">
            <label for="profile-introduction">Introduction</label>
            <textarea
              id="profile-introduction"
              v-model="draft.introduction"
              maxlength="2000"
              rows="4"
            ></textarea>
          </div>
        </div>
        <details class="profile-options">
          <summary>Private contact &amp; links</summary>
          <p class="field-help">
            These fields share the profile’s selected audience. They do not pair a sign-in method.
          </p>
          <div class="profile-fields">
            <div>
              <label for="profile-email">Email</label>
              <input
                id="profile-email"
                v-model="draft.email"
                maxlength="254"
                autocomplete="email"
              />
            </div>
            <div>
              <label for="profile-telegram">Telegram</label>
              <input
                id="profile-telegram"
                v-model="draft.telegram"
                maxlength="32"
                autocomplete="off"
              />
            </div>
            <div>
              <label for="profile-website">Company website</label>
              <input
                id="profile-website"
                v-model="draft.website"
                maxlength="300"
                autocomplete="url"
              />
            </div>
            <div>
              <label for="profile-facebook">Facebook</label>
              <input
                id="profile-facebook"
                v-model="draft.facebook"
                maxlength="300"
                autocomplete="url"
              />
            </div>
            <div>
              <label for="profile-instagram">Instagram</label>
              <input
                id="profile-instagram"
                v-model="draft.instagram"
                maxlength="300"
                autocomplete="url"
              />
            </div>
            <div>
              <label for="profile-youtube">YouTube</label>
              <input
                id="profile-youtube"
                v-model="draft.youtube"
                maxlength="300"
                autocomplete="url"
              />
            </div>
            <div>
              <label for="profile-linkedin">LinkedIn</label>
              <input
                id="profile-linkedin"
                v-model="draft.linkedin"
                maxlength="300"
                autocomplete="url"
              />
            </div>
          </div>
        </details>
        <details class="profile-options">
          <summary>Profile images</summary>
          <label
            ><input v-model="includeImages" type="checkbox" />Include image references in this
            encrypted profile</label
          >
          <p class="field-help">
            Image references are excluded by default. Encrypting an IPFS CID does not make its image
            private: an original uploaded publicly can still be read by anyone with its address.
            Include only assets whose separate access policy you understand.
          </p>
          <div class="profile-fields">
            <div>
              <label for="profile-avatar">Avatar image CID</label>
              <input
                id="profile-avatar"
                v-model="draft.avatar"
                :disabled="!includeImages"
                spellcheck="false"
                autocomplete="off"
              />
            </div>
            <div>
              <label for="profile-background">Background CID</label>
              <input
                id="profile-background"
                v-model="draft.background"
                :disabled="!includeImages"
                spellcheck="false"
                autocomplete="off"
              />
              <p class="field-help">
                Leave an image blank, or paste its IPFS CID after checking the asset’s access
                policy.
              </p>
            </div>
          </div>
        </details>
        <fieldset :disabled="busy">
          <legend>Who can read the next version?</legend>
          <p>Only you by default. Select recipients explicitly for every new version.</p>
          <p v-if="stored?.profile" class="field-help">
            Existing readers keep access until you publish a new version or remove its keys. They
            may retain earlier copies.
          </p>
          <button type="button" class="secondary" @click="loadRecipients">
            {{ nextRecipient ? 'Load more recipients' : 'Load eligible recipients' }}
          </button>
          <label v-for="recipient in recipients" :key="recipient.memberId">
            <input
              v-model="recipientIds"
              type="checkbox"
              :value="recipient.memberId"
              :disabled="!recipientIds.includes(recipient.memberId) && recipientIds.length >= 63"
            />
            Member {{ recipient.memberId }}
          </label>
          <p v-if="recipientError" role="alert">{{ recipientError }}</p>
        </fieldset>
        <p v-if="legacy" class="notice">
          This is a legacy public profile. Encrypting its next version cannot erase earlier
          plaintext chain history.
        </p>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <p v-if="!encryptedProfileAllowed(state.network)" role="status">
          This deployment needs the matching encrypted profile contract and configured key service
          before publishing.
        </p>
        <button :disabled="busy || !signerReady || !encryptedProfileAllowed(state.network)">
          {{ busy ? 'Saving…' : 'Publish encrypted profile' }}
        </button>
        <button
          type="button"
          class="secondary"
          :disabled="busy"
          @click="membership && load(membership)"
        >
          Retry profile read
        </button>
        <div v-if="stored?.profile">
          <label
            ><input v-model="removeConfirmed" type="checkbox" />Remove my current profile and its
            service-held keys</label
          >
          <button
            type="button"
            class="secondary"
            :disabled="
              busy ||
              !removeConfirmed ||
              !state.network?.capabilities.includes('encrypted-profiles-v2')
            "
            @click="remove"
          >
            Remove current profile
          </button>
        </div>
        <p v-if="deletion" role="status">
          {{
            deletion.state === 'backup-expiry-pending'
              ? `Active key envelopes removed. Backup expiry pending until ${deletion.backupExpiresAt}.`
              : deletion.state === 'removed'
                ? 'Service key retention period ended.'
                : 'Key removal unavailable. Retry before assuming removal.'
          }}
        </p>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
.profile-settings {
  max-width: none;
  padding: 24px;
}
.profile-settings h2 {
  font-size: 1.125rem;
  margin: 0;
}
.profile-editor-fields {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.profile-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 20px;
}
.profile-fields > div {
  min-width: 0;
}
.profile-wide {
  grid-column: 1 / -1;
}
.profile-options {
  border-top: 1px solid var(--border-default);
  margin-top: 16px;
  padding-top: 4px;
}
.profile-options > summary {
  min-height: 44px;
  padding-block: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}
@media (max-width: 600px) {
  .profile-settings {
    padding: 20px;
  }
  .profile-fields {
    grid-template-columns: 1fr;
  }
}
</style>
