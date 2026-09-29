<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { get, api } from '../api.js';
import { traffic, bars, fmt, bytes } from '../charts.js';
import EChart from '../components/EChart.vue';

const m = ref(null);
const campaigns = ref([]);
const error = ref('');
const fault = ref('off');
const faultMsg = ref('');
let timer;

// SRS NFR "Storage efficiency": <= 1.1 GB of ciphertext per 100 MB of plaintext.
const BUDGET = 11;

async function load() {
  try {
    const [metrics, list] = await Promise.all([get('cloud', '/metrics'), get('cloud', '/campaigns')]);
    m.value = metrics;
    campaigns.value = list;
    fault.value = metrics.fault;
    error.value = '';
  } catch (err) {
    error.value = err.message;
  }
  timer = setTimeout(load, 5000);
}
onMounted(load);
onBeforeUnmount(() => clearTimeout(timer));

async function setFault(mode) {
  faultMsg.value = '';
  try {
    fault.value = (await api('cloud', 'PUT', '/admin/fault', { mode })).mode;
  } catch (err) {
    faultMsg.value = err.message;
  }
}

const queryStats = computed(() => m.value?.byAction.find((a) => a.action === 'POST /campaigns/:id/query'));

const figures = computed(() => {
  if (!m.value) return [];
  const t = m.value.totals;
  return [
    { label: 'Requests logged', value: Number(t.requests).toLocaleString() },
    { label: 'Denied by policy', value: Number(t.denied ?? 0).toLocaleString() },
    { label: 'Server errors', value: Number(t.errors ?? 0).toLocaleString() },
    { label: 'Mean query time', value: queryStats.value ? fmt(Number(queryStats.value.avg_ms), 0) : '–', unit: 'ms', sub: queryStats.value ? `${queryStats.value.calls} queries, max ${queryStats.value.max_ms} ms` : 'no queries yet' },
  ];
});

// Every minute of the last hour, idle ones included, so gaps read as gaps.
// The database clock is UTC; labels are shown in local time.
const trafficOption = computed(() => {
  if (!m.value) return null;
  const byMinute = new Map(m.value.perMinute.map((r) => [r.minute, r]));
  const now = Math.floor(Date.now() / 60000) * 60000;
  const slots = Array.from({ length: 60 }, (_, i) => new Date(now - (59 - i) * 60000));
  const rows = slots.map((d) => byMinute.get(d.toISOString().slice(0, 16).replace('T', ' ')));
  return traffic({
    minutes: slots.map((d) => d.toTimeString().slice(0, 5)),
    allowed: rows.map((r) => (r ? Number(r.requests) - Number(r.denied) : 0)),
    denied: rows.map((r) => (r ? Number(r.denied) : 0)),
  });
});

const latencyOption = computed(() => {
  if (!m.value?.byAction.length) return null;
  const rows = m.value.byAction.slice(0, 10);
  return bars({ categories: rows.map((r) => r.action), values: rows.map((r) => Number(r.avg_ms)), format: (v) => `${fmt(v, 0)} ms`, label: 'mean latency', n: rows.map((r) => Number(r.calls)) });
});

const storage = computed(() => {
  if (!m.value) return [];
  return m.value.storage.map((s) => {
    const c = campaigns.value.find((x) => x.id === s.id);
    const cols = c ? c.metrics.reduce((a, x) => a + 1 + (x.squared ? 1 : 0), 0) : 1;
    const cipher = Number(s.cipher_bytes);
    const plain = Number(s.plaintext_bytes);
    return { ...s, cols, cipher, plain, perRow: plain ? cipher / plain : null, perMeasure: plain ? cipher / cols / plain : null };
  });
});

const expansionOption = computed(() => {
  const rows = storage.value.filter((s) => s.perMeasure);
  if (!rows.length) return null;
  return bars({
    categories: rows.map((s) => `#${s.id} · ${s.key_bits}-bit`),
    values: rows.map((s) => +s.perMeasure.toFixed(2)),
    format: (v) => `${fmt(v, 1)}×`,
    label: 'ciphertext per encrypted measure ÷ source rows',
    ref: { value: BUDGET, label: `SRS budget ${BUDGET}×` },
  });
});
</script>

