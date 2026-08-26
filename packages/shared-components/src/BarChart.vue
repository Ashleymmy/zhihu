<script setup lang="ts">
import { computed } from 'vue'

export interface BarItem {
  label: string
  value: number
  hint?: string
}

const props = withDefaults(defineProps<{
  items: BarItem[]
  /** 数值格式化，如金额 `(v) => '¥' + v` */
  format?: (value: number) => string
  color?: string
  maxItems?: number
}>(), { color: '#20292f', maxItems: 10 })

const shown = computed(() => props.items.slice(0, props.maxItems))
const maxValue = computed(() => Math.max(1e-9, ...shown.value.map((i) => i.value)))

function fmt(v: number) {
  if (props.format) return props.format(v)
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`
  return String(Math.round(v * 100) / 100)
}
</script>

<template>
  <div class="bar-chart">
    <div v-for="item in shown" :key="item.label" class="bar-row">
      <span class="bar-label" :title="item.label">{{ item.label }}</span>
      <div class="bar-track">
        <div class="bar-fill" :style="{ width: `${(item.value / maxValue) * 100}%`, background: color }" />
      </div>
      <span class="bar-value">{{ fmt(item.value) }}<small v-if="item.hint">{{ item.hint }}</small></span>
    </div>
    <p v-if="!shown.length" class="bar-empty">暂无数据</p>
  </div>
</template>

<style scoped>
.bar-chart { display: grid; gap: 10px; }
.bar-row { display: grid; grid-template-columns: minmax(90px, 140px) 1fr minmax(56px, auto); align-items: center; gap: 10px; }
.bar-label { overflow: hidden; color: var(--ink-soft); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { height: 8px; background: var(--paper-deep); }
.bar-fill { height: 100%; min-width: 2px; transform-origin: left; animation: bar-grow 0.55s var(--ease-out, ease) both; }
@keyframes bar-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (prefers-reduced-motion: reduce) { .bar-fill { animation: none; } }
.bar-value { color: var(--ink); font-family: var(--font-mono); font-size: 12px; text-align: right; }
.bar-value small { color: var(--ink-soft); margin-left: 4px; }
.bar-empty { margin: 0; padding: 12px 0; color: var(--ink-soft); font-size: 13px; text-align: center; }
</style>
