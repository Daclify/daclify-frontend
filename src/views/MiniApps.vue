<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Bot, Cable, ArrowUpRight } from '@lucide/vue';
import { useWorkspace } from '../state/workspace';
import McpConnection from '../components/McpConnection.vue';
import MiniAppConnection from '../components/MiniAppConnection.vue';
import MiniAppListingForm from '../components/MiniAppListingForm.vue';
const state = useWorkspace(),
  route = useRoute(),
  selectedDao = ref('');
const daos = computed(() =>
  state.daos.filter(
    (dao) =>
      dao.reference.chainId === state.network?.chainId &&
      dao.reference.contract === state.network?.runtime,
  ),
);
watch(
  () => [state.account?.id, state.network?.chainId, state.network?.runtime],
  () => {
    selectedDao.value = '';
  },
);
</script>
<template>
  <div class="page mini-apps">
    <header class="mini-apps-heading">
      <p class="eyebrow">COMMUNITY TOOLS</p>
      <h1>Mini apps</h1>
      <p class="muted intro">
        Tools for your community. One Daclify account, permissions you choose.
      </p>
    </header>
    <p v-if="state.error" class="alert" role="alert">
      {{ state.error }}
      <button class="secondary" :disabled="state.loading" @click="state.refresh()">
        Retry connection
      </button>
    </p>
    <section id="discover" aria-labelledby="discover-title">
      <h2 id="discover-title">Apps for your community</h2>
      <MiniAppListingForm v-if="state.network?.capabilities.includes('mini-app-directory-v1')" />
      <div v-else class="panel">
        <p v-if="state.loading" role="status">Checking app discovery…</p>
        <template v-else>
          <p>
            App discovery is unavailable on this deployment. Choose a DAO to see its registered
            apps.
          </p>
          <RouterLink class="button secondary" :to="{ hash: '#connect' }">Choose a DAO</RouterLink>
        </template>
      </div>
    </section>
    <details id="connect" class="panel setup-panel" :open="route.hash === '#connect'">
      <summary><Cable aria-hidden="true" />Connect an app</summary>
      <div class="setup-content">
        <p>
          Choose your community to register an app, get its configuration or manage your grants.
        </p>
        <p v-if="!state.account" class="notice">
          <RouterLink :to="{ path: '/account', query: { returnTo: '/mini-apps#connect' } }"
            >Sign in</RouterLink
          >
          to connect an app or manage your existing grants.
        </p>
        <label for="mini-app-dao">Choose a DAO</label>
        <select id="mini-app-dao" v-model="selectedDao" :disabled="state.loading">
          <option value="">Select your community</option>
          <option v-for="dao in daos" :key="dao.reference.daoId" :value="dao.reference.daoId">
            {{ dao.title }}
          </option>
        </select>
        <p v-if="!selectedDao" class="field-help">
          Community administrators register apps. Members choose their own app permissions.
        </p>
        <p v-if="!state.loading && !daos.length" class="muted">
          No DAOs are available on this connection.
        </p>
        <MiniAppConnection v-if="selectedDao" :key="selectedDao" :dao-id="selectedDao" />
        <RouterLink class="help-link" to="/docs/connected-apps"
          >App connection guide <ArrowUpRight aria-hidden="true"
        /></RouterLink>
      </div>
    </details>
    <details id="ai-connections" class="panel setup-panel" :open="route.hash === '#ai-connections'">
      <summary><Bot aria-hidden="true" />AI connections</summary>
      <div class="setup-content">
        <p>Connect an AI assistant with permissions scoped to your DAO.</p>
        <McpConnection v-if="state.network?.capabilities.includes('community-mcp-local-v1')" />
        <p v-else>MCP connection setup is being qualified for this deployment.</p>
        <div class="button-row">
          <RouterLink class="help-link" to="/docs/community-mcp"
            >MCP connection guide <ArrowUpRight aria-hidden="true"
          /></RouterLink>
          <RouterLink class="help-link" to="/docs/agents"
            >AI participant guide <ArrowUpRight aria-hidden="true"
          /></RouterLink>
        </div>
      </div>
    </details>
    <details id="learn" class="panel quick-guide" :open="route.hash === '#learn'">
      <summary>How mini apps work</summary>
      <p class="muted">
        Apps run on their own hosting. Daclify verifies membership and records the activity your DAO
        needs.
      </p>
      <ol class="setup-steps">
        <li>
          <strong>Register the app</strong>
          <p>A community administrator approves its HTTPS origin and exact login callback.</p>
        </li>
        <li>
          <strong>Connect and deploy</strong>
          <p>
            Download the configuration and versioned starter, then deploy with persistent database
            storage.
          </p>
        </li>
        <li>
          <strong>Choose permissions</strong>
          <p>
            Members sign in and consent. Complete a test item and confirm its receipt in the DAO.
          </p>
        </li>
      </ol>
      <p class="muted">
        Members control app access. Reviews and DAO decisions keep their own permissions.
      </p>
      <RouterLink class="help-link" to="/docs/mini-app-database"
        >Database and deployment guide <ArrowUpRight aria-hidden="true"
      /></RouterLink>
    </details>
  </div>
</template>
<style scoped>
.mini-apps-heading {
  margin-bottom: 2rem;
}
.intro {
  max-width: 38rem;
  margin-bottom: 0;
}
.help-link {
  gap: 0.35rem;
}
.help-link svg,
.setup-panel svg {
  width: 18px;
  height: 18px;
  flex: none;
}
.setup-panel,
.quick-guide {
  margin-top: 1.5rem;
}
.setup-panel > summary,
.quick-guide > summary {
  min-height: 44px;
  padding: 0.5rem 0;
  font-weight: 650;
  cursor: pointer;
}
.setup-panel > summary svg {
  vertical-align: middle;
  margin-right: 0.5rem;
}
.setup-content {
  padding-top: 1rem;
}
.setup-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2rem;
  padding-left: 1.25rem;
}
.setup-steps li {
  padding-left: 0.25rem;
}
.setup-steps p {
  margin: 0.5rem 0;
}
select {
  max-width: 36rem;
}
@media (max-width: 700px) {
  .setup-steps {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
}
</style>
