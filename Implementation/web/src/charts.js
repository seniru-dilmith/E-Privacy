// ECharts setup plus the handful of chart shapes the app uses. Colours come
// from the validated reference palette; one series = one colour.
import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart, HeatmapChart, CustomChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent, MarkLineComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, ScatterChart, HeatmapChart, CustomChart, GridComponent, TooltipComponent, VisualMapComponent, MarkLineComponent, LegendComponent, SVGRenderer]);
export { echarts };

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];
export const CRITICAL = '#d03b3b';
export const SEQUENTIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const INK = '#16181a';
const INK2 = '#52514e';
const MUTED = '#898781';
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';
const FONT = "'Atkinson Hyperlegible Next', system-ui, sans-serif";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmt(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function compact(v) {
  const a = Math.abs(v);
  if (Number.isInteger(v) && a < 1e3) return String(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return fmt(v, a < 10 ? 1 : 0);
}

export const pct = (v, digits = 1) => fmt(v * 100, digits) + '%';

export function bytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${fmt(n, i ? 1 : 0)} ${units[i]}`;
}

const tooltipBase = {
  backgroundColor: '#fff',
  borderColor: 'rgba(11,11,11,0.12)',
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: INK, fontFamily: FONT, fontSize: 12.5 },
  extraCssText: 'box-shadow: 0 6px 18px rgba(20,20,20,0.08); border-radius: 2px;',
};

const axisLabel = { color: MUTED, fontFamily: FONT, fontSize: 11.5 };
const valueAxis = (extra = {}) => ({
  type: 'value',
  axisLabel: { ...axisLabel, formatter: (v) => compact(v) },
  splitLine: { lineStyle: { color: GRID } },
  axisLine: { show: false },
  axisTick: { show: false },
  ...extra,
});
const categoryAxis = (data, extra = {}) => ({
  type: 'category',
  data,
  axisLabel: { ...axisLabel, color: INK2 },
  axisLine: { lineStyle: { color: AXIS } },
  axisTick: { show: false },
  ...extra,
});

const tipRow = (value, label) => `<div style="display:flex;gap:10px;align-items:baseline"><b style="font-variant-numeric:tabular-nums">${esc(value)}</b><span style="color:${INK2}">${esc(label)}</span></div>`;

// Mean ± 1 s.d. per category, horizontal: honest about spread, unlike a bar.
export function whiskers({ categories, mean, sd, n, format = compact, color = SERIES[0], unit = '' }) {
  const rows = categories.map((c, i) => [mean[i] - (sd[i] ?? 0), mean[i] + (sd[i] ?? 0), mean[i], i]);
  return {
    animationDuration: 500,
    grid: { left: 8, right: 52, top: 12, bottom: 28, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(42,120,214,0.06)' } },
      formatter: (items) => {
        const i = items[0].dataIndex;
        return `<div style="margin-bottom:4px;color:${MUTED}">${esc(categories[i])}</div>`
          + tipRow(`${format(mean[i])}${unit}`, 'mean')
          + (sd[i] != null ? tipRow(`± ${format(sd[i])}${unit}`, '1 s.d.') : '')
          + (n ? tipRow(n[i].toLocaleString(), 'admissions') : '');
      },
    },
    xAxis: valueAxis({ scale: false, min: (v) => Math.min(0, v.min) }),
    yAxis: categoryAxis(categories, { inverse: true }),
    series: [
      {
        type: 'custom',
        silent: true,
        data: rows,
        renderItem: (params, api) => {
          const lo = api.coord([api.value(0), api.value(3)]);
          const hi = api.coord([api.value(1), api.value(3)]);
          const style = { stroke: color, lineWidth: 2, opacity: 0.55 };
          return {
            type: 'group',
            children: [
              { type: 'line', shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style },
              { type: 'line', shape: { x1: lo[0], y1: lo[1] - 5, x2: lo[0], y2: lo[1] + 5 }, style },
              { type: 'line', shape: { x1: hi[0], y1: hi[1] - 5, x2: hi[0], y2: hi[1] + 5 }, style },
              // value label sits past the whisker, clear of the marks
              { type: 'text', style: { text: format(api.value(2)), x: hi[0] + 8, y: hi[1], verticalAlign: 'middle', fill: INK, font: `11.5px ${FONT}` } },
            ],
          };
        },
        encode: { x: [0, 1], y: 3 },
        z: 1,
      },
      {
        type: 'scatter',
        data: mean.map((m, i) => [m, i]),
        symbolSize: 10,
        itemStyle: { color, borderColor: '#fff', borderWidth: 2 },
        z: 2,
      },
    ],
  };
}

// Horizontal bars for rates or counts, value labelled at the bar end.
export function bars({ categories, values, format = compact, color = SERIES[0], n, label = 'value', ref }) {
  return {
    animationDuration: 500,
    grid: { left: 8, right: 56, top: ref ? 24 : 8, bottom: 28, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (p) => `<div style="margin-bottom:4px;color:${MUTED}">${esc(categories[p.dataIndex])}</div>`
        + tipRow(format(p.value), label) + (n ? tipRow(n[p.dataIndex].toLocaleString(), 'admissions') : ''),
    },
    xAxis: valueAxis({ splitNumber: 4, axisLabel: { ...axisLabel, formatter: (v) => format(v) }, ...(ref && { max: (v) => Math.ceil(Math.max(v.max, ref.value) * 1.08) }) }),
    yAxis: categoryAxis(categories, { inverse: true }),
    series: [{
      type: 'bar',
      data: values,
      barWidth: '58%',
      itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      emphasis: { itemStyle: { color: SEQUENTIAL[4] } },
      label: { show: true, position: 'right', color: INK, fontSize: 11.5, formatter: (p) => format(p.value) },
      ...(ref && {
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ xAxis: ref.value }],
          lineStyle: { color: INK, type: 'dashed', width: 1.5, opacity: 0.7 },
          label: { formatter: () => ref.label, color: INK2, fontSize: 11, position: 'end' },
        },
      }),
    }],
  };
}

// Vertical columns over an ordered axis (months).
export function columns({ categories, values, format = compact, color = SERIES[0], label = 'value' }) {
  return {
    animationDuration: 500,
    grid: { left: 8, right: 8, top: 14, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(42,120,214,0.06)' } },
      formatter: (items) => `<div style="margin-bottom:4px;color:${MUTED}">${esc(items[0].axisValue)}</div>` + tipRow(format(items[0].value), label),
    },
    xAxis: categoryAxis(categories, { axisLabel: { ...axisLabel, interval: 'auto', hideOverlap: true } }),
    yAxis: valueAxis({ axisLabel: { ...axisLabel, formatter: (v) => format(v) } }),
    series: [{ type: 'bar', data: values, barCategoryGap: '22%', itemStyle: { color, borderRadius: [4, 4, 0, 0] } }],
  };
}

// Mean with ± 1 s.d. band over an ordered axis (months, age bands).
// zero: the measure can't go negative, so the axis starts at 0 and the band is clamped there.
export function band({ categories, mean, sd, format = compact, color = SERIES[0], unit = '', label = 'mean', zero = false }) {
  const lo = mean.map((m, i) => (zero ? Math.max(0, m - (sd?.[i] ?? 0)) : m - (sd?.[i] ?? 0)));
  const width = mean.map((m, i) => m + (sd?.[i] ?? 0) - lo[i]);
  return {
    animationDuration: 500,
    grid: { left: 8, right: 16, top: 14, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: AXIS } },
      formatter: (items) => {
        const i = items[0].dataIndex;
        return `<div style="margin-bottom:4px;color:${MUTED}">${esc(categories[i])}</div>`
          + tipRow(`${format(mean[i])}${unit}`, label) + (sd ? tipRow(`± ${format(sd[i])}${unit}`, '1 s.d.') : '');
      },
    },
    xAxis: categoryAxis(categories, { boundaryGap: false, axisLabel: { ...axisLabel, hideOverlap: true } }),
    yAxis: valueAxis({ scale: !zero, ...(zero && { min: 0 }) }),
    series: [
      ...(sd ? [
        { type: 'line', data: lo, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true },
        { type: 'line', data: width, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color, opacity: 0.12 }, silent: true },
      ] : []),
      { type: 'line', data: mean, symbol: 'circle', symbolSize: 8, lineStyle: { color, width: 2 }, itemStyle: { color, borderColor: '#fff', borderWidth: 2 } },
    ],
  };
}

// Two categorical axes, one sequential hue, values written in the cells.
export function heatmap({ x, y, cells, format = compact, label = 'mean' }) {
  const values = cells.map((c) => c[2]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // dark cells get light text
  const data = cells.map((c) => ({ value: c, label: { color: (c[2] - lo) / (hi - lo || 1) > 0.55 ? '#fff' : INK } }));
  return {
    animationDuration: 400,
    grid: { left: 8, right: 8, top: 8, bottom: 64, containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (p) => `<div style="margin-bottom:4px;color:${MUTED}">${esc(y[p.value[1]])} · ${esc(x[p.value[0]])}</div>`
        + tipRow(format(p.value[2]), label) + tipRow((p.value[3] ?? 0).toLocaleString(), 'admissions'),
    },
    xAxis: categoryAxis(x, { splitArea: { show: false }, axisLine: { show: false } }),
    yAxis: categoryAxis(y, { axisLine: { show: false } }),
    visualMap: {
      min: lo,
      max: hi,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 180,
      inRange: { color: SEQUENTIAL },
      text: [format(hi), format(lo)],
      textStyle: { color: MUTED, fontSize: 11 },
      dimension: 2,
    },
    series: [{
      type: 'heatmap',
      data,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: true, fontSize: 11.5, formatter: (p) => format(p.value[2]) },
      emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } },
    }],
  };
}

// Stacked minute counts: allowed in slot 1, denied in the critical status colour.
export function traffic({ minutes, allowed, denied }) {
  return {
    animationDuration: 400,
    grid: { left: 8, right: 8, top: 30, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: INK2, fontSize: 12 }, data: ['Allowed', 'Denied'] },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(42,120,214,0.06)' } },
      formatter: (items) => `<div style="margin-bottom:4px;color:${MUTED}">${esc(items[0].axisValue)}</div>`
        + items.map((it) => tipRow(it.value, it.seriesName.toLowerCase())).join(''),
    },
    xAxis: categoryAxis(minutes, { axisLabel: { ...axisLabel, hideOverlap: true } }),
    yAxis: valueAxis({ minInterval: 1 }),
    series: [
      { name: 'Allowed', type: 'bar', stack: 't', data: allowed, itemStyle: { color: SERIES[0], borderColor: '#fff', borderWidth: 1 } },
      { name: 'Denied', type: 'bar', stack: 't', data: denied, itemStyle: { color: CRITICAL, borderColor: '#fff', borderWidth: 1, borderRadius: [3, 3, 0, 0] } },
    ],
  };
}
