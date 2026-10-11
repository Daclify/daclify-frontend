<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { z } from 'zod';
import {
  AppSnapshotDraftSchema,
  PrivateFilePayloadSchema,
  daoPaymentKey,
} from '@daclify/core-protocol';
import { readAppResponse } from '@daclify/core-protocol/connected-apps';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { encryptAppSnapshot, vaultUnlocked } from '../auth/session';
import { encodeStoredBytes } from '../content/files';
const route = useRoute(),
  state = useWorkspace(),
  draft = ref<z.infer<typeof AppSnapshotDraftSchema>>(),
  error = ref(''),
  notice = ref(''),
  busy = ref(false),
  files = ref<z.infer<typeof PrivateFilePayloadSchema>[]>([]),
  access =
    ref<z.infer<typeof import('@daclify/core-protocol').ApiRoutes.appSourceAccess.response>>();
const clientId = computed(() =>
    typeof route.query.clientId === 'string' ? route.query.clientId : '',
  ),
  eventId = computed(() => (typeof route.query.event === 'string' ? route.query.event : '')),
  context = computed(() =>
    JSON.stringify([
      clientId.value,
      eventId.value,
      state.account?.id,
      state.network?.chainId,
      state.network?.runtime,
      vaultUnlocked.value,
    ]),
  );
let generation = 0;
function url(path: string) {
  if (!access.value) throw new Error('APP_SOURCE_UNAVAILABLE');
  const value = new URL(access.value.apiBase);
  value.pathname = value.pathname.replace(/\/$/, '') + path;
  return value;
}
watch(
  context,
  async () => {
    const started = ++generation;
    draft.value = undefined;
    access.value = undefined;
    files.value = [];
    error.value = '';
    notice.value = '';
    busy.value = false;
    if (!state.account) return;
    try {
      z.uuid().parse(clientId.value);
      z.string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(eventId.value);
      const token = await api.appSourceAccess(clientId.value);
      if (started !== generation) return;
      access.value = token;
      const response = await fetch(url('/v1/outbox/' + eventId.value), {
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          headers: { authorization: 'Bearer ' + token.accessToken },
          signal: AbortSignal.timeout(15000),
        }),
        value = AppSnapshotDraftSchema.parse(
          JSON.parse(new TextDecoder().decode(await readAppResponse(response))),
        );
      if (value.eventId !== eventId.value) throw new Error('APP_SOURCE_MISMATCH');
      if (started === generation) draft.value = value;
    } catch (cause) {
      if (started === generation) error.value = friendlyError(cause);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
async function add(event: Event) {
  const started = generation,
    input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  try {
    const selected = [];
    for (const file of input.files ?? []) {
      if (file.size > 2 * 1024 * 1024 || selected.length >= 8) throw new Error('FILE_TOO_LARGE');
      selected.push(
        PrivateFilePayloadSchema.parse({
          version: 1,
          filename: file.name,
          mediaType: file.type || 'application/octet-stream',
          content: encodeStoredBytes(new Uint8Array(await file.arrayBuffer())),
        }),
      );
    }
    if (started === generation) files.value = selected;
  } catch (cause) {
    error.value = friendlyError(cause);
  }
  input.value = '';
}
async function publish() {
  if (!draft.value || !access.value || busy.value || !state.account) return;
  const started = generation,
    selected = draft.value,
    token = access.value;
  busy.value = true;
  error.value = '';
  try {
    await state.refresh();
    const matched = state.memberships.find(
      (m) =>
        m.active &&
        m.memberId === token.memberId &&
        daoPaymentKey(m.dao) === daoPaymentKey(token.dao),
    );
    if (!matched) throw new Error('MEMBERSHIP_REQUIRED');
    const apps = await api.connectedApps(matched.dao.daoId),
      app = apps.find((a) => a.clientId === clientId.value);
    if (!app?.native?.enabled || app.config.appId !== token.appId) throw new Error('APP_DISABLED');
    const keys = await api.appKeys(matched.dao.daoId, app.config.appId),
      key = keys.keys.find((k) => k.id === keys.currentEpoch),
      grant = keys.grants.find((g) => g.key_epoch === keys.currentEpoch);
    if (
      !key ||
      !grant ||
      key.security_epoch !== app.native.security_epoch ||
      key.app_revision !== app.native.revision
    )
      throw new Error('APP_KEY_REQUIRED');
    if (started !== generation) throw new Error('WALLET_CONTEXT_CHANGED');
    const plaintext = new TextEncoder().encode(
        JSON.stringify(
          AppSnapshotDraftSchema.parse({ ...selected, files: [...selected.files, ...files.value] }),
        ),
      ),
      encrypted = await encryptAppSnapshot(
        {
          dao: matched.dao,
          appId: app.config.appId,
          keyEpoch: key.id,
          sourceId: selected.source.sourceId,
          sourceRevision: selected.source.sourceRevision,
          eventId: selected.eventId,
        },
        matched.memberId,
        key,
        grant,
        plaintext,
      );
    if (started !== generation) throw new Error('WALLET_CONTEXT_CHANGED');
    const response = await fetch(url('/v1/evidence/' + selected.eventId), {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { authorization: 'Bearer ' + token.accessToken, 'content-type': 'application/json' },
      body: Uint8Array.from(encrypted.bytes).buffer,
      signal: AbortSignal.timeout(20000),
    });
    await readAppResponse(response, 65536);
    if (started === generation)
      notice.value =
        'Encrypted snapshot pinned by your app. Return to the app and confirm the completion.';
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  } finally {
    if (started === generation) busy.value = false;
  }
}
</script>
<template>
  <section class="panel">
    <h1>Save encrypted app evidence</h1>
    <p v-if="!state.account">Sign in to your Daclify account to prepare this snapshot.</p>
    <RouterLink
      v-if="!state.account"
      :to="{ path: '/account', query: { returnTo: route.fullPath } }"
      >Sign in</RouterLink
    ><template v-if="draft"
      ><h2>{{ draft.source.title }}</h2>
      <p>{{ draft.source.details }}</p>
      <p class="mono wrap">Source revision {{ draft.source.sourceRevision }}</p>
      <p>
        Only encrypted bytes are sent to the app’s IPFS pinning service. Your app signing credential
        remains separate.
      </p>
      <label
        >Additional evidence files (optional)<input
          type="file"
          multiple
          :disabled="busy"
          @change="add"
      /></label>
      <p v-for="file in files" :key="file.filename">{{ file.filename }}</p>
      <p v-if="!vaultUnlocked">
        Unlock your Daclify vault from Account to use your snapshot grant.
      </p>
      <button :disabled="busy || !vaultUnlocked || !!notice" @click="publish">
        {{ busy ? 'Encrypting and pinning…' : 'Encrypt and pin snapshot' }}
      </button></template
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>
<style scoped>
.panel {
  max-width: 44rem;
  margin: 2rem auto;
}
</style>
