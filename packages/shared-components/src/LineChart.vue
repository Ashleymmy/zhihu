<script setup lang="ts">
import { computed } from 'vue'

export interface LineSeries {
  label: string
  color?: string
  points: number[]
}

const props = withDefaults(defineProps<{
  labels: string[]
  series: LineSeries[]
  height?: number
}>(), { height: 220 })

const W = 720
const PAD = { top: 16, right: 12, bottom: 24, left: 44 }

const palette = ['#e66b3a', '#5d7668', '#b98a2f', '#39454c']

const maxValue = computed(() => {
  const max = Math.max(1, ...props.series.flatMap((s) => s.points))
  // 取整到好看的上限
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  return Math.ceil(max / pow * 10) / 10 * pow * (max / pow > 5 ? 1 : 2) || 1
})

function x(i: number) {
  const n = Math.max(props.labels.length - 1, 1)
  return PAD.left + (i / n) * (W - PAD.left - PAD.right)
}

function y(v: number) {
  const h = props.height - PAD.top - PAD.bottom
  return PAD.top + h - (v / maxValue.value) * h
}

function pathFor(points: number[]) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
}

function areaFor(points: number[]) {
  const base = props.height - PAD.bottom
  return `${pathFor(points)} L${x(points.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`
}

const gridTicks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((t) => ({ y: y(maxValue.value * t), value: maxValue.value * t })))

function fmtTick(v: number) {
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(Math.round(v))
}
</script>

<template>
  <div class="line-chart">
    <svg :viewBox="`0 0 ${W} ${height}`" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
      <g v-for="t in gridTicks" :key="t.y">
        <line :x1="PAD.left" :y1="t.y" :x2="W - PAD.right" :y2="t.y" stroke="#dedbd4" stroke-width="1" :stroke-dasharray="t.value === 0 ? '' : '3 4'" />
        <text :x="PAD.left - 8" :y="t.y + 3" text-anchor="end" fill="#8a9196" style="font-family: var(--font-mono); font-size: 12px;">{{ fmtTick(t.value) }}</text>
      </g>
      <text v-for="(label, i) in labels" :key="i" :x="x(i)" :y="height - 8" text-anchor="middle" fill="#8a9196" style="font-family: var(--font-mono); font-size: 12px;">{{ label }}</text>
      <template v-for="(s, si) in series" :key="s.label">
        <path class="line-area" :d="areaFor(s.points)" :fill="s.color ?? palette[si % palette.length]" fill-opacity="0.06" />
        <path class="line-path" :d="pathFor(s.points)" :stroke="s.color ?? palette[si % palette.length]" stroke-width="1.6" fill="none" stroke-linejoin="round" stroke-linecap="round" pathLength="1" />
        <circle v-for="(p, i) in s.points" :key="i" class="line-point" :style="{ animationDelay: `${i * 45}ms` }" :cx="x(i)" :cy="y(p)" r="2.2" :fill="s.color ?? palette[si % palette.length]" />
      </template>
    </svg>
    <div class="line-chart-legend">
      <span v-for="(s, si) in series" :key="s.label"><i :style="{ background: s.color ?? palette[si % palette.length] }" />{{ s.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.line-chart { display: grid; gap: 10px; }
.line-chart-legend { display: flex; gap: 16px; }
.line-chart-legend span { display: flex; align-items: center; gap: 6px; color: var(--ink-soft); font-family: var(--font-mono); font-size: 12px; }
.line-chart-legend i { width: 8px; height: 2px; }
.line-path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: line-draw 0.7s var(--ease-out, ease) 0.05s forwards; }
.line-area { opacity: 0; animation: line-area-in 0.5s ease 0.45s forwards; }
.line-point { opacity: 0; animation: point-in 0.25s ease-out forwards; transform-origin: center; transform-box: fill-box; }
@keyframes line-draw { to { stroke-dashoffset: 0; } }
@keyframes line-area-in { to { opacity: 1; } }
@keyframes point-in { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .line-path, .line-area, .line-point { animation: none !important; opacity: 1; stroke-dashoffset: 0; }
}
</style>
