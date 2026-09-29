<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { get, sessions } from '../api.js';
import Hash from '../components/Hash.vue';

const entries = ref([]);
const campaigns = ref([]);
const filter = ref(0);
const openSeq = ref(null);
const error = ref('');

const CHECKS = [
  { id: 'chain', title: 'Log integrity', what: 'Every entry hashes to its stated hash, links to the one before it and carries a valid P-256 signature from the cloud.' },
  { id: 'input', title: 'Input set', what: 'The Merkle root rebuilt from the published ciphertexts equals the signed receipt, and every query ran over exactly that set.' },
  { id: 'compute', title: 'Computation', what: 'Each published encrypted sum C equals the product of the matching public ciphertexts mod n², recomputed here.' },
  { id: 'decrypt', title: 'Decryption', what: 'Each plaintext the hospital published satisfies gᵐ · rⁿ ≡ C (mod n²), so it cannot have been misreported.' },
];
const audit = reactive({ running: false, progress: '', results: {}, error: '', started: 0, ms: 0 });
let worker;

const KIND = {
  campaign_opened: 'Campaign opened · public key published',
  batch_committed: 'Upload sealed · Merkle receipt',
  query_result: 'Encrypted aggregate',
  decryption_published: 'Decryption proof',
};

const shown = computed(() => [...entries.value].reverse().filter((e) => !filter.value || e.campaign_id === filter.value));

function summary(e) {
  const b = JSON.parse(e.payload);
  switch (e.kind) {
    case 'campaign_opened': return `“${b.name}” · ${b.key_bits}-bit · ${b.metrics.length} measures`;
    case 'batch_committed': return `${b.count.toLocaleString()} records under root ${b.root.slice(0, 12)}…`;
    case 'query_result': return `group by ${b.group_by.join(' × ') || '—'} · ${b.groups.length} groups × ${b.metrics.length} columns over ${b.total.toLocaleString()} records${b.suppressed ? ` · ${b.suppressed} withheld (k<${b.k_min})` : ''}`;
    case 'decryption_published': return `${b.values.length} (m, r) pairs for entry #${b.query_seq}`;
    default: return '';
  }
}

// Long hex (ciphertexts, moduli) is shortened for reading; the real entry is untouched.
function pretty(e) {
  return JSON.stringify(JSON.parse(e.payload), (k, v) => (typeof v === 'string' && /^[0-9a-f]{80,}$/.test(v) ? `${v.slice(0, 32)}…(${v.length / 2} bytes)` : v), 2);
}

async function load() {
  try {
    const all = [];
    for (;;) {
      const page = await get('cloud', `/board?after=${all.at(-1)?.seq ?? 0}&limit=2000`);
      all.push(...page);
      if (page.length < 2000) break;
    }
    entries.value = all;
    campaigns.value = await get('cloud', '/campaigns');
  } catch (err) {
    error.value = err.message;
  }
}

function runAudit() {
  worker?.terminate();
  worker = new Worker(new URL('../audit.worker.js', import.meta.url), { type: 'module' });
  Object.assign(audit, { running: true, progress: 'Fetching the board…', results: {}, error: '', started: performance.now(), ms: 0 });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') audit.progress = data.text;
    else if (data.type === 'check') audit.results[data.id] = data;
    else if (data.type === 'error') Object.assign(audit, { running: false, error: data.message });
    else if (data.type === 'done') Object.assign(audit, { running: false, ms: performance.now() - audit.started });
  };
  worker.postMessage({ token: sessions.cloud?.token, campaign: filter.value || null });
}

onMounted(load);
onBeforeUnmount(() => worker?.terminate());
</script>

