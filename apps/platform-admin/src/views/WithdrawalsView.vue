<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Withdrawal } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const withdrawals = ref<Withdrawal[]>([])
const loading = ref(true)
const error = ref('')
const remark = ref('')
const fmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })

async function load() {
  loading.value = true
  try {
    const data = await apis.withdrawals.list({ page: 1, pageSize: 50 })
    withdrawals.value = data.list
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function approve(id: string) {
  try { await apis.withdrawals.approve(id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

async function reject(id: string) {
  if (!remark.value.trim()) return
  try { await apis.withdrawals.reject(id, remark.value.trim()); remark.value = ''; await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">WITHDRAWALS / APPROVAL</p>
        <h1>提现审批</h1>
      </div>
      <button class="ghost-aurora" @click="load">刷新</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">提现工单</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!withdrawals.length" class="empty-panel"><span>暂无提现申请。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>金额</th><th>支付方式</th><th>账号</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="w in withdrawals" :key="w.id">
              <td><strong>{{ fmt.format(w.amount / 100) }}</strong></td>
              <td>{{ w.payMethod === 'alipay' ? '支付宝' : '微信' }}</td>
              <td style="font-family: var(--font-mono); font-size: 10px;">{{ w.payAccount }}</td>
              <td>
                <span :class="['status-badge', w.status === 'approved' ? 'active' : w.status === 'rejected' ? 'rejected' : 'draft']">
                  {{ { pending: '待审批', approved: '已通过', rejected: '已驳回' }[w.status] }}
                </span>
                <small v-if="w.remark" style="display: block; font-size: 9px; color: var(--ink-soft); margin-top: 2px;">{{ w.remark }}</small>
              </td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ new Date(w.createdAt).toLocaleDateString('zh-CN') }}</td>
              <td>
                <div v-if="w.status === 'pending'" style="display: flex; gap: 6px; align-items: center;">
                  <button class="row-action" @click="approve(w.id)">通过</button>
                  <input v-model="remark" placeholder="驳回理由" style="width: 120px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 4px; font-size: 10px;" />
                  <button class="row-action danger" @click="reject(w.id)">驳回</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
