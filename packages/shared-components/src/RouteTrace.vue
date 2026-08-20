<script setup lang="ts">
/**
 * RouteTrace 路线刻度
 * 节点 + 线段组成的页面级操作语法，表达工作流的 输入 → 流转 → 归档
 */
defineProps<{
  /** 路线编号，如 "ROUTE / 01" */
  code: string
  /** 路线说明，如 "决策 → 队列 → 协作" */
  label: string
}>()
</script>

<template>
  <div class="route-trace" :aria-label="label">
    <div class="route-trace-track" aria-hidden="true">
      <i class="node-a" />
      <i class="seg-a" />
      <i class="node-b" />
      <i class="seg-b" />
      <i class="node-c" />
    </div>
    <code>{{ code }}</code>
    <span>{{ label }}</span>
  </div>
</template>
