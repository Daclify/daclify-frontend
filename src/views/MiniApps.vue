<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspace } from '../state/workspace';
import McpConnection from '../components/McpConnection.vue';
import MiniAppConnection from '../components/MiniAppConnection.vue';
const state = useWorkspace(),
  selectedDao = ref('');
const daos = computed(() =>
  state.daos.filter(
    (dao) =>
      dao.reference.chainId === state.network?.chainId &&
      dao.reference.contract === state.network?.runtime,
  ),
);
</script>
<template>
  <div class="page">
    <h1>Mini apps</h1>
    <p>
      Build tools for your community. Members use their existing Daclify account and DAO membership.
    </p>
    <nav class="actions" aria-label="Mini app guide">
      <a href="#learn">Learn</a><a href="#connect">Connect / build</a
      ><a href="#discover">Discover</a><a href="#ai-connections">AI connections</a>
    </nav>
    <section id="learn">
      <h2>Learn</h2>
      <p>
        A mini app runs on your own hosting with SQLite, PostgreSQL or another database. Daclify
        verifies membership and records the selected activity your DAO needs. Registration and
        member consent are self-service.
      </p>
      <ol>
        <li>
          Choose a DAO and have a community administrator register the app’s HTTPS origin and exact
          login callback.
        </li>
        <li>
          Download its connection configuration and versioned starter. Deploy it with persistent
          database storage.
        </li>
        <li>
          Members sign in and choose their permissions. Complete a test item and confirm its receipt
          in the DAO.
        </li>
      </ol>
      <p>
        Members control app access. Independent reviews and DAO decisions retain their own
        permissions.
      </p>
      <RouterLink to="/docs/connected-apps">Connection guide ↗</RouterLink> ·
      <RouterLink to="/docs/mini-app-database">Database guide ↗</RouterLink>
    </section>
    <section id="connect">
      <h2>Connect / build</h2>
      <p v-if="!state.account">
        <RouterLink :to="{ path: '/account', query: { returnTo: '/mini-apps' } }"
          >Sign in</RouterLink
        >
        to connect an app or manage your existing grants.
      </p>
      <p v-if="state.error" role="alert">
        {{ state.error }}
        <button class="secondary" :disabled="state.loading" @click="state.refresh()">
          Retry connection
        </button>
      </p>
      <label for="mini-app-dao">Choose a DAO</label
      ><select id="mini-app-dao" v-model="selectedDao">
        <option value="">Select your community</option>
        <option v-for="dao in daos" :key="dao.reference.daoId" :value="dao.reference.daoId">
          {{ dao.title }}
        </option></select
      ><MiniAppConnection v-if="selectedDao" :key="selectedDao" :dao-id="selectedDao" />
    </section>
    <section id="discover">
      <h2>Discover</h2>
      <p>
        A community app directory is being prepared. Your DAO’s registered apps are available above
        after you sign in.
      </p>
    </section>
    <section id="ai-connections">
      <h2>AI connections</h2>
      <p>
        Communities can build tools for human members, AI participants or both. AI actions use
        explicitly scoped credentials and the DAO’s governance rules.
      </p>
      <p v-if="state.network?.capabilities.includes('community-mcp-local-v1')">
        Local MCP pairing is available. Approve a scoped delegate in Daclify and configure your
        harness on a trusted host.
      </p>
      <p v-else>MCP connection setup is being qualified for this deployment.</p>
      <McpConnection v-if="state.network?.capabilities.includes('community-mcp-local-v1')" />
      <RouterLink to="/docs/community-mcp">MCP connection guide ↗</RouterLink> ·
      <RouterLink to="/docs/agents">AI participant guide ↗</RouterLink>
    </section>
  </div>
</template>
<style scoped>
.actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
section {
  margin: 2rem 0;
  scroll-margin-top: 1rem;
}
select {
  max-width: 100%;
}
</style>
