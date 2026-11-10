<script setup lang="ts">
import type { SettlementSummary } from '@zhihu-koc/shared-contracts/core'
import { earningMoney as money } from './platform-earnings'
defineProps<{ item: SettlementSummary }>()
</script>
<template>
  <span>{{ item.recipient.name }} · {{ item.scope.from }} 至 {{ item.scope.to }} · {{ item.status === 'confirmed' ? '已确认' : '待确认预览' }} · 范围应得 {{ money(item.summary.amount) }}</span>
  <span v-if="item.status === 'preview'"> · 本次可确认变动 {{ money(item.summary.confirmableAmount) }}</span>
  <span v-else> · 查看本次确认结果</span>
</template>
