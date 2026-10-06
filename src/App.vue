<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  Blocks,
  BookOpen,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  UserRound,
} from '@lucide/vue';
import { useWorkspace } from './state/workspace';
import { lockVault, vaultUnlocked } from './auth/session';
import { chooseNetwork, selectedNetwork, type DeployedNetwork } from './api/networks';
const state = useWorkspace();
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
      <RouterLink class="brand" to="/" @click="mobileOpen = false"
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
      <button type="button" class="nav-fold" :aria-expanded="!folded" @click="toggleFold">
        <PanelLeftClose v-if="!folded" class="nav-icon" aria-hidden="true" />
        <PanelLeftOpen v-else class="nav-icon" aria-hidden="true" />
        <span class="nav-text">{{ folded ? 'Expand menu' : 'Fold menu' }}</span>
      </button>
      <nav id="primary-links" :class="{ 'mobile-open': mobileOpen }">
        <p class="nav-label">WORKSPACE</p>
        <RouterLink to="/" @click="mobileOpen = false"
          ><LayoutGrid class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >DAO hub</span
          ></RouterLink
        >
        <RouterLink to="/create" @click="mobileOpen = false"
          ><Plus class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Create DAO</span
          ></RouterLink
        >
        <RouterLink to="/account" @click="mobileOpen = false"
          ><UserRound class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Account</span
          ></RouterLink
        >
        <p class="nav-label">RESOURCES</p>
        <RouterLink to="/docs" @click="mobileOpen = false"
          ><BookOpen class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Documentation</span
          ></RouterLink
        >
        <RouterLink to="/docs/modules" @click="mobileOpen = false"
          ><Blocks class="nav-icon" aria-hidden="true" /><span class="nav-text"
            >Module guide</span
          ></RouterLink
        >
      </nav>
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
          >Daclify <span aria-hidden="true">/</span> Community workspace</span
        >
        <div class="topbar-account">
          <div
            v-if="networkChoice"
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
          <span class="pill" :class="{ success: vaultUnlocked }">{{
            vaultUnlocked ? 'Vault unlocked' : 'Vault locked'
          }}</span
          ><button v-if="vaultUnlocked" class="text-button" @click="lockVault">Lock keys</button
          ><RouterLink class="account-link" to="/account">{{
            state.account ? 'Your account' : 'Set up account'
          }}</RouterLink>
        </div>
      </header>
      <main id="main" tabindex="-1">
        <div v-if="state.error" class="alert" role="alert">
          {{ state.error }}
          <button class="text-button" @click="state.refresh">Retry connection</button>
        </div>
        <RouterView />
      </main>
      <footer class="page-footer">
        <span>Built for communities that make things happen.</span
        ><RouterLink to="/docs/privacy">Privacy &amp; trust</RouterLink>
      </footer>
    </div>
  </div>
</template>
