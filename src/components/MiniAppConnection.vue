<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import {
  IdSchema,
  type MiniAppConnection,
  type ConnectionDiagnostics,
  type DaoSummary,
} from '@daclify/core-protocol';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { connectionJson, connectionMember } from '../mini-apps/connection';
import { downloadFile } from '../content/files';
import ConnectedApps from '../views/ConnectedApps.vue';
const props = defineProps<{ daoId: string; appId?: string }>(),
  state = useWorkspace();
const dao = computed(() =>
  state.daos.find(
    (candidate) =>
      candidate.reference.daoId === props.daoId &&
      candidate.reference.chainId === state.network?.chainId &&
      candidate.reference.contract === state.network?.runtime,
  ),
);
const member = computed(() =>
  dao.value ? connectionMember(dao.value, state.memberships) : undefined,
);
const apps = ref<Awaited<ReturnType<typeof api.connectedApps>>>([]),
  selectedApp = ref(props.appId ?? ''),
  bundle = ref<MiniAppConnection>(),
  diagnostics = ref<ConnectionDiagnostics>(),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
let generation = 0;
const context = computed(() =>
  JSON.stringify([
    dao.value?.reference,
    state.account?.id,
    member.value?.memberId,
    member.value?.active,
    member.value?.admin,
  ]),
);
async function refreshApps() {
  const started = ++generation;
  bundle.value = undefined;
  diagnostics.value = undefined;
  apps.value = [];
  error.value = '';
  notice.value = '';
  busy.value = false;
  if (!dao.value || !member.value?.admin) return;
  try {
    const registered = await api.connectedApps(props.daoId);
    if (started !== generation) return;
    apps.value = registered;
    if (!registered.some((app) => app.config.appId === selectedApp.value))
      selectedApp.value = registered[0]?.config.appId ?? '';
  } catch (cause) {
    if (started === generation) error.value = friendlyError(cause);
  }
}
watch(context, refreshApps, { immediate: true, flush: 'sync' });
watch(
  selectedApp,
  () => {
    generation++;
    bundle.value = undefined;
    diagnostics.value = undefined;
    error.value = '';
    notice.value = '';
    busy.value = false;
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => {
  generation++;
});
async function load(check = false) {
  if (busy.value || !member.value?.admin || !dao.value || !selectedApp.value) return;
  const started = generation,
    selected = IdSchema.parse(selectedApp.value),
    currentDao: DaoSummary = dao.value;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const registered = apps.value.find((app) => app.config.appId === selected);
    if (!registered) throw new Error('APP_BINDING');
    const value = await api.miniAppConnection(props.daoId, selected);
    connectionJson(value, currentDao, selected, registered);
    if (started !== generation) return;
    bundle.value = value;
    diagnostics.value = value.diagnostics;
    if (check) {
      const result = await api.checkMiniAppConnection(props.daoId, selected);
      if (started !== generation) return;
      diagnostics.value = result;
    }
  } catch (cause) {
    if (started === generation) {
      bundle.value = undefined;
      diagnostics.value = undefined;
      error.value = friendlyError(cause);
    }
  } finally {
    if (started === generation) busy.value = false;
  }
}
function json() {
  const registered = apps.value.find((app) => app.config.appId === selectedApp.value);
  if (!bundle.value || !dao.value || !registered) throw new Error('APP_BINDING');
  return connectionJson(bundle.value, dao.value, selectedApp.value, registered);
}
function download() {
  downloadFile(new TextEncoder().encode(json()), {
    version: 1,
    filename: 'daclify-mini-app-connection.json',
    mediaType: 'application/json',
  });
}
async function copy() {
  const started = generation;
  try {
    await navigator.clipboard.writeText(json());
    if (started === generation) notice.value = 'Connection configuration copied.';
  } catch {
    if (started === generation)
      error.value = 'Copy was unavailable. Download the configuration instead.';
  }
}
const labels = {
  configuration: 'Registered configuration',
  readiness: 'App server readiness',
  identity: 'Member login',
  event: 'Recorded event',
};
</script>
<template>
  <section v-if="dao" aria-label="Connect a mini app">
    <h2>{{ dao.title }}</h2>
    <p v-if="!member">Sign in as an active member of this DAO to use connected apps.</p>
    <p v-else-if="!member.admin">
      Your community administrator registers apps. Ask them to connect your app; then choose the
      permissions you want to grant when signing in.
    </p>
    <ConnectedApps
      :dao="dao"
      :member="member"
      :show-signer="true"
      @registration-changed="refreshApps"
    >
      <template #connection>
        <template v-if="member?.admin && apps.length">
          <h3>Get your app connection</h3>
          <p>
            Use the registered app's exact HTTPS callback, deploy the starter with persistent
            storage, then check its server.
          </p>
          <label :for="`mini-app-${daoId}`">Registered app</label
          ><select :id="`mini-app-${daoId}`" v-model="selectedApp" :disabled="busy">
            <option value="">Choose an app</option>
            <option v-for="app in apps" :key="app.clientId" :value="app.config.appId">
              {{ app.config.name }}
            </option>
          </select>
          <div class="actions">
            <button :disabled="busy || !selectedApp" @click="load()">
              Get connection configuration</button
            ><button class="secondary" :disabled="busy || !selectedApp" @click="load(true)">
              Check app server
            </button>
          </div>
          <p v-if="error" role="alert">{{ error }}</p>
          <p v-if="notice" role="status">{{ notice }}</p>
          <template v-if="bundle">
            <p class="wrap">Exact login callback: {{ bundle.callbackUrl }}</p>
            <p>Starter core {{ bundle.coreVersion }} · modules {{ bundle.modulesVersion }}</p>
            <div class="actions">
              <button class="secondary" @click="copy">Copy configuration</button
              ><button class="secondary" @click="download">Download configuration</button
              ><a :href="bundle.starterUrl" target="_blank" rel="noopener noreferrer"
                >Download versioned starter ↗</a
              >
            </div>
          </template>
          <ul v-if="diagnostics" aria-label="Connection checks">
            <li v-for="check in diagnostics.checks" :key="check.stage">
              {{ labels[check.stage] }}:
              {{ check.status === 'not-run' ? 'Not checked' : check.status
              }}<span v-if="check.codes.length"> · {{ check.codes.join(', ') }}</span>
            </li>
          </ul>
          <p>
            Server readiness checks the database binding. To verify login, sign into the app as a
            member and review its consent request. Complete a test item and confirm the matching
            receipt below. These steps require separate confirmation.
          </p>
          <RouterLink to="/docs/mini-app-database">Database and deployment guide ↗</RouterLink>
        </template>
      </template>
    </ConnectedApps>
  </section>
  <p v-else role="status">
    This DAO is unavailable on the selected network. Refresh the connection or choose another DAO.
  </p>
</template>
<style scoped>
.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin: 1rem 0;
}
select {
  max-width: 100%;
}
</style>
