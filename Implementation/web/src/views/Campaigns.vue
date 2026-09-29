<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { get, post } from '../api.js';
import { fmt, bytes } from '../charts.js';
import Hash from '../components/Hash.vue';

const dataset = ref(null);
const campaigns = ref([]);
const job = ref(null);
const error = ref('');
let timer;

const today = new Date().toISOString().slice(0, 10);
const form = reactive({ name: `Admissions sample ${today}`, rows: 1000, keyBits: 2048, metrics: [], spread: true });

// Measured on an 8-core laptop; replaced by the last real run once there is one.
const ENC_PER_SEC = { 1024: 700, 2048: 115, 3072: 36 };
const PHASES = ['sampling', 'keygen', 'encrypting', 'spot-check', 'uploading', 'committing', 'done'];
const PHASE_LABEL = { sampling: 'Sample', keygen: 'Keys', encrypting: 'Encrypt', 'spot-check': 'Spot-check', uploading: 'Upload', committing: 'Receipt', done: 'Done' };

const columns = computed(() => {
  if (!dataset.value) return 0;
  return form.metrics.reduce((a, m) => a + 1 + (form.spread && dataset.value.metrics.find((x) => x.name === m)?.squared ? 1 : 0), 0);
});
const ciphertexts = computed(() => form.rows * columns.value);
const eta = computed(() => {
  const last = job.value?.keyBits === form.keyBits && job.value?.rate ? job.value.rate * (job.value.columns ?? columns.value) : null;
  return ciphertexts.value / (last ?? ENC_PER_SEC[form.keyBits]);
});
const cipherBytes = computed(() => ciphertexts.value * (form.keyBits / 4));
const busy = computed(() => job.value && !['done', 'failed'].includes(job.value.phase));

function duration(s) {
  if (s < 90) return `${Math.max(1, Math.round(s))} s`;
  return `${Math.round(s / 60)} min`;
}

async function refresh() {
  campaigns.value = await get('owner', '/campaigns');
}

async function poll() {
  if (!job.value) return;
  job.value = { ...(await get('owner', `/jobs/${job.value.id}`)), columns: job.value.columns };
  if (busy.value) timer = setTimeout(poll, 1000);
  else refresh();
}

