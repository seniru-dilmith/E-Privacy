<script setup>
// One line per verification run: every check the owner applied before
// trusting a cloud result, plus where it sits on the board.
import { ref, computed } from 'vue';

const props = defineProps({ result: { type: Object, required: true } });
const open = ref(false);
const passed = computed(() => props.result.checks.filter((c) => c.ok).length);
const t = computed(() => props.result.timings);
</script>

<template>
  <div class="checks">
    <p class="line small">
      <span :class="['mark', result.accepted ? 'ok' : 'bad']">{{ passed }}/{{ result.checks.length }} checks {{ result.accepted ? 'passed' : '— result rejected' }}</span>
      <span class="muted num">
        board #{{ result.querySeq }}<template v-if="result.proofSeq"> · proof #{{ result.proofSeq }}</template>
        · cloud {{ t.computeMs }} ms · decrypt {{ t.decryptMs }} ms for {{ t.decryptions }} sums
      </span>
      <button class="link" @click="open = !open">{{ open ? 'hide' : 'details' }}</button>
    </p>
    <ul v-if="open || !result.accepted" class="list small">
      <li v-for="c in result.checks" :key="c.id">
        <span :class="['mark', c.ok ? 'ok' : 'bad']">{{ c.label }}</span>
        <span v-if="c.detail" class="muted mono">{{ c.detail }}</span>
      </li>
      <li v-if="result.suppressed" class="muted">{{ result.suppressed }} group(s) under k = {{ result.kMin }} were withheld by the cloud's policy.</li>
    </ul>
  </div>
</template>

<style scoped>
.line { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; }
.list { list-style: none; margin: 10px 0 0; padding: 10px 0 0 14px; border-left: 2px solid var(--rule); display: grid; gap: 6px; }
.list li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
</style>
