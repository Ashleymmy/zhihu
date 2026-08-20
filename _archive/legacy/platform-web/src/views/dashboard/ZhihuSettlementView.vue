<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">结算明细</h1><p class="pg-sub">推广收益结算记录，按状态筛选查看</p></div>
      <div class="header-actions">
        <a-select v-model:value="statusFilter" style="width:130px" allow-clear placeholder="全部状态" @change="onStatusChange">
          <a-select-option value="pending">待确认</a-select-option>
          <a-select-option value="confirmed">已确认</a-select-option>
          <a-select-option value="paid">已结算</a-select-option>
        </a-select>
        <button class="btn-outline-sm" :disabled="loading" @click="refresh">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
          刷新
        </button>
      </div>
    </div>

    <!-- 汇总卡片 -->
    <div class="summary-row">
      <div v-for="(s, i) in summaryCards" :key="s.l" class="sum-card animate-card" :style="{ animationDelay: i * 60 + 'ms' }">
        <div class="sum-label">{{ s.l }}</div>
        <div v-if="summaryLoading" class="skeleton" style="height:26px;width:90px;margin-bottom:6px"></div>
        <div v-else class="sum-value" :style="s.color ? { color: s.color } : {}">{{ s.v }}</div>
        <div class="sum-sub">{{ s.sub }}</div>
      </div>
    </div>

    <!-- 收益明细列表 -->
    <div class="table-card">
      <a-table :data-source="records" :loading="loading" row-key="id" size="middle"
               :pagination="{ total, pageSize, current: page, showTotal: (t: number) => `共 ${t} 条`, onChange: onPageChange }"
               :locale="{ emptyText: '暂无结算记录' }">
        <a-table-column title="日期" data-index="date" :width="110" />
        <a-table-column title="关键词" data-index="keyword" :ellipsis="true" />
        <a-table-column title="渠道" data-index="channelName" :width="150" :ellipsis="true" />
        <a-table-column title="KOC" data-index="ownerName" :width="110" />
        <a-table-column title="金额" :width="120" align="right">
          <template #default="{ record }">
            <span class="amount-text">{{ fmtFen(record.amount) }}</span>
          </template>
        </a-table-column>
        <a-table-column title="状态" :width="100">
          <template #default="{ record }">
            <span :class="['badge', record.status === 'paid' ? 'badge-success' : record.status === 'confirmed' ? 'badge-accent' : 'badge-warning']">
              <span class="badge-dot"/>{{ earningsStatusLabel(record.status) }}
            </span>
          </template>
        </a-table-column>
        <a-table-column title="操作" :width="72">
          <template #default="{ record }">
            <button class="act-btn" @click="viewDetail(record)">详情</button>
          </template>
        </a-table-column>
      </a-table>
    </div>

    <!-- 详情弹窗 -->
    <a-modal v-model:open="detailVisible" title="收益明细详情" :footer="null" width="440">
      <div v-if="currentItem" class="detail-rows">
        <div class="dr"><span class="dk">日期</span><span class="dv">{{ currentItem.date }}</span></div>
        <div class="dr"><span class="dk">关键词</span><span class="dv">{{ currentItem.keyword }}</span></div>
        <div class="dr"><span class="dk">推广计划 ID</span><span class="dv mono-sm">{{ currentItem.planId }}</span></div>
        <div class="dr"><span class="dk">渠道</span><span class="dv">{{ currentItem.channelName }}</span></div>
        <div class="dr"><span class="dk">KOC</span><span class="dv">{{ currentItem.ownerName }}</span></div>
        <div class="dr"><span class="dk">金额</span><span class="dv amount-text">{{ fmtFen(currentItem.amount) }}</span></div>
        <div class="dr"><span class="dk">状态</span>
          <span :class="['badge', currentItem.status === 'paid' ? 'badge-success' : currentItem.status === 'confirmed' ? 'badge-accent' : 'badge-warning']">
            {{ earningsStatusLabel(currentItem.status) }}
          </span>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { earningsApi }              from '@/api/earnings'
import { fmtFen, earningsStatusLabel } from '@/utils/format'
import type { EarningRecord, EarningsSummaryResp } from '@/types/api'

const loading       = ref(true)
const summaryLoading = ref(true)
const statusFilter  = ref<string | undefined>(undefined)
const records       = ref<EarningRecord[]>([])
const total         = ref(0)
const page          = ref(1)
const pageSize      = 15

const detailVisible = ref(false)
const currentItem   = ref<EarningRecord | null>(null)

const summary = ref<EarningsSummaryResp>({ pending: 0, confirmed: 0, paid: 0, total: 0 })

const summaryCards = computed(() => [
  { l: '累计收益', v: fmtFen(summary.value.total),     sub: '全部周期', color: '' },
  { l: '已结算',   v: fmtFen(summary.value.paid),      sub: '已入账',   color: 'var(--color-success)' },
  { l: '已确认',   v: fmtFen(summary.value.confirmed), sub: '待打款',   color: 'var(--color-accent)' },
  { l: '待确认',   v: fmtFen(summary.value.pending),   sub: '审核中',   color: 'var(--color-warning)' },
])

async function loadRecords() {
  loading.value = true
  try {
    const res = await earningsApi.list({
      page: page.value,
      pageSize,
      status: statusFilter.value as any,
    })
    records.value = res.list
    total.value   = res.total
  } finally { loading.value = false }
}

async function loadSummary() {
  summaryLoading.value = true
  try { summary.value = await earningsApi.summary() }
  finally { summaryLoading.value = false }
}

async function onStatusChange() { page.value = 1; await loadRecords() }
async function onPageChange(p: number) { page.value = p; await loadRecords() }
async function refresh() { await Promise.all([loadRecords(), loadSummary()]) }

function viewDetail(item: EarningRecord) { currentItem.value = item; detailVisible.value = true }

onMounted(() => { loadRecords(); loadSummary() })
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.header-actions { display: flex; gap: 8px; align-items: center; }
.btn-outline-sm { display: flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid var(--color-border-hover); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-text-secondary); background: none; cursor: pointer; transition: all var(--transition-fast); }
.btn-outline-sm:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-accent); }
.btn-outline-sm:disabled { opacity: 0.5; cursor: not-allowed; }
.summary-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
.sum-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; opacity: 0; }
.sum-label { font-size: 12px; color: var(--color-text-tertiary); margin-bottom: 8px; }
.sum-value { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.sum-sub { font-size: 11.5px; color: var(--color-text-disabled); }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.amount-text { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--color-accent); }
.mono-sm { font-size: 11.5px; font-family: var(--font-mono); color: var(--color-text-disabled); }
.act-btn { padding: 4px 10px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 11.5px; color: var(--color-text-secondary); cursor: pointer; transition: all var(--transition-fast); }
.act-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.detail-rows { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; }
.dr { display: flex; align-items: center; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--color-border); }
.dr:last-child { border-bottom: none; }
.dk { font-size: 12px; color: var(--color-text-tertiary); min-width: 80px; }
.dv { font-size: 13px; color: var(--color-text-secondary); }
.badge-accent { background: var(--color-accent-subtle); color: var(--color-accent); border: 1px solid var(--color-accent-border); }
</style>
