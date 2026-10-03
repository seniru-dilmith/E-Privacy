<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get } from '../api.js';
import { DIMENSIONS } from '@e-privacy/shared';

const PAGE = 100;
const route = useRoute();
const router = useRouter();
const campaigns = ref([]);
const selected = ref(null);
const text = ref('');
const page = ref(0);
const error = ref('');

const campaign = computed(() => campaigns.value.find((c) => c.id === selected.value));
// Fields in the CSV never contain commas or quotes, so a plain split is exact.
const lines = computed(() => text.value.trimEnd().split('\n').filter(Boolean));
const columns = computed(() => lines.value[0]?.split(',') ?? []);
const rows = computed(() => lines.value.slice(1 + page.value * PAGE, 1 + (page.value + 1) * PAGE).map((l) => l.split(',')));
const pages = computed(() => Math.ceil((lines.value.length - 1) / PAGE));

// What the upload did with each column.
const COARSENED = { admission_date: 'sent as month', age: 'sent as age band' };
function kind(col) {
  if (campaign.value?.metrics.some((m) => m.name === col)) return { cls: 'enc', label: 'encrypted' };
  if (DIMENSIONS.includes(col)) return { cls: 'clear', label: 'sent in clear' };
  if (COARSENED[col]) return { cls: 'clear', label: COARSENED[col] };
  return { cls: 'kept', label: 'stays here' };
}

onMounted(async () => {
  try {
    campaigns.value = await get('owner', '/campaigns');
    selected.value = Number(route.params.id) || campaigns.value[0]?.id || null;
  } catch (err) {
    error.value = err.message;
  }
});

watch(selected, async (id) => {
  text.value = '';
  page.value = 0;
  if (!id) return;
  if (Number(route.params.id) !== id) router.replace(`/data/${id}`);
  try {
    text.value = await get('owner', `/campaigns/${id}/data`);
  } catch (err) {
    error.value = err.message;
  }
});

function download() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text.value], { type: 'text/csv' }));
  a.download = `campaign-${selected.value}-source.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <p class="eyebrow">Hospital · plaintext, never leaves this side</p>
      <h1>Source data</h1>
      <p class="lede">
        The admissions a campaign sampled from the local CSV, exactly as they appear in the file. The cloud received only
        the encrypted and clear columns; identifiers and everything else stayed here.
      </p>
      <label class="field picker">
        <span>Campaign</span>
        <select v-model="selected">
          <option v-for="c in campaigns" :key="c.id" :value="c.id">#{{ c.id }} · {{ c.name }}</option>
        </select>
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="!campaigns.length" class="muted">No campaigns yet. Start one under Campaigns.</p>
    </header>

    <template v-if="columns.length">
      <div class="bar">
        <p class="small">
          <b class="num">{{ (lines.length - 1).toLocaleString() }}</b> admissions ·
          <span class="key enc">encrypted</span> <span class="key clear">sent in clear</span> <span class="key kept">stays here</span>
        </p>
        <button class="go" @click="download">Download CSV</button>
      </div>

      <div class="scroll-x">
        <table class="ledger data">
          <thead>
            <tr>
              <th v-for="c in columns" :key="c" :class="kind(c).cls" :title="kind(c).label">{{ c }}<small>{{ kind(c).label }}</small></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i">
              <td v-for="(v, j) in r" :key="j" :class="kind(columns[j]).cls">{{ v }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav v-if="pages > 1" class="pager small">
        <button class="link" :disabled="page === 0" @click="page--">previous</button>
        <span class="num">page {{ page + 1 }} of {{ pages }}</span>
        <button class="link" :disabled="page === pages - 1" @click="page++">next</button>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.picker { max-width: 420px; margin-top: 8px; }
.bar { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.key { display: inline-block; padding: 1px 8px; margin-left: 6px; border-left: 3px solid; }
.enc { --tone: var(--trust-accent); }
.clear { --tone: var(--warn); }
.kept { --tone: var(--muted); }
.key, .data th { border-color: var(--tone); }
.data { font-size: 12.5px; white-space: nowrap; }
.data th { border-top: 3px solid var(--tone); padding-top: 8px; vertical-align: bottom; }
.data th small { display: block; font-weight: 400; color: var(--tone); font-size: 11px; }
.data td { padding: 6px 16px 6px 0; }
.data td.kept { color: var(--muted); }
.pager { display: flex; gap: 18px; align-items: center; margin-top: 18px; }
</style>
