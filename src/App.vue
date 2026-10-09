<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Activity,
  Shield,
  BookOpen,
  Blocks,
  AtSign,
  LayoutGrid,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Users,
  Bot,
} from '@lucide/vue';
import { useWorkspace } from './state/workspace';
import { lockVault, vaultUnlocked } from './auth/session';
import {
  chooseNetwork,
  selectedNetwork,
  currentOperator,
  closeOperator,
  type DeployedNetwork,
  deploymentNetwork,
} from './api/networks';
import HelpWindow from './components/HelpWindow.vue';
const helpOpen = ref(false),
  helpStarted = ref(false);
function toggleHelp() {
  helpStarted.value = true;
  helpOpen.value = !helpOpen.value;
  mobileOpen.value = false;
}
const deployment = deploymentNetwork();
const operator = currentOperator();
function leaveOperator(destination = '/hub') {
  lockVault();
  closeOperator();
  window.location.assign(destination);
}
const state = useWorkspace();
const route = useRoute(),
  router = useRouter(),
  routeError = ref('');
const removeRouteError = router.onError((_error, to) => {
  routeError.value = to.fullPath;
});
const removeRouteSuccess = router.afterEach((_to, _from, failure) => {
  if (!failure) routeError.value = '';
});
onBeforeUnmount(() => {
  removeRouteError();
  removeRouteSuccess();
});
function reloadPage() {
  window.location.reload();
}
const mobileOpen = ref(false);
function storedFold(): boolean {
  try {
    return localStorage.getItem('daclify.nav.folded') === '1';
  } catch {
    return false;
  }
}
const folded = ref(storedFold());
function toggleFold() {
  folded.value = !folded.value;
  try {
    localStorage.setItem('daclify.nav.folded', folded.value ? '1' : '0');
  } catch {
    // The menu still folds for this view when storage is blocked.
  }
}
const networkChoice = ref(selectedNetwork());
function selectServiceNetwork(name: DeployedNetwork) {
  chooseNetwork(name);
  networkChoice.value = name;
  if (operator) {
    leaveOperator();
    return;
  }
  void state.refresh();
}
onMounted(() => {
  void state.refresh();
});
</script>
<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="app-shell" :class="{ 'nav-folded': folded }">
    <aside class="sidebar" aria-label="Primary navigation">
      <RouterLink class="brand" to="/" aria-label="Daclify home" @click="mobileOpen = false"
        ><span class="brand-mark" aria-hidden="true">d.</span
        ><span class="brand-name"
          >daclify<span class="brand-caption">GOVERN TOGETHER</span></span
        ></RouterLink
      >
      <button
        class="mobile-menu secondary"
        :aria-expanded="mobileOpen"
        aria-controls="primary-links"
        @click="mobileOpen = !mobileOpen"
      >
        Menu
      </button>
      <nav id="primary-links" :class="{ 'mobile-open': mobileOpen }">
        <RouterLink
          :to="{ path: '/hub', query: { mine: '1' } }"
          aria-label="My DAO"
          :exact-active-class="route.query.mine === '1' ? 'router-link-exact-active' : ''"
          :aria-current-value="route.query.mine === '1' ? 'page' : 'false'"
          @click="mobileOpen = false"
          ><Network class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >My DAO</span
          ></RouterLink
        >
        <RouterLink
          to="/hub"
          aria-label="Hub"
          :exact-active-class="route.query.mine === '1' ? '' : 'router-link-exact-active'"
          :aria-current-value="route.query.mine === '1' ? 'false' : 'page'"
          @click="mobileOpen = false"
          ><LayoutGrid class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Hub</span
          ></RouterLink
        >
        <RouterLink to="/create" aria-label="Create" @click="mobileOpen = false"
          ><Plus class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Create</span
          ></RouterLink
        >
        <RouterLink to="/modules" aria-label="Modules" @click="mobileOpen = false"
          ><Blocks class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Modules</span
          ></RouterLink
        >
        <RouterLink to="/users" aria-label="Users" @click="mobileOpen = false"
          ><Users class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Users</span
          ></RouterLink
        >
        <RouterLink to="/docs" aria-label="Documentation" @click="mobileOpen = false"
          ><BookOpen class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Documentation</span
          ></RouterLink
        >
        <RouterLink to="/status" aria-label="Status" @click="mobileOpen = false"
          ><Activity class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Status</span
          ></RouterLink
        >
        <a
          v-if="operator"
          href="/daclify"
          aria-label="Daclify DAO"
          @click.prevent="leaveOperator('/daclify')"
          ><Shield class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Daclify DAO</span
          ></a
        >
        <RouterLink v-else to="/daclify" aria-label="Daclify DAO" @click="mobileOpen = false"
          ><Shield class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Daclify DAO</span
          ></RouterLink
        >
        <RouterLink to="/names" aria-label="Names" @click="mobileOpen = false"
          ><AtSign class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Names</span
          ></RouterLink
        >
        <button
          type="button"
          id="help-launcher"
          class="nav-help"
          aria-label="Help"
          title="Help"
          :aria-expanded="helpOpen"
          :aria-controls="helpStarted ? 'help-window' : undefined"
          @click="toggleHelp"
        >
          <Bot class="nav-icon" aria-hidden="true" /><span class="nav-text">Help</span>
        </button>
      </nav>
      <button
        type="button"
        class="nav-fold"
        :aria-label="folded ? 'Expand menu' : 'Fold menu'"
        :title="folded ? 'Expand menu' : 'Fold menu'"
        :aria-expanded="!folded"
        aria-controls="primary-links"
        @click="toggleFold"
      >
        <PanelLeftClose v-if="!folded" class="nav-icon" aria-hidden="true" />
        <PanelLeftOpen v-else class="nav-icon" aria-hidden="true" />
      </button>
      <div class="sidebar-footer">
        <span class="status-dot" aria-hidden="true"></span
        ><span class="sidebar-meta"
          ><span>{{ state.network?.environment ?? 'Connecting' }} network</span
          ><small
            >Core interface {{ state.network?.interfaceVersion ?? '—' }} · v{{
              state.network?.coreVersion ?? '—'
            }}</small
          ></span
        >
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <span class="breadcrumb"
          >Daclify <span aria-hidden="true">/</span>
          {{ route.path === '/' ? 'Welcome' : 'Community workspace' }}</span
        >
        <div class="topbar-account">
          <div
            v-if="networkChoice && !deployment"
            class="network-switch"
            role="group"
            aria-label="Service network"
          >
            <button
              type="button"
              :aria-pressed="networkChoice === 'production'"
              @click="selectServiceNetwork('production')"
            >
              Production
            </button>
            <button
              type="button"
              :aria-pressed="networkChoice === 'testnet'"
              @click="selectServiceNetwork('testnet')"
            >
              Testnet
            </button>
          </div>
          <span v-else-if="deployment" class="pill" role="status" aria-label="Deployment network">{{
            deployment === 'testnet' ? 'Testnet' : 'Production'
          }}</span>
          <span class="pill" :class="{ success: vaultUnlocked }">{{
            vaultUnlocked ? 'Vault unlocked' : 'Vault locked'
          }}</span
          ><button v-if="vaultUnlocked" class="text-button" @click="lockVault">Lock keys</button
          ><button v-if="operator" class="secondary" @click="leaveOperator()">
            Return to Daclify Hub</button
          ><RouterLink
            class="account-link"
            :to="{
              path: state.account ? '/users/me' : '/account',
              query: route.path === '/account' ? {} : { returnTo: route.fullPath },
            }"
            >{{ state.account ? 'Your account' : 'Sign in' }}</RouterLink
          >
        </div>
      </header>
      <main id="main" tabindex="-1">
        <p v-if="operator" class="notice break-word">
          <strong>Independent operator: {{ operator.operator }}</strong
          ><span v-if="operator.portal.mode === 'daclify'"> · {{ operator.portal.apiOrigin }}</span
          >. Your service account and sign-in pairings belong to this operator.
        </p>
        <div v-if="state.error" class="alert" role="alert">
          {{ state.error }}
          <button class="text-button" @click="state.refresh">Retry connection</button>
        </div>
        <section v-if="routeError" class="panel narrow" role="alert">
          <h1>This page could not load</h1>
          <p>
            The app may have been updated or the connection interrupted. Reload to fetch the current
            page.
          </p>
          <button type="button" @click="reloadPage">Reload page</button
          ><RouterLink class="button secondary" to="/hub">Back to DAO hub</RouterLink>
        </section>
        <RouterView v-else-if="route.path === '/' || !deployment || state.network" />
        <p v-else class="notice" role="status">
          {{
            state.loading
              ? 'Verifying the deployment network…'
              : 'The workspace is unavailable until its network connection is verified.'
          }}
        </p>
      </main>
      <footer class="page-footer">
        <span>Built for communities that make things happen.</span
        ><RouterLink to="/docs/privacy">Privacy &amp; trust</RouterLink>
        <RouterLink to="/docs/license">Source &amp; license</RouterLink>
      </footer>
    </div>
    <HelpWindow v-if="helpStarted" v-model="helpOpen" />
  </div>
</template>
