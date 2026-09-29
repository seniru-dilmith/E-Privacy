<script setup>
// A hash shown as a short prefix plus a colour fingerprint of its first
// bytes, so two roots can be compared at a glance.
import { computed } from 'vue';

const props = defineProps({ value: { type: String, default: '' }, chars: { type: Number, default: 12 }, full: Boolean });
const bars = computed(() => {
  const out = [];
  for (let i = 0; i < 12 && i * 2 + 2 <= props.value.length; i += 2) {
    const byte = parseInt(props.value.slice(i * 2, i * 2 + 2), 16);
    out.push(`oklch(0.62 0.13 ${Math.round((byte / 256) * 360)})`);
  }
  return out;
});
</script>

<template>
  <span class="hash" :title="value">
    <span class="fp" aria-hidden="true"><i v-for="(c, i) in bars" :key="i" :style="{ background: c }" /></span>
    <span class="mono">{{ full ? value : value.slice(0, chars) + (value.length > chars ? '…' : '') }}</span>
  </span>
</template>

<style scoped>
.hash { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; }
.hash .mono { overflow-wrap: anywhere; }
.fp { display: inline-flex; flex: none; height: 11px; }
.fp i { width: 3px; height: 100%; }
</style>
