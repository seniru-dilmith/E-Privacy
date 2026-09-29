import { createRouter, createWebHistory } from 'vue-router';
import { sessions } from './api.js';

const routes = [
  { path: '/', redirect: () => (sessions.owner ? '/campaigns' : sessions.cloud?.role === 'admin' ? '/monitor' : sessions.cloud ? '/board' : '/login') },
  { path: '/login', component: () => import('./views/Login.vue'), meta: { bare: true } },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const { domain, roles } = to.meta;
  if (!domain) return true;
  const s = sessions[domain];
  if (!s || (roles && !roles.includes(s.role))) return { path: '/login', query: { domain, next: to.fullPath } };
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · E-Privacy` : 'E-Privacy';
});

export default router;
