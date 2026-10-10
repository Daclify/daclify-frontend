<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import {
  BrandImageSchema,
  BrandingUploadSchema,
  type BrandingUpload,
  DaoBrandingSchema,
  FileMetadataSchema,
  MetadataSchema,
  type DaoSummary,
  type UserMembership,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import { useWorkspace } from '../state/workspace';
import { preparePublicFile } from '../content/files';
const workspace = useWorkspace();
const props = defineProps<{ dao: DaoSummary; member: UserMembership | undefined }>(),
  emit = defineEmits<{ updated: [] }>();
const summary = ref(''),
  logo = ref(''),
  cover = ref(''),
  advanced = ref(''),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  uploadSlot = ref<'logo' | 'cover'>('logo'),
  selectedFile = ref<File>(),
  fileInput = ref<HTMLInputElement>(),
  publicConsent = ref(false),
  pending = ref<BrandingUpload>(),
  options = ref<{ value: string; label: string }[]>([]);
const ready = computed(
  () => props.member?.active && props.member.admin && canSignMember(props.member),
);
let revision = 0;
const pendingKey = computed(() =>
  JSON.stringify([
    'daclify.pending-branding.v1',
    resolveApiUrl('/'),
    props.dao.reference,
    props.member?.memberId,
    workspace.account?.id,
  ]),
);
const context = () => JSON.stringify([pendingKey.value, props.member?.active, props.member?.admin]);
watch(
  () => JSON.stringify([context(), props.dao.branding]),
  async () => {
    const generation = ++revision;
    summary.value = props.dao.branding?.summary ?? '';
    logo.value = props.dao.branding?.logo ? JSON.stringify(props.dao.branding.logo) : '';
    cover.value = props.dao.branding?.cover ? JSON.stringify(props.dao.branding.cover) : '';
    advanced.value = '';
    error.value = '';
    notice.value = '';
    busy.value = false;
    pending.value = undefined;
    selectedFile.value = undefined;
    publicConsent.value = false;
    const saved = sessionStorage.getItem(pendingKey.value);
    if (saved) {
      try {
        const request = BrandingUploadSchema.parse(JSON.parse(saved));
        if (JSON.stringify(request.dao) !== JSON.stringify(props.dao.reference))
          throw new Error('DAO_REFERENCE');
        pending.value = request;
        uploadSlot.value = request.slot;
        publicConsent.value = true;
        notice.value = 'Resume the saved public image request before selecting another image.';
      } catch {
        sessionStorage.removeItem(pendingKey.value);
      }
    }
    if (fileInput.value) fileInput.value.value = '';
    options.value = [];
    if (props.dao.privacy !== 'public') return;
    try {
      const result = await api.content(props.dao.reference.daoId);
      if (generation !== revision) return;
      const latest = new Map<string, (typeof result.documents)[number]>();
      for (const doc of result.documents)
        if (
          !latest.has(doc.document_id) ||
          doc.version > (latest.get(doc.document_id)?.version ?? 0)
        )
          latest.set(doc.document_id, doc);
      for (const doc of latest.values()) {
        if (!doc.cid || doc.envelope_version !== 0) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(doc.metadata);
        } catch {
          continue;
        }
        const metadata = FileMetadataSchema.safeParse(raw);
        if (!metadata.success) continue;
        const image = BrandImageSchema.safeParse({
          cid: doc.cid,
          bytes: doc.bytes,
          commitment: doc.commitment,
          mediaType: metadata.data.mediaType,
        });
        if (image.success)
          options.value.push({
            value: JSON.stringify(image.data),
            label: metadata.data.filename + ' · document ' + doc.document_id,
          });
      }
    } catch (cause) {
      if (generation === revision) error.value = friendlyError(cause);
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  revision++;
});
function chooseFile(event: Event) {
  if (event.target instanceof HTMLInputElement) selectedFile.value = event.target.files?.[0];
}
async function uploadImage() {
  if (!props.member?.active || !props.member.admin || busy.value || !publicConsent.value) return;
  const generation = revision;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (!pending.value) {
      const file = selectedFile.value;
      if (!file) throw new Error('FILE_REQUIRED');
      if (!BrandImageSchema.shape.bytes.safeParse(file.size).success)
        throw new Error('FILE_TOO_LARGE');
      BrandImageSchema.shape.mediaType.parse(file.type);
      const prepared = await preparePublicFile(new Uint8Array(await file.arrayBuffer()), {
        version: 1,
        filename: file.name,
        mediaType: file.type,
      });
      if (generation !== revision) return;
      pending.value = BrandingUploadSchema.parse({
        dao: props.dao.reference,
        requestId: crypto.randomUUID(),
        slot: uploadSlot.value,
        bytes: prepared.bytes,
        commitment: prepared.commitment,
        mediaType: file.type,
        content: prepared.content,
        publicConsent: true,
      });
      try {
        sessionStorage.setItem(pendingKey.value, JSON.stringify(pending.value));
      } catch {
        pending.value = undefined;
        throw new Error('PENDING_REQUEST_STORAGE');
      }
    }
    const receipt = await api.uploadBranding(pending.value);
    if (generation !== revision) return;
    const image = JSON.stringify(receipt.image);
    if (!options.value.some((option) => option.value === image))
      options.value.push({ value: image, label: 'Verified public ' + receipt.slot });
    if (receipt.slot === 'logo') logo.value = image;
    else cover.value = image;
    advanced.value = '';
    pending.value = undefined;
    selectedFile.value = undefined;
    if (fileInput.value) fileInput.value.value = '';
    notice.value = 'Image verified and hosted. Sign the card update to publish this selection.';
  } catch (cause) {
    if (generation === revision) error.value = friendlyError(cause);
  } finally {
    if (generation === revision) busy.value = false;
  }
}
async function save() {
  const dao = props.dao,
    member = props.member,
    generation = revision;
  if (!member || !ready.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const images = advanced.value.trim()
      ? DaoBrandingSchema.omit({ summary: true }).parse(JSON.parse(advanced.value))
      : {
          ...(logo.value ? { logo: BrandImageSchema.parse(JSON.parse(logo.value)) } : {}),
          ...(cover.value ? { cover: BrandImageSchema.parse(JSON.parse(cover.value)) } : {}),
        };
    const metadata = MetadataSchema.parse({
      schemaVersion: 3,
      title: dao.title,
      description: dao.description,
      purpose: dao.purpose ?? 'custom',
      setup: dao.setup ?? null,
      branding: { ...images, summary: summary.value },
    });
    const request = makeInstruction(
      dao.reference,
      member.memberId,
      member.nonce,
      Math.floor(Date.now() / 1000) + 300,
      dao.reference.contract,
      'setmeta',
      encodeAction('setmeta', {
        runtime: dao.reference.contract,
        dao_id: dao.reference.daoId,
        member_id: member.memberId,
        metadata: JSON.stringify(metadata),
      }),
    );
    await relayInstruction(request);
    if (generation === revision) {
      sessionStorage.removeItem(pendingKey.value);
      emit('updated');
    }
  } catch (cause) {
    if (generation === revision) error.value = friendlyError(cause);
  } finally {
    if (generation === revision) busy.value = false;
  }
}
</script>
<template>
  <section class="panel narrow">
    <h3>Public directory card</h3>
    <p>
      Keep the summary brief. This text and all card images are public, including for encrypted
      DAOs.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <form v-if="member?.active && member.admin" @submit.prevent="save">
      <label for="card-summary">Card summary</label
      ><textarea id="card-summary" v-model="summary" maxlength="280" rows="3" />
      <fieldset>
        <legend>Upload a public card image</legend>
        <p class="field-help">
          PNG, JPEG or WebP, up to 2 MiB. Hosting counts toward this DAO's storage allowance
          immediately, including before you sign the card update. Unavailable images use Daclify's
          fallback.
        </p>
        <label for="brand-upload-slot">Image placement</label>
        <select id="brand-upload-slot" v-model="uploadSlot" :disabled="busy || !!pending">
          <option value="logo">Logo</option>
          <option value="cover">Cover</option>
        </select>
        <label for="brand-upload-file">Image file</label>
        <input
          id="brand-upload-file"
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          :disabled="busy || !!pending"
          @change="chooseFile"
        />
        <label class="checkbox"
          ><input v-model="publicConsent" type="checkbox" :disabled="busy" /> I understand this
          image is public and unencrypted, including for a private DAO.</label
        >
        <button
          type="button"
          :disabled="busy || !publicConsent || (!selectedFile && !pending)"
          @click="uploadImage"
        >
          {{ busy ? 'Working…' : pending ? 'Retry the same upload' : 'Upload and verify image' }}
        </button>
        <p v-if="pending" class="field-help">
          Upload request: {{ pending.requestId }}. Retry this request if completion is uncertain.
        </p>
      </fieldset>
      <label for="card-logo">Logo</label
      ><select id="card-logo" v-model="logo">
        <option value="">Initials</option>
        <option v-if="logo && !options.some((o) => o.value === logo)" :value="logo">
          Current public logo
        </option>
        <option v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <label for="card-cover">Cover</label
      ><select id="card-cover" v-model="cover">
        <option value="">Daclify fallback</option>
        <option v-if="cover && !options.some((o) => o.value === cover)" :value="cover">
          Current public cover
        </option>
        <option v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <details>
        <summary>Use existing public IPFS images</summary>
        <p class="field-help">
          Optional JSON with logo and/or cover objects: cid, bytes, mediaType and commitment
          (SHA-256). This replaces both image selections. Only public raster images are accepted; do
          not reference encrypted documents.
        </p>
        <label for="card-image-refs">Public image references JSON</label
        ><textarea id="card-image-refs" v-model="advanced" rows="5" spellcheck="false" />
      </details>
      <button :disabled="busy || !ready || !!pending">
        {{ busy ? 'Submitting…' : 'Sign and update card' }}
      </button>
      <p v-if="!ready" class="field-help">Choose an authorized administrator signer.</p>
    </form>
    <p v-else>Administrator permission is required to update the card.</p>
    <RouterLink to="/docs/dao-discovery" class="help-link">Directory help ↗</RouterLink>
  </section>
</template>
