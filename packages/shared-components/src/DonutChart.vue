<script setup lang="ts">
import { computed } from 'vue'

export interface DonutSlice {
  label: string
  value: number
  color?: string
}

const props = withDefaults(defineProps<{
  slices: DonutSlice[]
  centerLabel?: string
  size?: number
}>(), { size: 160, centerLabel: '总计' })

const palette = ['#e66b3a', '#5d7668', '#b98a2f', '#39454c', '#c3c1bb']

const total = computed(() => props.slices.reduce((sum, s) => sum + s.value, 0))

const R = 40
const C = 2 * Math.PI * R

const arcs = computed(() => {
  let offset = 0
  return props.slices
    .filter((s) => s.value > 0)
    .map((s, i) => {
      const frac = total.value ? s.value / total.value : 0
      const arc = { ...s, color: s.color ?? palette[i % palette.length], dash: `${(frac * C).toFixed(2)} ${C.toFixed(2)}`, offset: -offset }
      offset += frac * C
      return arc
    })
})
</script>

<template>
  <div class="donut-chart">
    <div class="donut-wrap" :style="{ width: `${size}px`, height: `${size}px` }">
      <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; display: block; transform: rotate(-90deg);">
        <circle cx="50" cy="50" :r="R" fill="none" stroke="#efede8" stroke-width="10" />
        <circle
          v-for="arc in arcs"
          :key="arc.label"
          cx="50" cy="50" :r="R" fill="none"
          :stroke="arc.color" stroke-width="10"
          :stroke-dasharray="arc.dash"
          :stroke-dashoffset="arc.offset"
        />
      </svg>
      <div class="donut-center">
        <strong>{{ total.toLocaleString() }}</strong>
        <span>{{ centerLabel }}</span>
      </div>
    </div>
    <div class="donut-legend">
      <span v-for="(s, i) in slices" :key="s.label">
        <i :style="{ background: s.color ?? palette[i % palette.length] }" />
        {{ s.label }} <b>{{ total ? Math.round((s.value / total) * 100) : 0 }}%</b>
      </span>
    </div>
  </div>
</template>

<style scoped>
.donut-chart { display: flex; align-items: center; gap: 18px; }
.donut-wrap { position: relative; flex-shrink: 0; }
.donut-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 2px; }
.donut-chart circle[stroke-dasharray] { animation: donut-sweep 0.6s var(--ease-out, ease) both; }
@keyframes donut-sweep { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .donut-chart circle { animation: none !important; } }
.donut-center strong { font-family: var(--font-display); font-size: 22px; letter-spacing: -0.03em; }
.donut-center span { color: var(--ink-soft); font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.12em; }
.donut-legend { display: grid; gap: 8px; }
.donut-legend span { display: flex; align-items: center; gap: 7px; color: var(--ink-soft); font-size: 11px; }
.donut-legend i { width: 8px; height: 8px; border-radius: 1px; }
.donut-legend b { margin-left: 2px; color: var(--ink); font-family: var(--font-mono); font-weight: 500; }
</style>
