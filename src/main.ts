import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { loadDeployedNetworks, operatorContextRejected } from './api/networks';
import '@fontsource-variable/inter';
import './styles.css';
await loadDeployedNetworks();
if (operatorContextRejected()) window.history.replaceState(null, '', '/');
const callback = new URL(window.location.href);
if (callback.searchParams.has('daclify_order') && callback.searchParams.has('daclify_dao')) {
  const query = new URLSearchParams({
    order: callback.searchParams.get('daclify_order') ?? '',
    dao: callback.searchParams.get('daclify_dao') ?? '',
  });
  window.history.replaceState(null, '', '/payments?' + query.toString());
}
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/Hub.vue') },
    { path: '/account', component: () => import('./views/Account.vue') },
    { path: '/daclify', component: () => import('./views/PlatformDao.vue') },
    { path: '/status', component: () => import('./views/Status.vue') },
    { path: '/create', component: () => import('./views/CreateDao.vue') },
    { path: '/hosting', component: () => import('./views/Hosting.vue') },
    { path: '/resources', component: () => import('./views/Resources.vue') },
    { path: '/payments', component: () => import('./views/Payments.vue') },
    { path: '/modules', component: () => import('./views/Modules.vue') },
    { path: '/names', component: () => import('./views/Names.vue') },
    {
      path: '/marketplace',
      redirect: (to) => ({
        path:
          to.query.names === 'submitted' || to.query.names === 'cancelled' ? '/names' : '/modules',
        query: to.query,
        hash: to.hash,
      }),
    },
    { path: '/dao/:id/:section?', component: () => import('./views/Workspace.vue') },
    { path: '/docs/:topic?', component: () => import('./views/Docs.vue') },
  ],
});
createApp(App).use(createPinia()).use(router).mount('#app');