<template>
  <div class="page">
    <header class="page-head">
      <p class="eyebrow">Cloud · universal verifiability</p>
      <h1>The bulletin board</h1>
      <p class="lede">
        An append-only record of everything the cloud has committed to. Anyone with read access can replay it: the checks
        below run in this browser tab using only public keys, published ciphertexts and the board itself.
      </p>
      <p v-if="error" class="error">{{ error }}</p>
    </header>

    <section class="section">
      <div class="aside">
        <span class="idx">01</span>
        <h3>Audit</h3>
        <p class="small muted">No private key, no plaintext, no trust in the cloud's arithmetic.</p>
      </div>
      <div class="audit">
        <div class="controls">
          <label class="field">
            <span>Scope</span>
            <select v-model.number="filter">
              <option :value="0">Whole board</option>
              <option v-for="c in campaigns" :key="c.id" :value="c.id">Campaign #{{ c.id }} · {{ c.name }}</option>
            </select>
          </label>
          <button class="go" :disabled="audit.running" @click="runAudit">Run all four checks</button>
          <p v-if="audit.running" class="small muted running">{{ audit.progress }}</p>
          <p v-else-if="audit.ms" class="small muted num">Finished in {{ (audit.ms / 1000).toFixed(1) }} s</p>
        </div>
        <p v-if="audit.error" class="error">{{ audit.error }}</p>
        <ol class="checks">
          <li v-for="(c, i) in CHECKS" :key="c.id">
            <span class="n mono">{{ i + 1 }}</span>
            <div>
              <p class="title">
                <b>{{ c.title }}</b>
                <span v-if="audit.results[c.id]" :class="['mark', audit.results[c.id].ok ? 'ok' : 'bad']">
                  {{ audit.results[c.id].ok ? 'holds' : `${audit.results[c.id].failed} failure${audit.results[c.id].failed > 1 ? 's' : ''}` }}
                </span>
                <span v-else-if="audit.running" class="mark wait">waiting</span>
              </p>
              <p class="small muted">{{ c.what }}</p>
              <p v-if="audit.results[c.id]" class="small num">{{ audit.results[c.id].extra }}</p>
              <ul v-if="audit.results[c.id]?.failures.length" class="fails small mono">
                <li v-for="f in audit.results[c.id].failures" :key="f">{{ f }}</li>
              </ul>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="aside">
        <span class="idx">02</span>
        <h3>Entries</h3>
        <p class="small muted num">{{ entries.length.toLocaleString() }} on the board, newest first.</p>
        <button class="link small" @click="load">refresh</button>
      </div>
      <ol class="chain">
        <li v-for="e in shown" :key="e.seq" :class="e.kind">
          <button class="head" :aria-expanded="openSeq === e.seq" @click="openSeq = openSeq === e.seq ? null : e.seq">
            <span class="seq mono">#{{ e.seq }}</span>
            <span class="what">
              <b>{{ KIND[e.kind] ?? e.kind }}</b>
              <span class="small muted">campaign #{{ e.campaign_id }} · {{ new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString() }}</span>
              <span class="small">{{ summary(e) }}</span>
            </span>
            <Hash :value="e.hash" />
          </button>
          <div v-if="openSeq === e.seq" class="detail">
            <dl>
              <dt>hash</dt><dd><Hash :value="e.hash" full /></dd>
              <dt>previous</dt><dd><Hash :value="e.prev_hash" full /></dd>
              <dt>signature</dt><dd class="mono sig">{{ e.sig }}</dd>
            </dl>
            <pre class="payload">{{ pretty(e) }}</pre>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.audit { display: grid; gap: 22px; min-width: 0; }
.controls { display: flex; flex-wrap: wrap; align-items: end; gap: 14px 28px; }
.controls select { min-width: 260px; }
.running::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-right: 8px; animation: pulse 1s infinite alternate; }
@keyframes pulse { to { opacity: 0.2; } }

.checks { list-style: none; margin: 0; padding: 0; display: grid; }
.checks > li { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--rule); }
.checks > li:first-child { border-top: 1px solid var(--ink); }
.checks .n { color: var(--muted); padding-top: 2px; }
.checks .title { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; margin-bottom: 2px; }
.fails { margin: 8px 0 0; padding-left: 16px; color: var(--bad); display: grid; gap: 3px; font-size: 11.5px; }

.chain { list-style: none; margin: 0; padding: 0 0 0 20px; border-left: 2px solid var(--rule); min-width: 0; }
.chain > li { position: relative; }
.chain > li::before { content: ''; position: absolute; left: -26px; top: 19px; width: 10px; height: 10px; border-radius: 50%; background: var(--paper); border: 2px solid var(--accent); }
.chain > li.batch_committed::before { background: var(--accent); }
.chain > li.decryption_published::before { border-color: var(--ok); }
.head {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  cursor: pointer;
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  padding: 12px 0;
  border-bottom: 1px solid var(--rule);
}
.head:hover .what b { text-decoration: underline; text-underline-offset: 3px; }
.head:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.seq { color: var(--ink-2); padding-top: 1px; }
.what { display: grid; gap: 1px; min-width: 0; }
.detail { padding: 12px 0 20px 76px; }
.detail dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 18px; margin: 0; font-size: 13px; }
.detail dt { color: var(--muted); }
.detail dd { margin: 0; min-width: 0; }
.sig { overflow-wrap: anywhere; font-size: 11.5px; }

@media (max-width: 700px) {
  .head { grid-template-columns: 48px minmax(0, 1fr); }
  .head > :last-child { display: none; }
  .detail { padding-left: 0; }
}
</style>
