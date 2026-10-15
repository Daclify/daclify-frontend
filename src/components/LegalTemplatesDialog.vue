<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { daoPaymentKey, type ContactRecoveryState, type DaoContent, type DaoSummary, type GovernanceState, type UserMembership } from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { vaultUnlocked } from '../auth/session';
import { legalTemplates, type LegalTemplate } from '../content/legal-templates/catalog';
import { assembleLegalDocument, LegalDraftError, LEGAL_DOCUMENT_MAX_BYTES, legalFileName, prefillLegalTemplate, renderLegalTemplate, validateLegalDraft, type TemplateContext, type TemplateMilestone } from '../content/legal-templates/render';
import { downloadFile } from '../content/files';
import { newDocumentId } from '../content/document-identity';
import { formatHelpAnswer } from '../help/format';
import WorkspaceDialog from './WorkspaceDialog.vue';

const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined; content: DaoContent | undefined; open: boolean; targetDocumentId?: string }>();
const emit = defineEmits<{ 'update:open': [open: boolean]; updated: [] }>();
const workspace = useWorkspace();
const step = ref<'choose' | 'details' | 'review' | 'publish'>('choose');
const chosen = ref<string[]>([]), template = ref<LegalTemplate>();
const values = ref<Record<string, string>>({}), common = ref<Record<string, string>>({});
const milestones = ref<TemplateMilestone[]>([{ deliverable: '', dueDate: '', payment: '' }]);
const title = ref(''), body = ref(''), generatedBody = ref(''), documentId = ref(''), documentVersion = ref(1);
const mode = ref<'edit' | 'preview'>('preview'), regenerateConsent = ref(false), exportConsent = ref(false);
const error = ref(''), factsLoading = ref(false), dirty = ref(false);
const governance = ref<GovernanceState>(), recovery = ref<ContactRecoveryState>();
const privateDao = computed(() => props.dao.privacy !== 'public');
const context = computed(() => JSON.stringify([props.dao.reference, props.dao.privacy, props.dao.keyEpoch, workspace.account?.id, workspace.account?.signingKey, workspace.account?.encryptionKey, props.member?.memberId, props.member?.signingKey, props.member?.active]));
let generation = 0, disposed = false;
const manuallyEdited = computed(() => body.value !== generatedBody.value);
const draftContext = computed<TemplateContext>(() => ({ dao: props.dao, documentId: documentId.value, documentVersion: documentVersion.value, governance: governance.value }));
const validation = computed(() => template.value ? validateLegalDraft(template.value, body.value) : []);
const preview = computed(() => {
  if (!template.value || !body.value || !documentId.value) return '';
  try { return formatHelpAnswer(assembleLegalDocument(template.value, body.value, draftContext.value)); }
  catch { return formatHelpAnswer(body.value); }
});
const recoverySummary = computed(() => {
  if (!workspace.network?.capabilities.includes('trusted-contact-recovery-v1') || recovery.value?.supported === false)
    return 'Contact document recovery is unsupported on this deployment.';
  if (!recovery.value) return 'Contact document recovery status is unknown.';
  if (!recovery.value.documentsAllowed) return 'This DAO currently forbids contact document recovery.';
  if (!recovery.value.policy?.documents) return 'This DAO permits contact document recovery. This membership has not opted in.';
  return 'Any two of your three contacts can decrypt backed-up document keys without you.';
});
const draftError = (cause: unknown) => cause instanceof LegalDraftError ? cause.message : friendlyError(cause);

