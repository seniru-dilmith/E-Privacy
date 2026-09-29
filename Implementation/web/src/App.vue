<script setup>
import { computed, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { sessions, signOut } from './api.js';

const route = useRoute();
const router = useRouter();

const domain = computed(() => route.meta.domain ?? 'owner');
watchEffect(() => document.body.classList.toggle('cloud', domain.value === 'cloud'));

const hospitalLinks = [
  { to: '/campaigns', label: 'Campaigns', hint: 'encrypt & upload' },
  { to: '/analysis', label: 'Analysis', hint: 'decrypt & verify' },
  { to: '/receipts', label: 'Receipts', hint: 'inclusion proofs' },
];
const cloudLinks = [
  { to: '/board', label: 'Bulletin board', hint: 'public audit', roles: ['auditor', 'admin'] },
  { to: '/monitor', label: 'Monitor', hint: 'operators', roles: ['admin'] },
];

const allowed = (link) => !link.roles || link.roles.includes(sessions.cloud?.role);
const isActive = (to) => route.path === to || route.path.startsWith(to + '/');

async function leave(d) {
  await signOut(d);
  if (route.meta.domain === d) router.push({ path: '/login', query: { domain: d } });
}
</script>

<template>
  <RouterView v-if="route.meta.bare" />
  <div v-else class="shell">
    <nav class="rail" aria-label="Main">
      <RouterLink to="/" class="brand">
        <span class="word">E-Privacy</span>
        <span class="tag">analytics over ciphertext</span>
      </RouterLink>

      <div class="zone trust">
        <p class="zone-name"><b>Hospital</b> <span>trusted · holds keys</span></p>
        <ul>
          <li v-for="l in hospitalLinks" :key="l.to">
            <RouterLink :to="l.to" :class="{ on: isActive(l.to) }">
              {{ l.label }}<small>{{ l.hint }}</small>
            </RouterLink>
          </li>
        </ul>
        <p class="who">
          <template v-if="sessions.owner">{{ sessions.owner.username }} · <button class="link" @click="leave('owner')">sign out</button></template>
          <RouterLink v-else :to="{ path: '/login', query: { domain: 'owner' } }" class="link">sign in</RouterLink>
        </p>
      </div>

      <div class="boundary" aria-hidden="true"><span>trust boundary</span></div>

      <div class="zone cloudzone">
        <p class="zone-name"><b>Cloud</b> <span>untrusted · ciphertext only</span></p>
        <ul>
          <li v-for="l in cloudLinks" :key="l.to" :class="{ locked: sessions.cloud && !allowed(l) }">
            <RouterLink :to="l.to" :class="{ on: isActive(l.to) }">
              {{ l.label }}<small>{{ sessions.cloud && !allowed(l) ? 'not for ' + sessions.cloud.role : l.hint }}</small>
            </RouterLink>
          </li>
        </ul>
        <p class="who">
          <template v-if="sessions.cloud">{{ sessions.cloud.username }} <span class="muted">({{ sessions.cloud.role }})</span> · <button class="link" @click="leave('cloud')">sign out</button></template>
          <RouterLink v-else :to="{ path: '/login', query: { domain: 'cloud' } }" class="link">sign in</RouterLink>
        </p>
      </div>
    </nav>

    <main>
      <RouterView :key="route.path" />
    </main>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: var(--rail) minmax(0, 1fr); min-height: 100vh; }

.rail {
  position: sticky;
  top: 0;
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto 1fr;
  font-size: 14px;
  border-right: 3px solid;
  border-image: linear-gradient(to bottom, var(--trust-accent) 0 52%, var(--cloud-accent) 52% 100%) 1;
}

.brand { padding: 26px 22px 22px; text-decoration: none; display: grid; background: var(--trust-deep); }
.brand .word { font-size: 23px; font-weight: 700; letter-spacing: -0.02em; }
.brand .tag { font-size: 11.5px; color: var(--muted); }

.zone { padding: 18px 22px; display: grid; align-content: start; gap: 14px; }
.zone.trust { background: var(--trust-deep); }
.zone.cloudzone { background: var(--cloud-deep); }

.zone-name { display: grid; line-height: 1.3; }
.zone-name b { font-size: 11.5px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; }
.zone-name span { font-size: 12px; color: var(--muted); }
.trust .zone-name b { color: var(--trust-accent); }
.cloudzone .zone-name b { color: var(--cloud-accent); }

ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
li a {
  display: grid;
  text-decoration: none;
  padding: 6px 0 6px 14px;
  margin-left: -14px;
  border-left: 2px solid transparent;
  color: var(--ink-2);
}
li a small { font-size: 11.5px; color: var(--muted); }
li a:hover { color: var(--ink); }
.trust li a.on { border-left-color: var(--trust-accent); color: var(--ink); font-weight: 600; }
.cloudzone li a.on { border-left-color: var(--cloud-accent); color: var(--ink); font-weight: 600; }
li.locked a { opacity: 0.45; }

.who { font-size: 12.5px; color: var(--ink-2); margin-top: 6px; }

.boundary {
  position: relative;
  height: 34px;
  background: linear-gradient(to bottom, var(--trust-deep) 50%, var(--cloud-deep) 50%);
}
.boundary::before {
  content: '';
  position: absolute;
  left: 0;
  right: -3px;
  top: 50%;
  border-top: 1px dashed var(--ink-2);
}
.boundary span {
  position: absolute;
  left: 22px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--ink);
  color: #fff;
  font: 500 10.5px/1 var(--mono);
  letter-spacing: 0.06em;
  padding: 4px 8px;
}

main { min-width: 0; }

@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .rail { position: static; height: auto; grid-template-rows: none; border-right: 0; border-bottom: 3px solid var(--ink); }
  .zone ul { grid-auto-flow: column; justify-content: start; gap: 18px; overflow-x: auto; }
  li a small { display: none; }
}
</style>
