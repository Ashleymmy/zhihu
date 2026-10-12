<script setup lang="ts">
/**
 * demo 同款 toast 容器：挂在 FinanceFlow 根部一次即可
 * 结构对齐 demo #toasts / .toast
 */
import { useToast } from '../composables/useToast'

const { items } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="finance-flow-toasts" role="status" aria-live="polite">
      <div v-for="t in items" :key="t.id" class="toast">{{ t.text }}</div>
    </div>
  </Teleport>
</template>