async function loadFacts() {
  const current = ++generation, domain = context.value, member = props.member;
  factsLoading.value = true;
  const [policy, contacts] = await Promise.allSettled([
    api.governance(props.dao.reference.daoId),
    member && workspace.network?.capabilities.includes('trusted-contact-recovery-v1')
      ? api.contactRecoveryState({ target: { dao: props.dao.reference, memberId: member.memberId } })
      : Promise.resolve(undefined),
  ]);
  if (disposed || current !== generation || domain !== context.value) return;
  governance.value = policy.status === 'fulfilled' && daoPaymentKey(policy.value.dao) === daoPaymentKey(props.dao.reference) ? policy.value : undefined;
  recovery.value = contacts.status === 'fulfilled' && contacts.value && daoPaymentKey(contacts.value.target.dao) === daoPaymentKey(props.dao.reference) && contacts.value.target.memberId === member?.memberId ? contacts.value : undefined;
  factsLoading.value = false;
}
watch(() => props.open, (open) => { if (open) void loadFacts(); });
watch(context, () => {
  generation++;
  chosen.value = []; template.value = undefined; values.value = {}; common.value = {};
  body.value = ''; generatedBody.value = ''; title.value = ''; documentId.value = '';
  governance.value = undefined; recovery.value = undefined; error.value = ''; dirty.value = false;
  step.value = 'choose'; exportConsent.value = false; regenerateConsent.value = false;
  emit('update:open', false);
});
watch(vaultUnlocked, (unlocked) => {
  if (!unlocked && privateDao.value) {
    generation++; body.value = ''; generatedBody.value = ''; values.value = {}; common.value = {};
    template.value = undefined; chosen.value = []; dirty.value = false; step.value = 'choose';
    emit('update:open', false);
  }
});
function rememberCommon() {
  for (const key of ['DAO_NAME', 'DAO_MISSION', 'LEGAL_STATUS', 'EFFECTIVE_DATE']) {
    const value = values.value[key];
    if (value?.trim()) common.value[key] = value;
  }
}
function chooseTemplate() {
  const selected = legalTemplates.find((entry) => chosen.value.includes(entry.id));
  if (!selected) return;
  error.value = '';
  try {
    const id = props.targetDocumentId ?? newDocumentId(props.content?.documents ?? []);
    const versions = props.content?.documents.filter((row) => row.document_id === id) ?? [];
    if (props.targetDocumentId && !versions.length) throw new LegalDraftError('The document to amend is unavailable. Refresh Documents.');
    documentId.value = id; documentVersion.value = Math.max(0, ...versions.map((row) => row.version)) + 1;
    template.value = selected; title.value = selected.title;
    values.value = { ...prefillLegalTemplate(selected, draftContext.value), ...common.value };
    body.value = ''; generatedBody.value = ''; step.value = 'details'; dirty.value = true;
  } catch (cause) { error.value = draftError(cause); }
}
function generate() {
  if (!template.value) return;
  const result = renderLegalTemplate(template.value, values.value, milestones.value, draftContext.value);
  body.value = result.body; generatedBody.value = result.body; regenerateConsent.value = false;
}
function review() {
  error.value = '';
  try {
    rememberCommon();
    if (!body.value || !manuallyEdited.value) generate();
    step.value = 'review'; mode.value = 'preview';
  } catch (cause) { error.value = draftError(cause); }
}
function regenerate() {
  if (manuallyEdited.value && !regenerateConsent.value) return;
  try { generate(); error.value = ''; } catch (cause) { error.value = draftError(cause); }
}
function exportDraft() {
  if (privateDao.value && !exportConsent.value) return;
  downloadFile(new TextEncoder().encode(body.value), { version: 1, filename: legalFileName(title.value), mediaType: 'text/markdown' });
  dirty.value = false;
}
async function importDraft(event: Event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.item(0), domain = context.value, current = generation;
  if (!file) return;
  error.value = '';
  try {
    if (file.size > LEGAL_DOCUMENT_MAX_BYTES) throw new LegalDraftError('Document text is limited to 128 KiB.');
    const bytes = await file.arrayBuffer();
    if (disposed || current !== generation || domain !== context.value) return;
    let imported: string;
    try { imported = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new LegalDraftError('Choose a valid UTF-8 Markdown file.'); }
    body.value = imported; dirty.value = true; mode.value = 'preview';
  } catch (cause) { if (domain === context.value && !disposed) error.value = draftError(cause); }
  finally { input.value = ''; }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) { event.preventDefault(); event.returnValue = ''; }
}
function mayLeave() { return !dirty.value || window.confirm('Leave this page and discard the unpublished draft? Download it first to keep your edits.'); }
onBeforeRouteLeave(mayLeave); onBeforeRouteUpdate(mayLeave);
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => { disposed = true; generation++; window.removeEventListener('beforeunload', beforeUnload); body.value = ''; values.value = {}; common.value = {}; });
</script>

