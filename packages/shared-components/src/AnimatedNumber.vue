<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * 滚动数字：从上一次的值滚到新值，结束时显示 text（金额请传精确文本，动画只用于展示）。
 * 系统开启「减少动态效果」时直接显示结果。
 */
const props = withDefaults(defineProps<{
  value: number
  decimals?: number
  text?: string
  duration?: number
}>(), { decimals: 0, duration: 1100 })

const format = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: props.decimals, maximumFractionDigits: props.decimals })
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const shown = ref(reduce ? props.text ?? format(props.value) : format(0))
let from = 0
let frame = 0

watch(() => [props.value, props.text] as const, ([to, text]) => {
  cancelAnimationFrame(frame)
  if (reduce || !Number.isFinite(to)) { shown.value = text ?? format(to); from = to; return }
  const start = performance.now(), origin = from
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / props.duration)
    const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
    shown.value = p === 1 ? text ?? format(to) : format(origin + (to - origin) * eased)
    if (p < 1) frame = requestAnimationFrame(step)
    else from = to
  }
  frame = requestAnimationFrame(step)
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template><span class="animated-number">{{ shown }}</span></template>

<style scoped>.animated-number { font-variant-numeric: tabular-nums; }</style>
