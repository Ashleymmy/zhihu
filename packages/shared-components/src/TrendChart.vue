<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface TrendSeries {
  label: string
  color: string
  points: number[]
  /** 主序列画渐变面积 */
  area?: boolean
}

/**
 * 趋势图：按容器实际宽度绘制（字号不随缩放变化），首次出现时曲线从左到右画出，
 * 悬停显示竖线与各序列数值；同时输出一张读屏可用的数据表。
 */
const props = withDefaults(defineProps<{
  labels: string[]
  series: TrendSeries[]
  height?: number
  format?: (value: number) => string
  caption?: string
}>(), { height: 220, caption: '趋势数据' })

const root = ref<HTMLElement | null>(null)
const width = ref(640)
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!root.value || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => { if (entry) width.value = Math.max(280, Math.round(entry.contentRect.width)) })
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const PAD = { top: 14, right: 12, bottom: 26, left: 52 }
const fmt = (v: number) => props.format ? props.format(v) : v.toLocaleString('zh-CN')
const n = computed(() => props.labels.length)
const max = computed(() => {
  const raw = Math.max(0, ...props.series.flatMap((s) => s.points)) * 1.12
  if (raw <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10
  return step * pow
})
const x = (i: number) => PAD.left + (n.value <= 1 ? 0 : i * (width.value - PAD.left - PAD.right) / (n.value - 1))
const y = (v: number) => PAD.top + (props.height - PAD.top - PAD.bottom) * (1 - v / max.value)
const baseline = computed(() => props.height - PAD.bottom)

function smooth(points: number[]) {
  if (!points.length) return ''
  let d = `M${x(0).toFixed(1)} ${y(points[0] ?? 0).toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const x0 = x(i - 1), x1 = x(i), y0 = y(points[i - 1] ?? 0), y1 = y(points[i] ?? 0), cx = (x0 + x1) / 2
    d += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  return d
}
const paths = computed(() => props.series.map((s) => {
  const line = smooth(s.points)
  return { ...s, line, fill: s.area && line ? `${line} L${x(s.points.length - 1).toFixed(1)} ${baseline.value} L${x(0).toFixed(1)} ${baseline.value}Z` : '' }
}))
const yTicks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((t) => ({ y: y(max.value * t), label: fmt(max.value * t) })))
const xTicks = computed(() => {
  const count = Math.max(2, Math.floor(width.value / 96))
  const step = Math.max(1, Math.ceil(n.value / count))
  return props.labels.map((label, i) => ({ label, i })).filter(({ i }) => (i % step === 0 && n.value - 1 - i >= step * 0.6) || i === n.value - 1)
})

const gid = `trend-${Math.random().toString(36).slice(2, 9)}`

const hover = ref<number | null>(null)
function onMove(event: PointerEvent) {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect()
  const px = event.clientX - box.left
  const i = Math.round((px - PAD.left) / (width.value - PAD.left - PAD.right) * (n.value - 1))
  hover.value = Math.max(0, Math.min(n.value - 1, i))
}
const tipLeft = computed(() => hover.value === null ? 0 : Math.min(width.value - 170, Math.max(0, x(hover.value) + 12)))
</script>

<template>
  <div ref="root" class="trend-chart" :style="{ height: height + 'px' }">
    <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="caption" @pointermove="onMove" @pointerleave="hover = null">
      <defs>
        <linearGradient v-for="(s, si) in paths" :id="`${gid}-${si}`" :key="si" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" :stop-color="s.color" stop-opacity="0.22" />
          <stop offset="1" :stop-color="s.color" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g class="trend-grid">
        <template v-for="t in yTicks" :key="t.y">
          <line :x1="PAD.left" :x2="width - PAD.right" :y1="t.y" :y2="t.y" />
          <text :x="PAD.left - 8" :y="t.y + 4" text-anchor="end">{{ t.label }}</text>
        </template>
        <text v-for="t in xTicks" :key="t.i" :x="x(t.i)" :y="height - 6" text-anchor="middle">{{ t.label }}</text>
      </g>
      <template v-for="(s, si) in paths" :key="s.label">
        <path v-if="s.fill" class="trend-area" :d="s.fill" :fill="`url(#${gid}-${si})`" />
        <path class="trend-line" :d="s.line" :stroke="s.color" :stroke-width="si === 0 ? 2.4 : 2" pathLength="1" fill="none" />
      </template>
      <g v-if="hover !== null" class="trend-cross">
        <line :x1="x(hover)" :x2="x(hover)" :y1="PAD.top" :y2="baseline" />
        <circle v-for="s in paths" :key="s.label" :cx="x(hover)" :cy="y(s.points[hover] ?? 0)" r="5" :fill="s.color" />
      </g>
    </svg>
    <div v-if="hover !== null" class="trend-tip" :style="{ left: tipLeft + 'px' }" aria-hidden="true">
      <b>{{ labels[hover] }}</b>
      <span v-for="s in series" :key="s.label"><i :style="{ background: s.color }" />{{ s.label }}<em>{{ fmt(s.points[hover] ?? 0) }}</em></span>
    </div>
    <table class="sr-only">
      <caption>{{ caption }}</caption>
      <thead><tr><th>日期</th><th v-for="s in series" :key="s.label">{{ s.label }}</th></tr></thead>
      <tbody><tr v-for="(label, i) in labels" :key="label"><td>{{ label }}</td><td v-for="s in series" :key="s.label">{{ fmt(s.points[i] ?? 0) }}</td></tr></tbody>
    </table>
  </div>
</template>

<style scoped>
.trend-chart { position: relative; width: 100%; }
.trend-chart svg { display: block; overflow: visible; touch-action: pan-y; }
.trend-grid line { stroke: var(--line-soft); }
.trend-grid text { fill: var(--muted); font-size: 11px; font-family: var(--font-sans); }
.trend-line { stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: trend-draw 1.3s var(--ease-out) 0.1s forwards; }
.trend-area { opacity: 0; animation: trend-fade 0.9s ease 0.45s forwards; }
.trend-cross line { stroke: var(--muted); stroke-dasharray: 3 3; }
.trend-cross circle { stroke: #fff; stroke-width: 2.5; }
.trend-tip { position: absolute; top: 4px; z-index: 2; display: grid; gap: 3px; min-width: 150px; padding: 9px 12px; border-radius: 12px; color: #fff; background: var(--ink); box-shadow: 0 10px 24px rgba(20, 20, 19, 0.25); font-size: 12px; pointer-events: none; }
.trend-tip b { font-size: 12.5px; }
.trend-tip span { display: flex; align-items: center; gap: 6px; }
.trend-tip i { width: 8px; height: 8px; border-radius: 2px; }
.trend-tip em { margin-left: auto; padding-left: 12px; font-style: normal; font-weight: 650; }
@keyframes trend-draw { to { stroke-dashoffset: 0; } }
@keyframes trend-fade { to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .trend-line, .trend-area { animation: none; stroke-dashoffset: 0; opacity: 1; } }
</style>