<template>
  <div class="page">
    <header class="page-head">
      <p class="eyebrow">Cloud · operators (FR-8)</p>
      <h1>Load, latency, storage</h1>
      <p class="lede">What an operator can see: request counts, timings and ciphertext volume. No key material and no plaintext reach this page.</p>
      <p v-if="error" class="error">{{ error }}</p>
    </header>

    <template v-if="m">
      <section class="section">
        <div class="aside"><span class="idx">01</span><h3>Gateway</h3><p class="small muted">Refreshes every 5 s.</p></div>
        <div class="body">
          <div class="figures">
            <div v-for="f in figures" :key="f.label" class="figure">
              <div class="value">{{ f.value }}<small v-if="f.unit">{{ f.unit }}</small></div>
              <div class="label">{{ f.label }}</div>
              <div v-if="f.sub" class="sub">{{ f.sub }}</div>
            </div>
          </div>
          <figure v-if="trafficOption">
            <figcaption><b>Requests per minute</b> <span class="muted">last hour</span></figcaption>
            <EChart :option="trafficOption" :height="220" label="Requests per minute, allowed and denied" />
          </figure>
          <figure v-if="latencyOption">
            <figcaption><b>Mean latency by endpoint</b> <span class="muted">all time, top 10 by calls</span></figcaption>
            <EChart :option="latencyOption" :height="Math.max(180, m.byAction.slice(0, 10).length * 34)" label="Mean latency by endpoint" />
          </figure>
        </div>
      </section>

      <section class="section">
        <div class="aside"><span class="idx">02</span><h3>Ciphertext storage</h3><p class="small muted">Source size is reported by the hospital when it opens a campaign.</p></div>
        <div class="body">
          <div class="scroll-x">
            <table class="ledger num">
              <thead>
                <tr><th>#</th><th>Campaign</th><th class="r">Key</th><th class="r">Records</th><th class="r">Measures</th><th class="r">Source rows</th><th class="r">Ciphertext</th><th class="r">× per row</th><th class="r">× per measure</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in storage" :key="s.id">
                  <td class="mono">{{ s.id }}</td>
                  <td>{{ s.name }}</td>
                  <td class="r">{{ s.key_bits }}</td>
                  <td class="r">{{ Number(s.record_count).toLocaleString() }}</td>
                  <td class="r">{{ s.cols }}</td>
                  <td class="r">{{ bytes(s.plain) }}</td>
                  <td class="r">{{ bytes(s.cipher) }}</td>
                  <td class="r">{{ s.perRow ? fmt(s.perRow, 1) + '×' : '–' }}</td>
                  <td class="r">
                    <span v-if="s.perMeasure" :class="['mark', s.perMeasure <= BUDGET ? 'ok' : 'bad']">{{ fmt(s.perMeasure, 1) }}×</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="small muted">
            “Per row” is all ciphertext against the source CSV rows. “Per measure” divides by the number of encrypted columns, which is
            the like-for-like figure for the SRS budget (one encrypted value per record, ≤ {{ BUDGET }}×).
          </p>
          <figure v-if="expansionOption">
            <figcaption><b>Expansion per encrypted measure</b> <span class="muted">dashed line = SRS budget</span></figcaption>
            <EChart :option="expansionOption" :height="Math.max(140, storage.length * 40 + 40)" label="Ciphertext expansion per encrypted measure" />
          </figure>
          <table class="ledger num tables">
            <thead><tr><th>Table</th><th class="r">Rows (approx.)</th><th class="r">On disk</th></tr></thead>
            <tbody>
              <tr v-for="t in m.tables" :key="t.name"><td class="mono">{{ t.name }}</td><td class="r">{{ Number(t.approx_rows).toLocaleString() }}</td><td class="r">{{ bytes(Number(t.bytes)) }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <div class="aside">
          <span class="idx">03</span>
          <h3>Fault injection</h3>
          <p class="small muted">For demonstrating the Verifiability report: make this cloud misbehave and watch the hospital and auditors catch it.</p>
        </div>
        <div class="body">
          <div class="options fault" role="radiogroup" aria-label="Cloud behaviour">
            <label><input type="radio" name="fault" value="off" :checked="fault === 'off'" @change="setFault('off')" />Honest</label>
            <label><input type="radio" name="fault" value="drop" :checked="fault === 'drop'" @change="setFault('drop')" />Drop one record <small>from every query's input</small></label>
            <label><input type="radio" name="fault" value="tamper" :checked="fault === 'tamper'" @change="setFault('tamper')" />Tamper <small>square one ciphertext (doubles its value) before summing</small></label>
          </div>
          <p v-if="fault !== 'off'" class="warn small">⚠ Queries now run dishonestly. Expect the hospital to reject results and the audit to fail.</p>
          <p v-if="faultMsg" class="error small">{{ faultMsg }}</p>
        </div>
      </section>

      <section class="section">
        <div class="aside"><span class="idx">04</span><h3>Recent requests</h3><p class="small muted">Every allow and deny, as logged by the policy gateway.</p></div>
        <div class="scroll-x">
          <table class="ledger num log">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th><th class="r">Records</th><th class="r">ms</th><th>Outcome</th></tr></thead>
            <tbody>
              <tr v-for="r in m.recent.slice(0, 60)" :key="r.id">
                <td class="mono small">{{ r.at.slice(11, 19) }}</td>
                <td>{{ r.username ?? '—' }} <span class="muted small">{{ r.role }}</span></td>
                <td class="mono small">{{ r.action }}</td>
                <td class="small muted">{{ r.detail }}</td>
                <td class="r">{{ r.records ?? '' }}</td>
                <td class="r">{{ r.ms ?? '' }}</td>
                <td><span :class="['mark', r.outcome === 'allowed' ? 'ok' : 'bad']">{{ r.outcome }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.body { display: grid; gap: 28px; min-width: 0; }
figure { margin: 0; min-width: 0; }
figcaption { font-size: 13.5px; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; padding-bottom: 6px; border-bottom: 1px solid var(--rule); margin-bottom: 4px; }
figcaption .muted { font-size: 12px; }
.tables { max-width: 520px; }
.warn { color: var(--warn); }
.log td { white-space: nowrap; }
.log td:nth-child(4) { white-space: normal; min-width: 200px; }
</style>
