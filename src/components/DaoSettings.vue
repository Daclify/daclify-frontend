<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowUpRight, CreditCard, Database, Users } from '@lucide/vue';
import { MetadataSchema, type DaoSummary, type UserMembership } from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
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
});
watch(
  () => props.dao.title,
  (title) => {
    newTitle.value = title;
  },
);
onBeforeUnmount(() => revision++);
function choose(id: (typeof sections)[number]) {
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
    if (generation === revision) notice.value = 'DAO name updated.';
  } catch (cause) {
    if (generation === revision) error.value = friendlyError(cause);
  } finally {
    if (generation === revision) busy.value = false;
  }
}
</script>
<template>
  <section id="configuration" class="dao-settings" aria-labelledby="settings-title">
    <header class="settings-heading">
      <div>
        <h2 id="settings-title">DAO settings</h2>
        <p>
          {{
            admin
              ? 'Manage this DAO’s public identity, governance and services.'
              : 'Explore this DAO’s configuration. Administrator permission is required to change its identity and policy.'
          }}
        </p>
      </div>
      <RouterLink :to="{ path: '/docs/dao-governance', query: { dao: dao.reference.daoId } }"
        >Configuration guide <ArrowUpRight aria-hidden="true"
      /></RouterLink>
    </header>
    <div class="settings-sections" role="group" aria-label="DAO configuration sections">
      <button
        v-for="id in sections"
        :key="id"
        class="secondary"
        :aria-pressed="selected === id"
        :disabled="busy"
        @click="choose(id)"
      >
        {{ id === 'identity' ? 'Identity' : id === 'governance' ? 'Governance' : 'Services' }}
      </button>
    </div>
    <div v-if="selected === 'identity'" class="settings-content">
      <section class="panel settings-identity">
        <h3>Public identity</h3>
        <p>
          Your DAO name is public on the blockchain. Changing it keeps the same DAO reference and
          memberships.
        </p>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <form v-if="admin" @submit.prevent="rename">
          <label for="rename">New DAO name</label
          ><input id="rename" v-model="newTitle" maxlength="160" required :disabled="busy" /><button
            :disabled="busy || !signerReady || !newTitle.trim() || newTitle.trim() === dao.title"
          >
            {{ busy ? 'Submitting…' : 'Sign and update name' }}
          </button>
          <p v-if="!newTitle.trim()" class="field-help">Enter a DAO name before signing.</p>
          <p v-if="!signerReady" class="field-help">
            Choose an authorized administrator signer in Signing &amp; wallets above.
          </p>
        </form>
        <p v-else class="notice">Administrator permission is required to update this DAO.</p>
      </section>
      <DaoBrandingPanel :dao="dao" :member="member" @updated="$emit('updated')" />
    </div>
    <GovernancePanel v-else-if="selected === 'governance'" :dao="dao" :member="member" />
    <div v-else class="settings-content">
      <div>
        <h3>Hosting and payments</h3>
        <p class="settings-description">
          Hosting pays for approved Daclify capacity. Module payments go to your DAO’s merchant
          account; resource funding is separate.
        </p>
      </div>
      <div class="settings-services">
        <section v-if="admin && !currentOperator()" class="panel">
          <Users aria-hidden="true" />
          <h3>Member capacity</h3>
          <p>Review this DAO’s hosted member allowance and approve additional capacity.</p>
          <RouterLink
            class="button secondary"
            :to="{ path: '/hosting', query: { dao: JSON.stringify(dao.reference) } }"
            >Manage member capacity</RouterLink
          >
        </section>
        <section class="panel">
          <Database aria-hidden="true" />
          <h3>Storage and resources</h3>
          <p>
            View RAM, pinned storage and archive usage. Funding and changes require the appropriate
            DAO authorization.
          </p>
          <RouterLink
            class="button secondary"
            :to="{ path: '/resources', query: { dao: JSON.stringify(dao.reference) } }"
            >Storage and blockchain resources</RouterLink
          >
        </section>
        <section class="panel">
          <CreditCard aria-hidden="true" />
          <h3>DAO payments</h3>
          <p>
            Review merchant onboarding and module payments. This is separate from the DAO’s native
            treasury.
          </p>
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
  gap: 24px;
  min-width: 0;
}
.settings-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.settings-heading > div {
  flex: 1;
  min-width: min(100%, 18rem);
}
.settings-heading h2 {
  font-size: 1.25rem;
  margin: 0 0 8px;
}
.settings-heading p,
.settings-description {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0;
}
.settings-heading a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  font-size: 0.875rem;
}
.settings-heading a svg {
  width: 16px;
  height: 16px;
}
.settings-sections {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-default);
}
.settings-sections button {
  border-color: var(--border-default);
  box-shadow: none;
  font-size: 0.875rem;
}
.settings-sections button[aria-pressed='true'] {
  background: var(--accent-soft);
  color: var(--accent-amber);
  border-color: var(--border-warm);
}
.settings-content :deep(.narrow),
.settings-identity {
  width: 100%;
  max-width: 48rem;
  margin: 0;
}
.settings-content :deep(label),
.settings-content :deep(.field-help) {
  font-size: 0.875rem;
}
.settings-content :deep(h3) {
  font-size: 1.125rem;
}
.settings-identity p {
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.settings-identity form {
  max-width: 36rem;
}
.settings-identity form button {
  margin-top: 16px;
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
.settings-services h3 {
  font-size: 1rem;
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
