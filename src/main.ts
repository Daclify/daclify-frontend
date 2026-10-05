import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './styles.css';
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/Hub.vue') },
    { path: '/account', component: () => import('./views/Account.vue') },
    { path: '/create', component: () => import('./views/CreateDao.vue') },
    { path: '/dao/:id/:section?', component: () => import('./views/Workspace.vue') },
    { path: '/docs/:topic?', component: () => import('./views/Docs.vue') },
  ],
});
createApp(App).use(createPinia()).use(router).mount('#app');
