<script setup lang="ts">
import { privateContentError as friendlyError } from '../content/private-errors';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { DaoSummary, UserMembership } from '@daclify/core-protocol';
import {
  previewPrivacyMigration,
  applyPrivacyMigrationItem,
  type PrivacyMigrationItem,
} from '../content/privacy-migration';
import { vaultUnlocked } from '../auth/session';
import { useWorkspace } from '../state/workspace';
import { resolveApiUrl } from '../api/networks';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>();
const emit = defineEmits<{ updated: [] }>();
const workspace = useWorkspace(),
  route = useRoute();
const preview = ref<Awaited<ReturnType<typeof previewPrivacyMigration>>>(),
  busy = ref(false),
  reviewed = ref(false),
  error = ref(''),
  message = ref('');
let generation = 0;
const context = computed(() =>
  JSON.stringify([
    resolveApiUrl('/'),
    props.dao.reference,
    props.dao.keyEpoch,
    props.member?.memberId,
    props.member?.signingKey,
    props.member?.active,
    props.member?.admin,
    workspace.account?.id,
    workspace.account?.signingKey,
    workspace.account?.encryptionKey,
    vaultUnlocked.value,
  ]),
);
function reset() {
  generation++;
  preview.value = undefined;
  busy.value = false;
  reviewed.value = false;
  error.value = '';
  message.value = '';
}
watch(context, reset, { flush: 'sync' });
onBeforeUnmount(reset);
async function review(cursor?: string) {
  if (busy.value) return;
  const started = generation;
  busy.value = true;
  error.value = '';
  reviewed.value = false;
  try {
    const value = await previewPrivacyMigration(props.dao.reference, cursor);
    if (started === generation) preview.value = value;
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
async function apply(item: PrivacyMigrationItem, reprepare = false) {
  const member = props.member,
    started = generation;
  if (busy.value || !reviewed.value || !member?.active || !member.admin || !vaultUnlocked.value)
    return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await applyPrivacyMigrationItem(props.dao.reference, member.memberId, item, reprepare);
    if (started !== generation) return;
    preview.value = undefined;
    reviewed.value = false;
    message.value = 'Protected successor confirmed. Review remaining records to continue.';
    await workspace.refresh();
    if (started !== generation) return;
    emit('updated');
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <section v-if="dao.privacy !== 'public'" class="panel">
    <h2>Privacy upgrade</h2>
    <p>
      Review older public descriptions and create encrypted successors using your original account
      keys. Reviewing does not sign or publish anything.
    </p>
    <button class="secondary" type="button" :disabled="busy" @click="review()">
      Review privacy upgrade
    </button>
    <template v-if="preview">
      <p v-if="preview.publicState.privacy === 'encrypted-managed-allowed'" class="notice">
        This DAO permits accounts with Daclify-assisted recovery. An operator that can recover a
        permitted reader’s keys may read content shared with that member. This upgrade keeps the
        current admission policy.
      </p>
      <p class="notice">
        Earlier transactions, public files and downloaded copies stay public. Existing ballots keep
        their original meaning. Agreed payroll names and payment terms stay unchanged; only editable
        display names can gain private successors. Replace old public branding through the private
        identity editor after this upgrade.
      </p>
      <p>
        Memberships, keys, roles, admission policy, vote choices, treasury amounts, claims and
        liabilities remain unchanged and public.
      </p>
      <p v-if="!vaultUnlocked" class="notice">
        <RouterLink :to="{ path: '/account', query: { unlock: '1', returnTo: route.fullPath } }"
          >Unlock original account to apply this preview</RouterLink
        >
      </p>
      <p v-else-if="member?.signingKey !== workspace.account?.signingKey" class="notice">
        The original member keys are required. A paired wallet alone cannot replace the
        private-content keys.
      </p>
      <p v-if="!preview.items.length">
        No editable public descriptions were found on this page. Historical disclosures remain
        public.
      </p>
      <template v-else>
        <label class="checkbox"
          ><input v-model="reviewed" type="checkbox" :disabled="busy" />I reviewed the retained
          public history and unchanged governance and payment terms.</label
        >
        <ul>
          <li v-for="item in preview.items" :key="item.kind + item.id">
            {{
              item.kind === 'dao-identity'
                ? 'DAO identity'
                : item.kind === 'agent-description'
                  ? 'Agent operating label'
                  : 'Payroll display name'
            }}
            · {{ item.id }}
            <details>
              <summary>Fields to encrypt</summary>
              <pre>{{ JSON.stringify(item.payload.body, null, 2) }}</pre>
            </details>
            <button
              type="button"
              :disabled="
                busy ||
                !reviewed ||
                !vaultUnlocked ||
                !member?.active ||
                !member.admin ||
                member.signingKey !== workspace.account?.signingKey
              "
              @click="apply(item)"
            >
              Sign protected successor
            </button>
            <details>
              <summary>Recover unfinished work after key changes</summary>
              <p>
                Re-encrypt with your original grants before attaching this successor. Earlier
                ciphertext remains tracked and may still use storage until verified cleanup.
              </p>
              <button
                type="button"
                class="secondary"
                :disabled="busy || !reviewed || !vaultUnlocked || !member?.admin"
                @click="apply(item, true)"
              >
                Reprepare unfinished successor
              </button>
            </details>
          </li>
        </ul>
      </template>
      <button
        v-if="preview.next"
        class="secondary"
        type="button"
        :disabled="busy"
        @click="review(preview.next)"
      >
        Next preview page
      </button>
      <p class="field-help">
        One record per approval. Interrupted work resumes with the same encrypted document;
        uncertain confirmations are checked before another signature. No new identity or recovery
        enrollment is created.
      </p>
    </template>
    <p v-if="busy" role="status">Checking signed privacy work…</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
li {
  margin-block: 1rem;
}
</style>
