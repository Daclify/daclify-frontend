<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { z } from 'zod';
import {
  ApiRoutes,
  daoPaymentKey,
  McpLocalConfigurationSchema,
  type McpScopeSchema,
} from '@daclify/core-protocol';
import { encodeAction, makeInstruction } from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { resolveApiUrl } from '../api/networks';
import ActionSigner from './ActionSigner.vue';
import { useWorkspace } from '../state/workspace';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
const state = useWorkspace(),
  selected = ref(''),
  scopes = ref<Array<z.infer<typeof McpScopeSchema>>>(['vote']),
  release = ref<z.infer<typeof ApiRoutes.mcpRelease.response>>(),
  inventory = ref<z.infer<typeof ApiRoutes.mcpConnections.response>>(),
  busy = ref(''),
  error = ref('');
const member = computed(() =>
    state.memberships.find(
      (value) => value.active && daoPaymentKey(value.dao) + ':' + value.memberId === selected.value,
    ),
  ),
  routineScopes = ['proposal', 'vote', 'review'] as const;
let generation = 0;
async function load() {
  const started = ++generation;
  release.value = undefined;
  inventory.value = undefined;
  error.value = '';
  if (!state.account) return;
  const results = await Promise.allSettled([api.mcpRelease(), api.mcpConnections()]);
  if (started !== generation) return;
  const artifact = results[0],
    grants = results[1];
  if (artifact?.status === 'fulfilled') release.value = artifact.value;
  else error.value = 'Connection downloads are unavailable on this deployment.';
  if (grants?.status === 'fulfilled') inventory.value = grants.value;
  else if (grants?.status === 'rejected') error.value = friendlyError(grants.reason);
}
watch(
  () => [state.account?.id, state.network?.chainId, resolveApiUrl('/')],
  () => {
    selected.value = '';
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
const localConnections = computed(
  () =>
    inventory.value?.local.map((item) => ({
      ...item,
      member: state.memberships.find(
        (value) =>
          value.active &&
          value.memberId === item.grant.memberId &&
          daoPaymentKey(value.dao) === daoPaymentKey(item.grant.dao),
      ),
    })) ?? [],
);
function saveConfiguration() {
  const value = member.value;
  if (!value || !scopes.value.length) return;
  const config = McpLocalConfigurationSchema.parse({
    version: 1,
    api: new URL(resolveApiUrl('/'), window.location.origin).origin,
    frontend: window.location.origin,
    dao: value.dao,
    memberId: value.memberId,
    scopes: scopes.value,
  });
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(config, null, 2) + '\n'], { type: 'application/json' }),
    ),
    link = document.createElement('a');
  link.href = url;
  link.download = 'daclify-mcp-connection.json';
  link.click();
  URL.revokeObjectURL(url);
}
async function revokeLocal(id: string) {
  busy.value = id;
  error.value = '';
  try {
    await api.mcpRevokeGrant(id);
    await load();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = '';
  }
}
async function revokeRemote(id: string) {
  busy.value = id;
  error.value = '';
  try {
    await api.mcpRevokeFamily(id);
    await load();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = '';
  }
}
async function retire(id: string) {
  const item = inventory.value?.local.find((value) => value.grant.id === id);
  if (!item || busy.value) return;
  busy.value = id;
  error.value = '';
  try {
    await state.refresh();
    const current = state.memberships.find(
      (value) =>
        value.active &&
        value.memberId === item.grant.memberId &&
        daoPaymentKey(value.dao) === daoPaymentKey(item.grant.dao),
    );
    if (!current || !canSignMember(current)) throw Error('MCP_ROOT_CEREMONY_REQUIRED');
    const payload = encodeAction('delsession', {
      runtime: current.dao.contract,
      dao_id: current.dao.daoId,
      member_id: current.memberId,
      session_id: item.grant.sessionId,
    });
    await relayInstruction(
      makeInstruction(
        current.dao,
        current.memberId,
        current.nonce,
        Math.floor(Date.now() / 1000) + 300,
        current.dao.contract,
        'delsession',
        payload,
      ),
    );
    await api.mcpRevokeGrant(id);
    await load();
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = '';
  }
}
</script>
<template>
  <section aria-label="AI connection setup">
    <h3>Set up a local connection</h3>
    <p v-if="!state.account">
      <RouterLink :to="{ path: '/account', query: { returnTo: '/mini-apps#ai-connections' } }"
        >Sign in</RouterLink
      >
      to choose a membership and download public configuration.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="state.account">
      <label
        >AI community membership<select v-model="selected">
          <option value="">Choose a membership</option>
          <option
            v-for="value in state.memberships.filter((item) => item.active)"
            :key="daoPaymentKey(value.dao) + ':' + value.memberId"
            :value="daoPaymentKey(value.dao) + ':' + value.memberId"
          >
            DAO {{ value.dao.daoId }}, member {{ value.memberId }}
          </option>
        </select></label
      >
      <fieldset>
        <legend>Routine permissions</legend>
        <label v-for="scope in routineScopes" :key="scope"
          ><input v-model="scopes" type="checkbox" :value="scope" />{{ scope }}</label
        >
      </fieldset>
      <p>
        Activity requires an app-specific grant. Follow that app’s connection guide for its approved
        configuration and revision.
      </p>
      <button :disabled="!member || !scopes.length || !release" @click="saveConfiguration">
        Download public MCP configuration
      </button>
      <template v-if="release"
        ><p>
          Install this version-matched set together: core {{ release.coreVersion }}, modules
          {{ release.modulesVersion }}, MCP {{ release.mcpVersion }}.
        </p>
        <ul>
          <li v-for="file in release.files" :key="file.name">
            <a
              :href="resolveApiUrl('/v1/mcp/releases/' + release.releaseId + '/files/' + file.name)"
              >Download {{ file.name }}</a
            ><span class="identifier"> SHA-256 {{ file.sha256 }}</span>
          </li>
        </ul>
        <pre>
