<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

export interface ShareItem {
  label: string
  value: number
  color: string
  /** 精确展示文本（金额用），缺省按 format 显示 */
  text?: string
}

/** 构成条：一条分段横条 + 图例（名称、数值、占比）；颜色跟着项目走，不按大小排序换色 */
const props = defineProps<{ items: ShareItem[]; format?: (value: number) => string }>()
const total = computed(() => props.items.reduce((sum, item) => sum + Math.max(0, item.value), 0))
const grown = ref(false)
onMounted(() => requestAnimationFrame(() => { grown.value = true }))
const pct = (v: number) => total.value ? (Math.max(0, v) / total.value * 100) : 0
</script>

<template>
  <div class="share-bar">
    <div class="share-track" role="img" :aria-label="items.map((i) => `${i.label} ${pct(i.value).toFixed(1)}%`).join('，')">
      <i v-for="item in items" :key="item.label" :style="{ flexGrow: grown ? Math.max(0, item.value) : 0, background: item.color }" />
    </div>
    <ul class="share-legend">
      <li v-for="item in items" :key="item.label">
        <span><i :style="{ background: item.color }" />{{ item.label }}</span>
        <b>{{ item.text ?? (format ? format(item.value) : item.value) }}</b>
        <em>{{ pct(item.value).toFixed(1) }}%</em>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.share-track { display: flex; gap: 3px; height: 12px; overflow: hidden; border-radius: 6px; background: var(--line-soft); }
.share-track i { display: block; flex: 0 0 0; min-width: 0; height: 100%; transition: flex-grow 1.1s var(--ease-out); }
.share-track i:first-child { border-radius: 6px 0 0 6px; }
.share-track i:last-child { border-radius: 0 6px 6px 0; }
.share-legend { display: grid; gap: 10px; margin: 16px 0 0; padding: 0; list-style: none; }
.share-legend li { display: grid; grid-template-columns: 1fr auto 52px; align-items: baseline; gap: 10px; }
.share-legend span { display: flex; align-items: center; gap: 7px; color: var(--ink-soft); font-size: 13px; }
.share-legend span i { width: 8px; height: 8px; border-radius: 2px; }
.share-legend b { font-family: var(--font-display); font-size: 18px; font-weight: 600; }
.share-legend em { color: var(--muted); font-size: 12px; font-style: normal; text-align: right; }
@media (prefers-reduced-motion: reduce) { .share-track i { transition: none; } }
</style>
