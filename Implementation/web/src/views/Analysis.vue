<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { METRIC } from '@e-privacy/shared';
import { get, post } from '../api.js';
import { whiskers, bars, columns, band, heatmap, fmt, compact, pct } from '../charts.js';
import EChart from '../components/EChart.vue';
import Checks from '../components/Checks.vue';

const route = useRoute();
const router = useRouter();

const campaigns = ref([]);
const selected = ref(null);
const error = ref('');

// Each panel is one homomorphic query: group-by dimensions + measures.
const QUERIES = {
  overall: { groupBy: [], metrics: null },
  department: { groupBy: ['department'], metrics: ['length_of_stay_days', 'total_charges', 'readmitted_30d', 'in_hospital_death'] },
  month: { groupBy: ['admission_month'], metrics: ['total_charges', 'length_of_stay_days'] },
  ward: { groupBy: ['ward_type', 'admission_type'], metrics: ['total_charges'] },
  age: { groupBy: ['age_band'], metrics: ['systolic_bp', 'heart_rate', 'bmi', 'blood_glucose'] },
};
const results = reactive({});

const campaign = computed(() => campaigns.value.find((c) => c.id === selected.value));

async function runAll() {
  for (const k of Object.keys(QUERIES)) delete results[k];
  if (!campaign.value) return;
  const available = campaign.value.metrics.map((m) => m.name);
  for (const [name, q] of Object.entries(QUERIES)) {
    let metrics = q.metrics ? q.metrics.filter((m) => available.includes(m)) : available;
    // counts come with any measure, so fall back to the first one
    if (!metrics.length && (name === 'month' || name === 'ward')) metrics = [available[0]];
    if (!metrics.length) { results[name] = { skipped: true }; continue; }
    results[name] = { loading: true };
    try {
      results[name] = await post('owner', `/campaigns/${campaign.value.id}/analyze`, { groupBy: q.groupBy, metrics });
    } catch (err) {
      results[name] = { error: err.message };
    }
  }
}

onMounted(async () => {
  try {
    campaigns.value = (await get('owner', '/campaigns')).filter((c) => c.receipt);
    selected.value = Number(route.params.id) || campaigns.value[0]?.id || null;
  } catch (err) {
    error.value = err.message;
  }
});

watch(selected, (id) => {
  if (id && Number(route.params.id) !== id) router.replace(`/analysis/${id}`);
  runAll();
});

// ---- shaping helpers ----
const ok = (r) => r && r.accepted && r.groups?.length;

const WARD_ORDER = ['General', 'Semi-Private', 'Private', 'HDU', 'ICU'];
const TYPE_ORDER = ['Elective', 'Emergency', 'Transfer'];
const AGE_ORDER = ['0-17', '18-34', '35-49', '50-64', '65-79', '80+'];


const overall = computed(() => (ok(results.overall) ? results.overall.groups[0] : null));
const headline = computed(() => {
  const g = overall.value;
  if (!g) return [];
  const s = g.stats;
  const out = [{ label: 'Admissions in sample', value: g.n.toLocaleString() }];
  if (s.length_of_stay_days) out.push({ label: 'Mean length of stay', value: fmt(s.length_of_stay_days.mean, 1), unit: 'days', sub: s.length_of_stay_days.sd != null ? `± ${fmt(s.length_of_stay_days.sd, 1)} s.d.` : '' });
  if (s.total_charges) out.push({ label: 'Mean bill', value: compact(s.total_charges.mean), unit: 'LKR', sub: s.total_charges.sd != null ? `± ${compact(s.total_charges.sd)} s.d.` : '' });
  if (s.readmitted_30d) out.push({ label: '30-day readmission', value: fmt(s.readmitted_30d.mean * 100, 1), unit: '%', sub: `${s.readmitted_30d.sum.toLocaleString()} patients` });
  if (s.in_hospital_death) out.push({ label: 'In-hospital mortality', value: fmt(s.in_hospital_death.mean * 100, 2), unit: '%', sub: `${s.in_hospital_death.sum.toLocaleString()} deaths` });
  return out;
});

