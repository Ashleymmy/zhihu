<script setup lang="ts">
import { onMounted, ref } from 'vue'

/** 圆环进度：挂载后从 0 转到目标值；中心内容走默认插槽 */
const props = withDefaults(defineProps<{ value: number; size?: number; color?: string; thickness?: number; label?: string }>(), {
  size: 112, color: 'var(--clay)', thickness: 10,
})
const r = (props.size - props.thickness) / 2
const c = 2 * Math.PI * r
const shown = ref(0)
onMounted(() => requestAnimationFrame(() => { shown.value = Math.max(0, Math.min(1, props.value)) }))
</script>

<template>
  <div class="ring-progress" :style="{ width: size + 'px', height: size + 'px' }" role="img" :aria-label="label ?? `${Math.round(value * 100)}%`">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" stroke="var(--line-soft)" :stroke-width="thickness" />
      <circle class="ring-value" :cx="size / 2" :cy="size / 2" :r="r" fill="none" :stroke="color" :stroke-width="thickness" stroke-linecap="round"
        :stroke-dasharray="c" :stroke-dashoffset="c * (1 - shown)" :transform="`rotate(-90 ${size / 2} ${size / 2})`" />
    </svg>
    <div class="ring-center"><slot>{{ Math.round(value * 100) }}%</slot></div>
  </div>
</template>

<style scoped>
.ring-progress { position: relative; flex: none; }
.ring-value { transition: stroke-dashoffset 1.4s var(--ease-out); }
.ring-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; font-family: var(--font-display); font-size: 22px; font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .ring-value { transition: none; } }
</style>
