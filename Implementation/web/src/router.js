import { createRouter, createWebHistory } from 'vue-router';
import { sessions } from './api.js';

const routes = [
  { path: '/', redirect: () => (sessions.owner ? '/campaigns' : sessions.cloud?.role === 'admin' ? '/monitor' : sessions.cloud ? '/board' : '/login') },
  { path: '/login', component: () => import('./views/Login.vue'), meta: { bare: true } },
  { path: '/campaigns', component: () => import('./views/Campaigns.vue'), meta: { domain: 'owner', title: 'Campaigns' } },
  { path: '/analysis/:id?', component: () => import('./views/Analysis.vue'), meta: { domain: 'owner', title: 'Analysis' } },
  { path: '/receipts/:id?', component: () => import('./views/Receipts.vue'), meta: { domain: 'owner', title: 'Receipts' } },
  { path: '/board', component: () => import('./views/Board.vue'), meta: { domain: 'cloud', roles: ['auditor', 'admin'], title: 'Bulletin board' } },
  { path: '/monitor', component: () => import('./views/Monitor.vue'), meta: { domain: 'cloud', roles: ['admin'], title: 'Monitor' } },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const { domain, roles } = to.meta;
  if (!domain) return true;
  const s = sessions[domain];
  if (!s || (roles && !roles.includes(s.role))) return { path: '/login', query: { domain, next: to.fullPath } };
  return true;
});

// A tab opened before a rebuild still asks for the old chunk names: load the new build instead.
router.onError((err, to) => {
  if (/dynamically imported module|Importing a module script failed/.test(err.message)) location.assign(to.fullPath);
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · E-Privacy` : 'E-Privacy';
});

export default router;
