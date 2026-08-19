<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Plan } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const plans = ref<Plan[]>([])
const loading = ref(true)
const error = ref('')
const statusFilter = ref('')
const fmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })
const statusLabels: Record<string, string> = { active: '投放中', paused: '已暂停', draft: '草稿', ended: '已结束', rejected: '已拒绝', archived: '已归档' }

async function load() {
  loading.value = true
  try {
    const data = await apis.plans.list({ page: 1, pageSize: 100, status: statusFilter.value as any || undefined })
    plans.value = data.list
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">ORDERS / MANAGEMENT</p>
        <h1>订单管理</h1>
      </div>
      <div class="page-actions">
        <select v-model="statusFilter" @change="load" style="padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px; background: var(--white);">
          <option value="">全部状态</option>
          <option value="active">投放中</option>
          <option value="paused">已暂停</option>
          <option value="draft">草稿</option>
          <option value="ended">已结束</option>
        </select>
        <button class="ghost-aurora" @click="load">刷新</button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <div>
          <span class="toolbar-title">会员订单</span>
          <span class="toolbar-count">{{ plans.length }}</span>
        </div>
      </div>
      <div v-if="loading" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!plans.length" class="empty-panel">
        <span>暂无订单数据。</span>
      </div>
      <div v-else class="responsive-table">
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>关键词</th>
              <th>渠道</th>
              <th>负责人</th>
              <th>日预算</th>
              <th>状态</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.id">
              <td><strong style="font-family: var(--font-mono); font-size: 10px;">{{ plan.id.slice(0, 8) }}</strong></td>
              <td>{{ plan.keyword }}</td>
              <td>{{ plan.channelName }}</td>
              <td>{{ plan.ownerName }}</td>
              <td>{{ plan.dailyBudget != null ? fmt.format(plan.dailyBudget / 100) : '—' }}</td>
              <td><span :class="['status-badge', plan.status]">{{ statusLabels[plan.status] }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ new Date(plan.createdAt).toLocaleDateString('zh-CN') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