<template>
  <WorkspaceDialog :open="open" title="Create from template" class="legal-template-dialog" @update:open="emit('update:open', $event)">
    <p class="field-help">Drafts stay on this page until you download or publish them. Templates require review for your DAO and jurisdiction.</p>
    <p class="notice">{{ privateDao ? 'Document body and filename will be encrypted using this DAO’s access policy.' : 'Published documents in this DAO are public.' }}</p>
    <p v-if="factsLoading" role="status">Checking current DAO policies…</p>
    <p>{{ recoverySummary }}</p>
    <p v-if="recovery?.documentsAllowed" class="field-help">Permission and opt-in do not prove this document’s keys were backed up. The account wait cannot prevent contacts decrypting saved shares; revocation cannot erase retained copies.</p>
    <RouterLink to="/docs/contact-recovery">Document recovery and access ↗</RouterLink>
    <p v-if="error" role="alert" class="alert">{{ error }}</p>
    <template v-if="step === 'choose'">
      <h3>Choose your documents</h3>
      <div class="legal-template-list">
        <label v-for="entry in legalTemplates" :key="entry.id" class="legal-template-choice">
          <input v-model="chosen" type="checkbox" :value="entry.id" />
          <span><strong>{{ entry.title }}</strong><span>{{ entry.purpose }}</span></span>
        </label>
      </div>
      <button type="button" :disabled="!chosen.length || factsLoading" @click="chooseTemplate">Continue</button>
    </template>
    <template v-else-if="template">
      <h3>{{ template.title }}</h3>
      <p class="field-help">{{ template.guidance.replace(/\*\*/g, '') }}</p>
      <template v-if="step === 'details'">
        <p v-if="chosen.length > 1">{{ chosen.length }} templates selected. Shared DAO details are reused; every document is reviewed separately.</p>
        <form @submit.prevent="review">
          <label for="legal-title">Document title</label><input id="legal-title" v-model="title" maxlength="120" required />
          <template v-for="field in template.fields" :key="field.key">
            <label :for="'legal-' + field.key">{{ field.label }}</label>
            <textarea v-if="field.kind === 'textarea'" :id="'legal-' + field.key" v-model="values[field.key]" :maxlength="field.maxLength" rows="3" />
            <input v-else :id="'legal-' + field.key" v-model="values[field.key]" :type="field.kind === 'date' ? 'date' : 'text'" :maxlength="field.maxLength" />
          </template>
          <fieldset v-if="template.id === 'contributor-project-agreement'">
            <legend>Milestones</legend>
            <div v-for="(row, index) in milestones" :key="index" class="legal-milestone">
              <label :for="'legal-deliverable-' + index">Milestone {{ index + 1 }} deliverable</label><input :id="'legal-deliverable-' + index" v-model="row.deliverable" maxlength="500" />
              <label :for="'legal-due-' + index">Milestone {{ index + 1 }} due date</label><input :id="'legal-due-' + index" v-model="row.dueDate" type="date" />
              <label :for="'legal-payment-' + index">Milestone {{ index + 1 }} payment and currency</label><input :id="'legal-payment-' + index" v-model="row.payment" maxlength="500" />
              <button type="button" class="secondary" :disabled="milestones.length === 1" @click="milestones.splice(index, 1)">Remove milestone {{ index + 1 }}</button>
            </div>
            <button type="button" class="secondary" :disabled="milestones.length === 16" @click="milestones.push({ deliverable: '', dueDate: '', payment: '' })">Add milestone</button>
          </fieldset>
          <button type="submit">Review document</button>
        </form>
      </template>
      <template v-else>
        <p v-if="manuallyEdited" role="status">Your edited wording is preserved.</p>
        <div class="button-row"><button type="button" class="secondary" @click="mode = 'edit'">Edit</button><button type="button" class="secondary" @click="mode = 'preview'">Preview</button><button type="button" class="secondary" @click="step = 'details'">Back to details</button></div>
        <template v-if="mode === 'edit'"><label for="legal-body">Document text</label><textarea id="legal-body" v-model="body" rows="18" spellcheck="false" @input="dirty = true" /></template>
        <div v-else class="legal-preview" v-html="preview" />
        <ul v-if="validation.length" class="notice"><li v-for="issue in validation" :key="issue">{{ issue }}</li></ul>
        <label v-if="manuallyEdited" class="checkbox"><input v-model="regenerateConsent" type="checkbox" />Replace my edited wording with the current field values</label>
        <button type="button" class="secondary" :disabled="manuallyEdited && !regenerateConsent" @click="regenerate">Regenerate from fields</button>
        <label for="legal-import">Import edited Markdown</label><input id="legal-import" type="file" accept=".md,text/markdown,text/plain" @change="importDraft" />
        <p v-if="privateDao" class="field-help">Downloading a draft creates an unencrypted file on this device.</p>
        <label v-if="privateDao" class="checkbox"><input v-model="exportConsent" type="checkbox" />I understand this downloads an unencrypted draft</label>
        <button type="button" class="secondary" :disabled="privateDao && !exportConsent" @click="exportDraft">Download draft</button>
        <RouterLink to="/docs/governing-documents">Publishing and adopting a document ↗</RouterLink>
      </template>
    </template>
  </WorkspaceDialog>
</template>

<style scoped>
.legal-template-list { display: grid; gap: 10px; margin: 16px 0; }
.legal-template-choice { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.legal-template-choice input { width: 18px; min-width: 18px; height: 18px; margin: 3px 0 0; }
.legal-template-choice span { display: block; min-width: 0; }
.legal-template-choice strong { display: block; margin-bottom: 4px; }
.legal-template-choice span span { font-size: .875rem; font-weight: 400; color: var(--text-secondary); }
.legal-preview { overflow-wrap: anywhere; padding: 16px; margin: 16px 0; border: 1px solid var(--border-default); border-radius: var(--radius-md); max-height: 55dvh; overflow: auto; }
.legal-preview :deep(table) { display: block; max-width: 100%; overflow-x: auto; }
.legal-preview :deep(pre) { white-space: pre-wrap; }
.legal-milestone { padding: 12px 0; border-bottom: 1px solid var(--border-default); }
textarea { width: 100%; max-width: 100%; }
</style>