const overallTable = computed(() => {
  const g = overall.value;
  if (!g) return [];
  return Object.entries(g.stats).map(([m, s]) => ({ m, label: METRIC[m].label, unit: METRIC[m].unit, flag: METRIC[m].flag, ...s }));
});

const dept = computed(() => {
  const r = results.department;
  if (!ok(r)) return null;
  // One shared order (by mean bill, else by size) keeps the four panels comparable.
  const gs = [...r.groups].sort((a, b) => (b.stats.total_charges?.mean ?? b.n) - (a.stats.total_charges?.mean ?? a.n));
  const categories = gs.map((g) => g.key.department);
  const n = gs.map((g) => g.n);
  const pick = (m) => (gs[0].stats[m] ? { mean: gs.map((g) => g.stats[m].mean), sd: gs.map((g) => g.stats[m].sd ?? null) } : null);
  const out = [];
  const charges = pick('total_charges');
  if (charges) out.push({ title: 'Bill per admission', note: 'mean ± 1 s.d., LKR', option: whiskers({ categories, n, ...charges }) });
  const los = pick('length_of_stay_days');
  if (los) out.push({ title: 'Length of stay', note: 'mean ± 1 s.d., days', option: whiskers({ categories, n, ...los, format: (v) => fmt(v, 1), unit: ' d' }) });
  const re = pick('readmitted_30d');
  if (re) out.push({ title: '30-day readmission rate', note: 'share of admissions', option: bars({ categories, n, values: re.mean, format: (v) => pct(v), label: 'readmitted' }) });
  const death = pick('in_hospital_death');
  if (death) out.push({ title: 'In-hospital mortality', note: 'share of admissions', option: bars({ categories, n, values: death.mean, format: (v) => pct(v, 2), label: 'died in hospital' }) });
  return out;
});

const month = computed(() => {
  const r = results.month;
  if (!ok(r)) return null;
  const gs = [...r.groups].sort((a, b) => a.key.admission_month.localeCompare(b.key.admission_month));
  const categories = gs.map((g) => g.key.admission_month);
  const out = [{ title: 'Admissions per month', note: 'count in sample', option: columns({ categories, values: gs.map((g) => g.n), format: (v) => v.toLocaleString(), label: 'admissions' }) }];
  if (gs[0].stats.total_charges) {
    out.push({
      title: 'Mean bill per month',
      note: 'line = mean, band = ± 1 s.d. (floored at 0), LKR',
      option: band({ categories, mean: gs.map((g) => g.stats.total_charges.mean), sd: gs[0].stats.total_charges.sd != null ? gs.map((g) => g.stats.total_charges.sd) : null, zero: true }),
    });
  }
  return out;
});

const ward = computed(() => {
  const r = results.ward;
  if (!ok(r) || !r.groups[0].stats.total_charges) return null;
  const x = TYPE_ORDER.filter((t) => r.groups.some((g) => g.key.admission_type === t));
  const y = WARD_ORDER.filter((w) => r.groups.some((g) => g.key.ward_type === w));
  const cells = r.groups.map((g) => [x.indexOf(g.key.admission_type), y.indexOf(g.key.ward_type), g.stats.total_charges.mean, g.n]);
  return heatmap({ x, y, cells, label: 'mean bill (LKR)' });
});

const age = computed(() => {
  const r = results.age;
  if (!ok(r)) return null;
  const gs = AGE_ORDER.map((a) => r.groups.find((g) => g.key.age_band === a)).filter(Boolean);
  const categories = gs.map((g) => g.key.age_band);
  return Object.keys(gs[0].stats).map((m) => ({
    title: METRIC[m].label,
    note: `${METRIC[m].unit || 'value'} by age band, mean ± 1 s.d.`,
    option: band({ categories, mean: gs.map((g) => g.stats[m].mean), sd: gs[0].stats[m].sd != null ? gs.map((g) => g.stats[m].sd) : null, format: (v) => fmt(v, 1) }),
  }));
});

