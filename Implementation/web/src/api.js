// Two independent sessions: one with the hospital's own agent (trusted), one
// with the cloud gateway (untrusted). They never share a token.
import { reactive } from 'vue';

const KEY = { owner: 'ep.session.owner', cloud: 'ep.session.cloud' };

function load(domain) {
  try {
    return JSON.parse(localStorage.getItem(KEY[domain])) ?? null;
  } catch {
    return null;
  }
}

export const sessions = reactive({ owner: load('owner'), cloud: load('cloud') });

function save(domain, value) {
  sessions[domain] = value;
  try {
    value ? localStorage.setItem(KEY[domain], JSON.stringify(value)) : localStorage.removeItem(KEY[domain]);
  } catch { /* private mode: session lives in memory only */ }
}

export async function api(domain, method, path, body) {
  const s = sessions[domain];
  const res = await fetch(`/api/${domain}${path}`, {
    method,
    headers: { ...(s && { authorization: `Bearer ${s.token}` }), ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && s) {
    // Session expired or the service restarted: go back to that side's sign-in.
    save(domain, null);
    const { default: router } = await import('./router.js');
    router.push({ path: '/login', query: { domain, next: router.currentRoute.value.fullPath } });
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

export async function signIn(domain, username, password) {
  const data = await api(domain, 'POST', '/auth/login', { username, password });
  save(domain, data);
  return data;
}

export async function signOut(domain) {
  await api(domain, 'POST', '/auth/logout').catch(() => {});
  save(domain, null);
}

export const get = (domain, path) => api(domain, 'GET', path);
export const post = (domain, path, body = {}) => api(domain, 'POST', path, body);