async function start() {
  error.value = '';
  try {
    job.value = { ...(await post('owner', '/campaigns', { ...form })), columns: columns.value };
    poll();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(async () => {
  try {
    refresh();
    dataset.value = await get('owner', '/dataset');
    form.keyBits = dataset.value.defaultKeyBits;
    form.metrics = dataset.value.metrics.map((m) => m.name);
    const jobs = await get('owner', '/jobs');
    if (jobs.length) {
      job.value = jobs[0];
      if (busy.value) poll();
    }
    await refresh();
  } catch (err) {
    error.value = err.message;
  }
});
onBeforeUnmount(() => clearTimeout(timer));

const progress = computed(() => (job.value?.total ? job.value.done / job.value.total : 0));
const phaseIndex = computed(() => PHASES.indexOf(job.value?.phase));
const toggleAll = (on) => { form.metrics = on ? dataset.value.metrics.map((m) => m.name) : []; };
</script>

<template>
  <div class="page">
    <header class="page-head">
      <p class="eyebrow">Hospital · step 1</p>
      <h1>Encrypt a campaign</h1>
      <p class="lede">
        Each campaign draws a random sample of admissions, gets its own Paillier keypair and leaves this building only as ciphertext.
        Names, NICs, birth dates and postcodes are dropped before encryption.
      </p>
      <p v-if="dataset" class="small muted num">
        Source: <span class="mono">{{ dataset.file }}</span> · {{ dataset.rows.toLocaleString() }} admissions ·
        {{ dataset.columns.length }} columns · {{ bytes(dataset.bytes) }} · {{ dataset.threads }} crypto threads
      </p>
      <p v-else-if="!error" class="small muted">Reading the local dataset…</p>
      <p v-if="error" class="error">{{ error }}</p>
    </header>

    <form v-if="dataset" class="section" @submit.prevent="start">
      <div class="aside">
        <span class="idx">01</span>
        <h3>New campaign</h3>
        <p class="small muted">A fresh key per campaign limits what a leaked key can expose.</p>
      </div>
      <div class="new">
        <div class="row">
          <label class="field grow"><span>Name</span><input v-model="form.name" type="text" maxlength="120" required /></label>
          <label class="field rows">
            <span>Admissions to sample</span>
            <input v-model.number="form.rows" type="number" min="20" :max="dataset.rows" step="10" required />
          </label>
        </div>
        <input v-model.number="form.rows" type="range" min="100" max="10000" step="100" aria-label="Admissions to sample" />

        <div class="field">
          <span class="small">Key length (modulus n)</span>
          <div class="options">
            <label v-for="b in [1024, 2048, 3072]" :key="b">
              <input v-model="form.keyBits" type="radio" name="bits" :value="b" />{{ b }}-bit
              <small>{{ b === 1024 ? 'fast, legacy margin' : b === 2048 ? 'default (design spec B3)' : 'long-term, ~3× slower' }}</small>
            </label>
          </div>
        </div>

        <div class="field">
          <span class="small">
            Measures to encrypt ·
            <button type="button" class="link" @click="toggleAll(true)">all</button> /
            <button type="button" class="link" @click="toggleAll(false)">none</button>
          </span>
          <div class="measures">
            <label v-for="m in dataset.metrics" :key="m.name">
              <input v-model="form.metrics" type="checkbox" :value="m.name" />
              <span>{{ m.label }}</span>
              <small class="mono">{{ m.flag ? '0 / 1' : m.scale > 1 ? `×${m.scale}` : m.unit }}</small>
            </label>
          </div>
        </div>

        <label class="spread">
          <input v-model="form.spread" type="checkbox" />
          <span>Also encrypt x² for continuous measures, so standard deviations come back in the same round</span>
        </label>

        <div class="estimate num">
          <p><b>{{ ciphertexts.toLocaleString() }}</b> ciphertexts <span class="muted">({{ columns }} per admission)</span></p>
          <p><b>{{ bytes(cipherBytes) }}</b> sent to the cloud</p>
          <p><b>≈ {{ duration(eta) }}</b> to encrypt</p>
        </div>

        <div><button class="go" :disabled="busy || !form.metrics.length">Generate keys and encrypt</button></div>
      </div>
    </form>

    <section v-if="job" class="section">
      <div class="aside">
        <span class="idx">02</span>
        <h3>{{ job.phase === 'done' ? 'Last run' : job.phase === 'failed' ? 'Run stopped' : 'Running' }}</h3>
        <p class="small muted">{{ job.name }} · {{ job.keyBits }}-bit</p>
      </div>
      <div class="run">
        <ol class="phases">
          <li v-for="(p, i) in PHASES" :key="p" :class="{ past: i < phaseIndex, now: i === phaseIndex, failed: job.phase === 'failed' }">
            {{ PHASE_LABEL[p] }}
          </li>
        </ol>
        <div class="bar" role="progressbar" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100">
          <i :style="{ width: (progress * 100).toFixed(1) + '%' }" />
        </div>
        <p class="small num">
          {{ job.done.toLocaleString() }} / {{ job.total.toLocaleString() }} admissions
          <template v-if="job.rate && job.phase === 'encrypting'"> · {{ fmt(job.rate, 1) }} per second</template>
        </p>
        <div v-if="job.tape?.length" class="tape mono" aria-label="First ciphertexts produced">
          <span v-for="(t, i) in job.tape" :key="i">{{ t }}</span>
        </div>
        <ul class="log small">
          <li v-for="(l, i) in job.log" :key="i" :class="{ bad: job.phase === 'failed' && i === job.log.length - 1 }">
            <time class="mono muted">{{ new Date(l.at).toLocaleTimeString() }}</time> {{ l.text }}
          </li>
        </ul>
      </div>
    </section>

    <section class="section">
      <div class="aside">
        <span class="idx">{{ job ? '03' : '02' }}</span>
        <h3>Campaigns on this host</h3>
        <p class="small muted">Private keys for these never leave the hospital's key volume.</p>
      </div>
      <div class="scroll-x">
        <p v-if="!campaigns.length" class="muted">No campaigns yet.</p>
        <table v-else class="ledger num">
          <thead><tr><th>#</th><th>Name</th><th class="r">Admissions</th><th class="r">Key</th><th>Receipt root</th><th>Created</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in campaigns" :key="c.id" :class="{ dim: !c.receipt }">
              <td class="mono">{{ c.id }}</td>
              <td>{{ c.name }}<br /><small class="muted">{{ c.metrics.length }} measures{{ c.metrics.some((m) => m.squared) ? ' + squares' : '' }}</small></td>
              <td class="r">{{ c.count.toLocaleString() }}</td>
              <td class="r">{{ c.keyBits }}</td>
              <td><Hash v-if="c.receipt" :value="c.receipt.root" /><span v-else class="mark wait">incomplete</span></td>
              <td class="small">{{ new Date(c.createdAt).toLocaleString() }}</td>
              <td class="actions">
                <template v-if="c.receipt">
                  <RouterLink :to="`/analysis/${c.id}`" class="link">Analyse</RouterLink>
                  <RouterLink :to="`/receipts/${c.id}`" class="link">Receipt</RouterLink>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.new { display: grid; gap: 26px; max-width: 760px; }
.row { display: flex; gap: 32px; flex-wrap: wrap; }
.grow { flex: 1 1 280px; }
.rows { flex: 0 0 180px; }
.field > .small { color: var(--ink-2); display: block; margin-bottom: 6px; }

.measures {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  column-gap: 32px;
  border-top: 1px solid var(--rule);
}
.measures label {
  display: grid;
  grid-template-columns: 15px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
}
.measures small { color: var(--muted); font-size: 11px; }
.spread { display: flex; gap: 10px; align-items: baseline; cursor: pointer; font-size: 14px; color: var(--ink-2); }

.estimate { display: flex; flex-wrap: wrap; gap: 6px 28px; font-size: 14px; padding: 14px 0; border-top: 1px dashed var(--rule); border-bottom: 1px dashed var(--rule); }

.run { display: grid; gap: 14px; max-width: 860px; }
.phases { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0; font-size: 12.5px; }
.phases li { padding: 0 16px 0 0; margin-right: 16px; color: var(--muted); position: relative; }
.phases li:not(:last-child)::after { content: '—'; position: absolute; right: -10px; color: var(--rule); }
.phases li.past { color: var(--ink-2); }
.phases li.past::before { content: '✓ '; color: var(--ok); }
.phases li.now { color: var(--ink); font-weight: 600; }
.phases li.now.failed { color: var(--bad); }

.bar { height: 3px; background: var(--rule); }
.bar i { display: block; height: 100%; background: var(--accent); transition: width 0.6s ease; }

.tape {
  display: grid;
  gap: 2px;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  white-space: nowrap;
  mask-image: linear-gradient(to right, #000 70%, transparent);
  padding: 10px 0;
}

.log { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
.log time { margin-right: 8px; }
.log li.bad { color: var(--bad); }

.actions { white-space: nowrap; }
.actions a + a { margin-left: 14px; }
</style>
