<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CircleHelp, CreditCard, Database, Users, Boxes, Pencil } from '@lucide/vue';
import { MetadataSchema, type DaoSummary, type UserMembership } from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import WorkspaceDialog from './WorkspaceDialog.vue';
import WorkspaceTabs from './WorkspaceTabs.vue';
import DaoBrandingPanel from './DaoBrandingPanel.vue';
import GovernancePanel from './GovernancePanel.vue';
import { currentOperator } from '../api/networks';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>();
defineEmits<{ updated: [] }>();
const route = useRoute(),
  router = useRouter(),
  workspace = useWorkspace();
const sections = ['identity', 'governance', 'services'] as const;
const tabs = sections.map((value) => ({
  value,
  label: value === 'identity' ? 'Identity' : value === 'governance' ? 'Governance' : 'Services',
}));
const popup = ref(false);
const selected = computed(() => sections.find((id) => id === route.query.settings) ?? 'identity');
const admin = computed(() => !!props.member?.active && props.member.admin);
const signerReady = computed(() => canSignMember(props.member));
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  newTitle = ref(props.dao.title);
const context = computed(() =>
  JSON.stringify([
    props.dao.reference,
    workspace.account?.id,
    props.member?.memberId,
    props.member?.active,
    props.member?.admin,
    props.dao.privacy,
  ]),
);
let revision = 0;
watch(context, () => {
  revision++;
  newTitle.value = props.dao.title;
  error.value = '';
  notice.value = '';
  busy.value = false;
  popup.value = false;
});
watch(
  () => props.dao.title,
  (title) => {
    newTitle.value = title;
  },
);
onBeforeUnmount(() => revision++);
function choose(value: string) {
  const id = sections.find((section) => section === value);
  if (!id) return;
  if (!busy.value)
    void router.replace({
      query: { ...route.query, settings: id === 'identity' ? undefined : id },
      hash: route.hash,
    });
}
async function rename() {
  const d = props.dao,
    m = props.member,
    generation = revision;
  if (!m || !admin.value || !signerReady.value || busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const metadata = MetadataSchema.parse({
      schemaVersion: d.branding ? 3 : d.setup ? 2 : 1,
      title: newTitle.value.trim(),
      description: d.description,
      ...(d.setup || d.branding ? { purpose: d.purpose ?? 'custom', setup: d.setup ?? null } : {}),
      ...(d.branding ? { branding: d.branding } : {}),
    });
    await relayInstruction(
      makeInstruction(
        d.reference,
        m.memberId,
        m.nonce,
        Math.floor(Date.now() / 1000) + 300,
        d.reference.contract,
        'setmeta',
        encodeAction('setmeta', {
          runtime: d.reference.contract,
          dao_id: d.reference.daoId,
          member_id: m.memberId,
          metadata: JSON.stringify(metadata),
        }),
      ),
    );
    if (generation !== revision) return;
    await workspace.refresh();
    if (generation === revision) {
      notice.value = 'DAO name updated.';
      popup.value = false;
    }
  } catch (cause) {
    if (generation === revision) error.value = friendlyError(cause);
  } finally {
    if (generation === revision) busy.value = false;
  }
}
</script>
<template>
  <section id="configuration" class="dao-settings" aria-label="DAO settings">
    <div class="workspace-tools-toolbar settings-toolbar">
      <WorkspaceTabs
        :model-value="selected"
        prefix="settings"
        label="DAO settings sections"
        :items="tabs"
        :disabled="busy"
        @update:model-value="choose"
      />
      <RouterLink
        class="workspace-icon-button"
        :to="{ path: '/docs/dao-governance', query: { dao: dao.reference.daoId } }"
        aria-label="Settings help"
        title="Settings help"
        ><CircleHelp aria-hidden="true"
      /></RouterLink>
    </div>
    <p v-if="!admin" class="field-help">
      You can review these settings. An administrator must approve changes to the DAO’s identity and
      voting rules.
    </p>
    <div
      v-show="selected === 'identity'"
      id="settings-identity"
      role="tabpanel"
      aria-labelledby="settings-tab-identity"
      class="settings-content"
    >
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Public identity</h2>
            <p class="settings-description">
              The name people see in the directory and your workspace.
            </p>
          </div>
          <button
            v-if="admin"
            type="button"
            class="secondary settings-edit"
            aria-haspopup="dialog"
            :disabled="busy"
            @click="popup = true"
          >
            <Pencil aria-hidden="true" />Edit DAO name
          </button>
        </div>
        <dl class="settings-values">
          <dt>DAO name</dt>
          <dd>{{ dao.title }}</dd>
          <dt>Document privacy</dt>
          <dd>{{ dao.privacy === 'public' ? 'Public' : 'Encrypted documents' }}</dd>
        </dl>
        <p v-if="notice" role="status">{{ notice }}</p>
      </section>
      <DaoBrandingPanel :dao="dao" :member="member" @updated="$emit('updated')" />
      <WorkspaceDialog v-if="admin" v-model:open="popup" title="Edit DAO name" :busy="busy">
        <p>
          Your DAO name is public on the blockchain. Changing it keeps the same DAO reference and
          memberships.
        </p>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <form @submit.prevent="rename">
          <label for="rename">New DAO name</label
          ><input id="rename" v-model="newTitle" maxlength="160" required :disabled="busy" />
          <p v-if="!newTitle.trim()" class="field-help">Enter a DAO name before signing.</p>
          <p v-if="!signerReady" class="field-help">
            Choose an authorized administrator signer in Signing &amp; wallets above.
          </p>
          <button
            :disabled="busy || !signerReady || !newTitle.trim() || newTitle.trim() === dao.title"
          >
            {{ busy ? 'Submitting…' : 'Sign and update name' }}
          </button>
        </form>
      </WorkspaceDialog>
    </div>
    <div
      v-show="selected === 'governance'"
      id="settings-governance"
      role="tabpanel"
      aria-labelledby="settings-tab-governance"
      class="settings-content"
    >
      <GovernancePanel :dao="dao" :member="member" />
    </div>
    <div
      v-show="selected === 'services'"
      id="settings-services"
      role="tabpanel"
      aria-labelledby="settings-tab-services"
      class="settings-content"
    >
      <p class="settings-description">
        Manage your DAO’s hosting, module access, storage and merchant payments.
      </p>
      <div class="settings-services">
        <section v-if="admin && !currentOperator()" class="panel">
          <Users aria-hidden="true" />
          <h2>Member capacity</h2>
          <p>Review your hosted member allowance and approve additional capacity.</p>
          <RouterLink
            class="button secondary"
            :to="{ path: '/hosting', query: { dao: JSON.stringify(dao.reference) } }"
            >Manage member capacity</RouterLink
          >
        </section>
        <section v-if="admin && !currentOperator()" class="panel">
          <Boxes aria-hidden="true" />
          <h2>Module access</h2>
          <p>
            Free through 10 active members. Review monthly prices and buy access for larger
            communities.
          </p>
          <RouterLink
            class="button secondary"
            :to="{ path: '/module-access', query: { dao: JSON.stringify(dao.reference) } }"
            >Manage module access</RouterLink
          >
        </section>
        <section class="panel">
          <Database aria-hidden="true" />
          <h2>Storage and resources</h2>
          <p>
            View blockchain RAM, pinned files and archives. Funding and changes require DAO
            authorization.
          </p>
          <RouterLink
            class="button secondary"
            :to="{ path: '/resources', query: { dao: JSON.stringify(dao.reference) } }"
            >Storage and blockchain resources</RouterLink
          >
        </section>
        <section class="panel">
          <CreditCard aria-hidden="true" />
          <h2>DAO payments</h2>
          <p>Manage merchant onboarding and module payments.</p>
          <RouterLink
            class="button secondary"
            :to="{ path: '/payments', query: { dao: JSON.stringify(dao.reference) } }"
            >DAO payments and merchant setup</RouterLink
          >
        </section>
      </div>
    </div>
  </section>
</template>
<style scoped>
.dao-settings,
.settings-content {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.settings-content > .panel {
  margin: 0;
}
.settings-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  margin: 0;
  gap: 8px;
}
.settings-toolbar :deep(.account-tabs) {
  min-width: 0;
  gap: 4px;
}
.settings-toolbar :deep([role='tab']) {
  padding: 6px 10px;
  min-height: 44px;
}
.settings-description {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0;
}
.settings-edit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.settings-edit svg {
  width: 18px;
  height: 18px;
}
.settings-services {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: 16px;
}
.settings-services .panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
}
.settings-services .panel > svg {
  width: 28px;
  height: 28px;
  color: var(--accent-amber);
  margin-bottom: 20px;
}
.settings-content :deep(h2) {
  font-size: 1.125rem;
}
.settings-services p {
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.settings-services a {
  margin-top: auto;
  font-size: 0.875rem;
}
</style>