const accuracy = computed(() => {
  const all = Object.values(results).flatMap((r) => r.accuracy ?? []);
  return { compared: all.length, differing: all.filter((a) => a.diff !== '0').length };
});
</script>

<template>
  <div class="page">
    <header class="page-head">
      <p class="eyebrow">Hospital · step 2</p>
      <h1>What the ciphertext says</h1>
      <p class="lede">
        Every figure below was summed by the cloud without a key, decrypted here, and accepted only after the signature, the
        input-set root, the record count and a recomputation from our own plaintext all agreed.
      </p>
      <div class="picker">
        <label class="field">
          <span>Campaign</span>
          <select v-model="selected">
            <option v-for="c in campaigns" :key="c.id" :value="c.id">#{{ c.id }} · {{ c.name }} ({{ c.count.toLocaleString() }}, {{ c.keyBits }}-bit)</option>
          </select>
        </label>
        <button v-if="campaign" class="link" @click="runAll">run again</button>
        <p v-if="accuracy.compared" class="small num">
          <span :class="['mark', accuracy.differing ? 'bad' : 'ok']">{{ accuracy.compared.toLocaleString() }} decrypted sums checked against plaintext, {{ accuracy.differing }} differ</span>
        </p>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="!error && !campaigns.length" class="muted">No committed campaigns yet. <RouterLink to="/campaigns" class="link">Encrypt one first.</RouterLink></p>
    </header>

    <template v-if="campaign">
      <!-- overall -->
      <section class="section">
        <div class="aside"><span class="idx">01</span><h3>Whole sample</h3><p class="small muted">No grouping; every measure in the campaign.</p></div>
        <div class="body">
          <p v-if="results.overall?.loading" class="muted">Summing ciphertexts…</p>
          <p v-else-if="results.overall?.error" class="error">{{ results.overall.error }}</p>
          <template v-else-if="results.overall">
            <Checks :result="results.overall" />
            <div v-if="headline.length" class="figures">
              <div v-for="f in headline" :key="f.label" class="figure">
                <div class="value">{{ f.value }}<small v-if="f.unit">{{ f.unit }}</small></div>
                <div class="label">{{ f.label }}</div>
                <div v-if="f.sub" class="sub">{{ f.sub }}</div>
              </div>
            </div>
            <div v-if="overallTable.length" class="scroll-x">
              <table class="ledger num">
                <thead><tr><th>Measure</th><th class="r">Mean</th><th class="r">S.d.</th><th class="r">Sum</th><th>Unit</th></tr></thead>
                <tbody>
                  <tr v-for="row in overallTable" :key="row.m">
                    <td>{{ row.label }}</td>
                    <td class="r">{{ row.flag ? pct(row.mean, 2) : fmt(row.mean, 2) }}</td>
                    <td class="r">{{ row.sd == null ? '–' : row.flag ? pct(row.sd, 1) : fmt(row.sd, 2) }}</td>
                    <td class="r">{{ fmt(row.sum, row.m.endsWith('cost') || row.m === 'total_charges' || row.m === 'bmi' ? 2 : 0) }}</td>
                    <td class="muted">{{ row.flag ? 'rate' : row.unit }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </section>

      <!-- department -->
      <section class="section">
        <div class="aside"><span class="idx">02</span><h3>By department</h3><p class="small muted">Sorted by mean bill; the same order in every panel.</p></div>
        <div class="body">
          <p v-if="results.department?.loading" class="muted">Summing ciphertexts…</p>
          <p v-else-if="results.department?.error" class="error">{{ results.department.error }}</p>
          <p v-else-if="results.department?.skipped" class="muted">This campaign has none of the measures for this view.</p>
          <template v-else-if="results.department">
            <Checks :result="results.department" />
            <div v-if="dept" class="grid2">
              <figure v-for="c in dept" :key="c.title">
                <figcaption><b>{{ c.title }}</b> <span class="muted">{{ c.note }}</span></figcaption>
                <EChart :option="c.option" :height="330" :label="c.title + ' by department'" />
              </figure>
            </div>
          </template>
        </div>
      </section>

      <!-- month -->
      <section class="section">
        <div class="aside"><span class="idx">03</span><h3>Over time</h3><p class="small muted">Admission month. Volume and cost on separate scales, never one twin-axis chart.</p></div>
        <div class="body">
          <p v-if="results.month?.loading" class="muted">Summing ciphertexts…</p>
          <p v-else-if="results.month?.error" class="error">{{ results.month.error }}</p>
          <template v-else-if="results.month && !results.month.skipped">
            <Checks :result="results.month" />
            <figure v-for="c in month ?? []" :key="c.title">
              <figcaption><b>{{ c.title }}</b> <span class="muted">{{ c.note }}</span></figcaption>
              <EChart :option="c.option" :height="220" :label="c.title" />
            </figure>
          </template>
        </div>
      </section>

      <!-- ward x type -->
      <section class="section">
        <div class="aside"><span class="idx">04</span><h3>Ward × admission type</h3><p class="small muted">Mean bill per cell. Empty cells were withheld (fewer than k admissions).</p></div>
        <div class="body">
          <p v-if="results.ward?.loading" class="muted">Summing ciphertexts…</p>
          <p v-else-if="results.ward?.error" class="error">{{ results.ward.error }}</p>
          <template v-else-if="results.ward && !results.ward.skipped">
            <Checks :result="results.ward" />
            <EChart v-if="ward" :option="ward" :height="320" label="Mean bill by ward and admission type" />
            <p v-else-if="results.ward.accepted" class="muted small">Needs the total charges measure.</p>
          </template>
        </div>
      </section>

      <!-- age -->
      <section class="section">
        <div class="aside"><span class="idx">05</span><h3>Vitals by age</h3><p class="small muted">Age band is a coarse grouping label; exact age stays encrypted.</p></div>
        <div class="body">
          <p v-if="results.age?.loading" class="muted">Summing ciphertexts…</p>
          <p v-else-if="results.age?.error" class="error">{{ results.age.error }}</p>
          <p v-else-if="results.age?.skipped" class="muted">This campaign has no vital-sign measures.</p>
          <template v-else-if="results.age">
            <Checks :result="results.age" />
            <div v-if="age" class="grid2">
              <figure v-for="c in age" :key="c.title">
                <figcaption><b>{{ c.title }}</b> <span class="muted">{{ c.note }}</span></figcaption>
                <EChart :option="c.option" :height="220" :label="c.title + ' by age band'" />
              </figure>
            </div>
          </template>
        </div>
      </section>

      <!-- accuracy -->
      <section v-if="results.department?.accuracy" class="section">
        <div class="aside"><span class="idx">06</span><h3>Accuracy ledger</h3><p class="small muted">Decrypted sums next to sums computed directly from our plaintext, department view.</p></div>
        <div class="scroll-x">
          <table class="ledger num">
            <thead><tr><th>Department</th><th>Column</th><th class="r">Decrypted sum</th><th class="r">Plaintext sum</th><th class="r">Difference</th></tr></thead>
            <tbody>
              <tr v-for="a in results.department.accuracy" :key="a.key.department + a.column">
                <td>{{ a.key.department }}</td>
                <td class="mono small">{{ a.column }}</td>
                <td class="r mono small">{{ a.decrypted }}</td>
                <td class="r mono small">{{ a.plaintext }}</td>
                <td class="r"><span :class="['mark', a.diff === '0' ? 'ok' : 'bad']">{{ a.diff }}</span></td>
              </tr>
            </tbody>
          </table>
          <p class="small muted note">Sums are fixed-point integers (charges ×100, BMI ×10); squared columns carry the scale squared.</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.picker { display: flex; flex-wrap: wrap; align-items: end; gap: 12px 28px; margin-top: 8px; }
.picker select { min-width: min(420px, 80vw); }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 34px 48px; }
.note { margin-top: 10px; }
</style>
