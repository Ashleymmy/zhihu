<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { EarningRecord } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const loading = ref(true)
const error = ref('')
const earnings = ref<EarningRecord[]>([])
const total = ref(0)

async function load() {
  loading.value = true
  try {
    const data = await apis.earnings.list({ page: 1, pageSize: 50 })
    earnings.value = data.list
    total.value = data.total
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">SETTLEMENT / MANAGEMENT</p>
        <h1>结算管理</h1>
      </div>
      <button class="ghost-aurora" @click="load">刷新</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <div>
          <span class="toolbar-title">结算单汇总</span>
          <span class="toolbar-count">{{ total }}</span>
        </div>
      </div>
      <div v-if="loading" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!earnings.length" class="empty-panel">
        <span>暂无结算记录。</span>
      </div>
      <div v-else class="responsive-table">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>关键词</th>
              <th>渠道</th>
              <th>负责人</th>
              <th>金额</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in earnings" :key="item.id">
              <td>{{ item.date }}</td>
              <td>{{ item.keyword }}</td>
              <td>{{ item.channelName }}</td>
              <td>{{ item.ownerName }}</td>
              <td><strong>{{ new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(item.amount / 100) }}</strong></td>
              <td>
                <span :class="['status-badge', item.status === 'confirmed' ? 'active' : item.status === 'pending' ? 'draft' : 'paid']">
                  {{ { pending: '待确认', confirmed: '已确认', paid: '已打款' }[item.status] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
