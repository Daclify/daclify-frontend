import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { loadDeployedNetworks } from './api/networks';
import '@fontsource-variable/inter';
import './styles.css';
await loadDeployedNetworks();
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/Hub.vue') },
    { path: '/account', component: () => import('./views/Account.vue') },
    { path: '/daclify', component: () => import('./views/PlatformDao.vue') },
    { path: '/status', component: () => import('./views/Status.vue') },
    { path: '/create', component: () => import('./views/CreateDao.vue') },
    { path: '/marketplace', component: () => import('./views/Marketplace.vue') },
    { path: '/dao/:id/:section?', component: () => import('./views/Workspace.vue') },
    { path: '/docs/:topic?', component: () => import('./views/Docs.vue') },
  ],
});
createApp(App).use(createPinia()).use(router).mount('#app');
