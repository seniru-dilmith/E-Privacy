<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get } from '../api.js';

const PAGE = 50;
const FILTERABLE = ['records', 'board', 'query_log'];
const NOTES = {
  campaigns: 'One row per campaign: the public key (n, g), the measures and the signed Merkle root. No private key.',
  records: 'Coarse labels in the clear, then the ciphertext. Only the first 48 bytes of each ciphertext are shown.',
  board: 'The bulletin board: every entry hash-chained and signed. Payloads are cut at 400 characters.',
  query_log: 'Every request the gateway handled, including denied ones.',
  users: 'Cloud accounts. Password hashes are not shown.',
  sessions: 'Open sign-ins. Tokens are not shown: they are live credentials.',
};

const route = useRoute();
const router = useRouter();
const tables = ref([]);
const campaigns = ref([]);
const table = ref(route.params.table || 'records');
const campaign = ref('');
const page = ref(0);
const data = ref(null);
const error = ref('');

const columns = computed(() => Object.keys(data.value?.rows[0] ?? {}));
const pages = computed(() => Math.ceil((data.value?.total ?? 0) / PAGE));

const show = (v) => (v === null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const short = (v) => (show(v).length > 48 ? show(v).slice(0, 48) + '…' : show(v));

onMounted(async () => {
  try {
    [tables.value, campaigns.value] = await Promise.all([get('cloud', '/admin/tables'), get('cloud', '/campaigns')]);
  } catch (err) {
    error.value = err.message;
  }
});

async function load() {
  error.value = '';
  const q = new URLSearchParams({ limit: PAGE, offset: page.value * PAGE });
  if (campaign.value && FILTERABLE.includes(table.value)) q.set('campaign', campaign.value);
  try {
    data.value = await get('cloud', `/admin/tables/${table.value}?${q}`);
  } catch (err) {
    data.value = null;
    error.value = err.message;
  }
}

watch([table, campaign], () => {
  if (route.params.table !== table.value) router.replace(`/database/${table.value}`);
  page.value === 0 ? load() : (page.value = 0);
}, { immediate: true });
watch(page, load);
</script>

<template>
  <div class="page">
    <header class="page-head">
      <p class="eyebrow">Cloud · operator view</p>
      <h1>The database</h1>
      <p class="lede">
        Everything the cloud stores, read straight from its tables. Look for a patient's name or a measured value: there
        is none. Identifiers stayed in the hospital and every measure is ciphertext.
      </p>
    </header>

    <nav class="tabs" aria-label="Tables">
      <button v-for="t in tables" :key="t.name" :class="{ on: t.name === table }" @click="table = t.name">
        {{ t.name }}<small class="num">~{{ Number(t.approx_rows).toLocaleString() }}</small>
      </button>
    </nav>

    <div class="bar">
      <p class="small muted">{{ NOTES[table] }}</p>
      <label v-if="FILTERABLE.includes(table)" class="field filter">
        <span>Campaign</span>
        <select v-model="campaign">
          <option value="">all</option>
          <option v-for="c in campaigns" :key="c.id" :value="c.id">#{{ c.id }} · {{ c.name }}</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="data">
      <p v-if="!data.rows.length" class="muted">No rows.</p>
      <div v-else class="scroll-x">
        <table class="ledger data">
          <thead><tr><th v-for="c in columns" :key="c">{{ c }}</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in data.rows" :key="i">
              <td v-for="c in columns" :key="c" :title="show(r[c])" :class="{ mono: show(r[c]).length > 24 }">{{ short(r[c]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav v-if="pages > 1" class="pager small">
        <button class="link" :disabled="page === 0" @click="page--">previous</button>
        <span class="num">rows {{ (page * PAGE + 1).toLocaleString() }}–{{ Math.min((page + 1) * PAGE, data.total).toLocaleString() }} of {{ Number(data.total).toLocaleString() }}</span>
        <button class="link" :disabled="page === pages - 1" @click="page++">next</button>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.tabs { display: flex; flex-wrap: wrap; gap: 4px 22px; border-bottom: 1px solid var(--rule); margin-bottom: 18px; }
.tabs button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 0; font: inherit; color: var(--ink-2); cursor: pointer; }
.tabs button.on { color: var(--ink); border-bottom-color: var(--accent); font-weight: 500; }
.tabs small { margin-left: 6px; color: var(--muted); font-size: 11px; }
.bar { display: flex; flex-wrap: wrap; gap: 16px 32px; align-items: end; justify-content: space-between; margin-bottom: 18px; }
.filter { min-width: 260px; }
.data { font-size: 12.5px; white-space: nowrap; }
.data td { padding: 6px 16px 6px 0; }
.data td.mono { font-size: 11.5px; }
.pager { display: flex; gap: 18px; align-items: center; margin-top: 18px; }
</style>
