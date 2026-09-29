<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { echarts } from '../charts.js';

const props = defineProps({ option: { type: Object, required: true }, height: { type: Number, default: 300 }, label: { type: String, default: '' } });
const el = ref(null);
let chart;
let ro;

onMounted(() => {
  chart = echarts.init(el.value, null, { renderer: 'svg' });
  chart.setOption(props.option);
  ro = new ResizeObserver(() => chart.resize());
  ro.observe(el.value);
});
watch(() => props.option, (o) => chart?.setOption(o, true));
onBeforeUnmount(() => {
  ro?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <div ref="el" role="img" :aria-label="label" :style="{ height: height + 'px', width: '100%' }" />
</template>
