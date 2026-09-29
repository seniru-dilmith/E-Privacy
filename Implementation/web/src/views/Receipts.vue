<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { get } from '../api.js';
import Hash from '../components/Hash.vue';

const route = useRoute();
const router = useRouter();
const campaigns = ref([]);
const selected = ref(null);
const detail = ref(null);
const seq = ref(0);
const check = ref(null);
const busy = ref(false);
const error = ref('');

const campaign = computed(() => campaigns.value.find((c) => c.id === selected.value));

onMounted(async () => {
  try {
    campaigns.value = (await get('owner', '/campaigns')).filter((c) => c.receipt);
    selected.value = Number(route.params.id) || campaigns.value[0]?.id || null;
  } catch (err) {
    error.value = err.message;
  }
});

watch(selected, async (id) => {
  check.value = null;
  if (!id) return;
  if (Number(route.params.id) !== id) router.replace(`/receipts/${id}`);
  detail.value = await get('owner', `/campaigns/${id}`);
});

async function verify(random = false) {
  if (random) seq.value = Math.floor(Math.random() * campaign.value.count);
  busy.value = true;
  error.value = '';
  try {
    check.value = await get('owner', `/campaigns/${selected.value}/records/${seq.value}/check`);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <p class="eyebrow">Hospital · individual verifiability</p>
      <h1>Stored as uploaded?</h1>
      <p class="lede">
        When the cloud accepted our upload it signed a Merkle root over every record. We kept our own copy of each leaf,
        so any single admission can be checked against that root at any time without trusting the cloud's word.
      </p>
      <label class="field picker">
        <span>Campaign</span>
        <select v-model="selected">
          <option v-for="c in campaigns" :key="c.id" :value="c.id">#{{ c.id }} · {{ c.name }}</option>
        </select>
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </header>

    <template v-if="detail">
      <section class="section">
        <div class="aside"><span class="idx">01</span><h3>Signed receipt</h3><p class="small muted">Board entry #{{ detail.receipt.seq }}</p></div>
        <dl class="facts">
          <dt>Merkle root</dt><dd><Hash :value="detail.receipt.root" full /></dd>
          <dt>Records</dt><dd class="num">{{ detail.receipt.count.toLocaleString() }}</dd>
          <dt>Entry hash</dt><dd><Hash :value="detail.receipt.hash" full /></dd>
          <dt>Signature</dt><dd class="mono sig">{{ detail.receipt.sig }}</dd>
          <dt>Cloud key (pinned)</dt><dd><Hash :value="detail.boardKey" full /></dd>
          <dt>Paillier modulus n</dt><dd class="mono sig">{{ detail.publicKey.n.slice(0, 96) }}… <span class="muted">({{ detail.keyBits }} bits)</span></dd>
        </dl>
      </section>

      <section class="section">
        <div class="aside"><span class="idx">02</span><h3>Check one record</h3><p class="small muted">Ask the cloud for an inclusion proof and replay it locally.</p></div>
        <div class="body">
          <form class="ask" @submit.prevent="verify(false)">
            <label class="field">
              <span>Record (0 – {{ (campaign.count - 1).toLocaleString() }})</span>
              <input v-model.number="seq" type="number" min="0" :max="campaign.count - 1" required />
            </label>
            <button class="go" :disabled="busy">Verify</button>
            <button type="button" class="link" :disabled="busy" @click="verify(true)">pick one at random</button>
          </form>

          <template v-if="check">
            <p>
              <span :class="['mark', check.leafMatches && check.proofValid ? 'ok' : 'bad']">
                Record {{ check.seq }} {{ check.leafMatches && check.proofValid ? 'is in the committed set, unmodified' : 'does not match the receipt' }}
              </span>
            </p>
            <ol class="path">
              <li class="leaf">
                <span class="tag">our leaf</span><Hash :value="check.ourLeaf" :chars="20" />
                <span :class="['mark', check.leafMatches ? 'ok' : 'bad']">{{ check.leafMatches ? 'cloud holds the same' : 'cloud holds ' + check.cloudLeaf.slice(0, 12) }}</span>
              </li>
              <li v-for="(p, i) in check.proof" :key="i">
                <span class="tag">level {{ i + 1 }} · sibling {{ p.side === 'L' ? 'left' : 'right' }}</span><Hash :value="p.hash" :chars="20" />
              </li>
              <li class="root">
                <span class="tag">receipt root</span><Hash :value="check.receiptRoot" :chars="20" />
                <span :class="['mark', check.proofValid ? 'ok' : 'bad']">{{ check.proofValid ? 'recomputed root matches' : 'recomputed root differs' }}</span>
              </li>
            </ol>
            <p class="small muted">{{ check.proof.length }} hashes prove membership among {{ campaign.count.toLocaleString() }} records.</p>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.picker { max-width: 420px; margin-top: 8px; }
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 12px 28px; margin: 0; }
.facts dt { color: var(--muted); font-size: 13px; }
.facts dd { margin: 0; min-width: 0; }
.sig { overflow-wrap: anywhere; font-size: 11.5px; }
.ask { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: end; }
.ask input { width: 160px; }
.path { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 2px solid var(--accent); display: grid; gap: 0; }
.path li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 9px 0; position: relative; font-size: 13px; }
.path li::before { content: ''; position: absolute; left: -23px; top: 50%; width: 8px; height: 8px; border-radius: 50%; background: var(--paper); border: 2px solid var(--accent); transform: translateY(-50%); }
.path li.leaf::before, .path li.root::before { background: var(--accent); }
.tag { color: var(--muted); font-size: 12px; min-width: 150px; }
</style>
