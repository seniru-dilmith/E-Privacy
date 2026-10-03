<script setup>
import { reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { signIn, signOut, sessions } from '../api.js';

const route = useRoute();
const router = useRouter();

const forms = reactive({
  owner: { username: '', password: '', busy: false, error: '' },
  cloud: { username: '', password: '', busy: false, error: '' },
});

async function submit(domain) {
  const f = forms[domain];
  f.busy = true;
  f.error = '';
  try {
    const s = await signIn(domain, f.username, f.password);
    // The hospital agent's service account can sign in to the cloud, but has no console page.
    if (domain === 'cloud' && !['auditor', 'admin'].includes(s.role)) {
      await signOut('cloud');
      throw new Error('This is a service account. Sign in as an auditor or admin.');
    }
    const fallback = domain === 'owner' ? '/campaigns' : s.role === 'admin' ? '/monitor' : '/board';
    const next = route.query.domain === domain && typeof route.query.next === 'string' ? route.query.next : fallback;
    router.push(next);
  } catch (err) {
    f.error = err.message;
  } finally {
    f.busy = false;
  }
}
</script>

<template>
  <div class="split" :data-focus="route.query.domain">
    <section class="half trust">
      <div class="inner">
        <p class="eyebrow">Inside the hospital</p>
        <h1>Records office</h1>
        <p class="lede">Generate keys, encrypt admissions and read the decrypted results. Nothing here is visible to the cloud.</p>
        <p v-if="sessions.owner" class="small">Already signed in as <b>{{ sessions.owner.username }}</b> · <RouterLink to="/campaigns" class="link">continue</RouterLink></p>
        <form @submit.prevent="submit('owner')">
          <label class="field"><span>Username</span><input v-model="forms.owner.username" type="text" autocomplete="username" required /></label>
          <label class="field"><span>Password</span><input v-model="forms.owner.password" type="password" autocomplete="current-password" required /></label>
          <p v-if="forms.owner.error" class="error small">{{ forms.owner.error }}</p>
          <div><button class="go" :disabled="forms.owner.busy">Enter records office</button></div>
        </form>
      </div>
    </section>

    <div class="seam" aria-hidden="true"><span>trust boundary</span></div>

    <section class="half cloud">
      <div class="inner">
        <p class="eyebrow">Outside, on the cloud</p>
        <h1>Cloud console</h1>
        <p class="lede">Auditors check the bulletin board end to end; operators watch load and storage. Only ciphertext lives here.</p>
        <p v-if="sessions.cloud" class="small">Already signed in as <b>{{ sessions.cloud.username }}</b> · <RouterLink to="/" class="link">continue</RouterLink></p>
        <form @submit.prevent="submit('cloud')">
          <label class="field"><span>Username</span><input v-model="forms.cloud.username" type="text" autocomplete="username" required /></label>
          <label class="field"><span>Password</span><input v-model="forms.cloud.password" type="password" autocomplete="current-password" required /></label>
          <p v-if="forms.cloud.error" class="error small">{{ forms.cloud.error }}</p>
          <div><button class="go" :disabled="forms.cloud.busy">Open console</button></div>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.split { display: grid; grid-template-columns: 1fr 3px 1fr; min-height: 100vh; }
.half { display: grid; align-items: center; padding: 64px clamp(24px, 6vw, 96px); }
.half.trust { background: var(--trust-paper); --accent: var(--trust-accent); }
.half.cloud { background: var(--cloud-paper); --accent: var(--cloud-accent); --paper: var(--cloud-paper); }
.inner { display: grid; gap: 18px; max-width: 420px; }
form { display: grid; gap: 20px; margin-top: 18px; }

.split[data-focus='owner'] .cloud .inner,
.split[data-focus='cloud'] .trust .inner { opacity: 0.55; }

.seam { position: relative; background: linear-gradient(to bottom, var(--trust-accent), var(--cloud-accent)); }
.seam span {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-90deg);
  white-space: nowrap;
  background: var(--ink);
  color: #fff;
  font: 500 10.5px/1 var(--mono);
  letter-spacing: 0.08em;
  padding: 5px 10px;
}

@media (max-width: 800px) {
  .split { grid-template-columns: 1fr; grid-template-rows: auto 3px auto; }
  .seam span { transform: translate(-50%, -50%); }
}
</style>