npm install --ignore-scripts ./core.tgz ./modules.tgz ./mcp.tgz
npx daclify-community-mcp pair --config /absolute/daclify-mcp-connection.json --credentials /absolute/private-directory/delegate.json --socket /absolute/private-directory/companion.sock
npx daclify-community-mcp serve --credentials /absolute/private-directory/delegate.json --socket /absolute/private-directory/companion.sock</pre>
      </template>
      <p>
        Pair on a trusted host with a controlling terminal. The harness configuration contains only
        a command, arguments and encrypted-file reference. Start the companion in your trusted
        foreground terminal. Background clients connect through its private socket reference.
      </p>
      <h3>Your connections</h3>
      <button class="secondary" :disabled="!!busy" @click="load">Refresh connections</button>
      <ul>
        <li v-for="item in localConnections" :key="item.grant.id">
          Local DAO {{ item.grant.dao.daoId }}, member {{ item.grant.memberId }}, session
          {{ item.grant.sessionId }} — {{ item.grant.scopes.join(', ') }}; expires
          {{ new Date(item.grant.sessionExpires * 1000).toLocaleString() }}.
          {{ item.revoked ? 'Service access revoked.' : '' }}
          <ActionSigner
            v-if="item.member"
            :member="item.member"
            label="native session retirement"
          /><button :disabled="!!busy || item.revoked" @click="revokeLocal(item.grant.id)">
            Revoke service access</button
          ><button :disabled="!!busy || !item.member" @click="retire(item.grant.id)">
            Retire native signing session
          </button>
        </li>
        <li v-for="item in inventory?.remote ?? []" :key="item.id">
          Hosted {{ item.clientId }} — DAO {{ item.dao.daoId }}, member {{ item.memberId }},
          {{ item.scopes.join(', ') }}; expires {{ new Date(item.expires).toLocaleString() }}.
          {{ item.revoked ? 'Revoked.' : ''
          }}<button :disabled="!!busy || item.revoked" @click="revokeRemote(item.id)">
            Revoke hosted connection
          </button>
        </li>
      </ul>
      <p>
        Service revocation blocks Daclify’s hosted transport. Retiring the native session also
        disables independent copies of that delegate. An uncertain native response requires checking
        the existing session before retrying.
      </p>
    </template>
    <p v-if="state.network?.capabilities.includes('community-mcp-http-v1')">
      Hosted endpoint: <code>{{ resolveApiUrl('/mcp') }}</code
      >. Use a preregistered client; read and preview work without a local signer. Signed submission
      needs a separately approved companion.
    </p>
    <details
      v-if="
        state.network?.capabilities.includes('community-mcp-http-v1') &&
        resolveApiUrl('/mcp') === 'https://testnet.api.daclify.com/mcp'
      "
    >
      <summary>Connect Codex CLI, Claude Code or ChatGPT on testnet</summary>
      <h3>Codex CLI</h3>
      <p>Add this public configuration to your Codex config, then run the login command.</p>
      <pre><code>[mcp_servers.daclify_testnet]
url = "https://testnet.api.daclify.com/mcp"

[mcp_servers.daclify_testnet.oauth]
client_id = "daclify-codex-testnet"
callback_url = "http://127.0.0.1:35829/callback"
callback_port = 35829</code></pre>
      <pre><code>codex mcp login daclify_testnet</code></pre>
      <h3>Claude Code</h3>
      <pre><code>claude mcp add --transport http --client-id daclify-claude-testnet --callback-port 35839 daclify_testnet https://testnet.api.daclify.com/mcp
claude mcp login daclify_testnet</code></pre>
      <h3>ChatGPT</h3>
      <p>
        Add a custom MCP connection with this same endpoint and OAuth authentication. Choose client
        metadata registration when offered. Daclify verifies ChatGPT’s published client metadata and
        exact callback. The ChatGPT account connection still needs its first complete client test.
      </p>
      <p>
        Sign in to Daclify, select your community and choose read and preview access or an existing
        signing companion. These configurations contain no secret. The local callback ports must be
        free on the computer where you run each CLI.
      </p>
    </details>
    <p>
      Official SDK transports and individual harness versions are qualified separately. Check the
      versioned MCP guide’s capability matrix before connecting a client.
    </p>
  </section>
</template>
<style scoped>
label {
  display: block;
  margin: 0.5rem 0;
}
select {
  display: block;
  max-width: 100%;
}
.identifier {
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
li {
  margin: 0.75rem 0;
}
</style>
