<template>
  <div class="earnings-view">
    <div class="page-header">
      <div>
        <h2 class="page-title">收益管理</h2>
        <p class="page-sub">查看佣金明细与提现记录</p>
      </div>
      <button class="btn-primary" @click="withdrawVisible = true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        申请提现
      </button>
    </div>

    <!-- Stats -->
    <div class="stats-grid">
      <div v-for="(s, i) in stats" :key="s.label"
           class="stat-card animate-card"
           :style="{ animationDelay: i * 55 + 'ms' }">
        <div class="stat-label">{{ s.label }}</div>
        <div class="stat-value">{{ s.value }}</div>
        <div class="stat-trend" :class="s.trendClass">{{ s.trend }}</div>
      </div>
    </div>

    <!-- Chart -->
    <div class="chart-card">
      <div class="card-header">
        <span class="card-title">收益趋势（近7日）</span>
        <a-range-picker v-model:value="dateRange" size="small" />
      </div>
      <div ref="chartEl" class="chart-box"></div>
    </div>

    <!-- Table -->
    <div class="table-card">
      <div class="card-header">
        <span class="card-title">收益明细</span>
        <div class="filter-row">
          <a-input v-model:value="searchKey" placeholder="搜索项目名称" size="small" style="width:180px">
            <template #prefix><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></template>
          </a-input>
          <a-select v-model:value="statusFilter" size="small" style="width:120px">
            <a-select-option value="all">全部状态</a-select-option>
            <a-select-option value="settled">已结算</a-select-option>
            <a-select-option value="pending">待审核</a-select-option>
            <a-select-option value="locked">已锁定</a-select-option>
          </a-select>
        </div>
      </div>
      <a-table
        :data-source="filteredRecords"
        :columns="columns"
        :pagination="{ pageSize: 10 }"
        size="middle"
        row-key="id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'amount'">
            <span class="amount-val">{{ fmtFen(record.amount) }}</span>
          </template>
          <template v-if="column.key === 'status'">
            <span class="badge" :class="`badge-${statusClass(record.status)}`">{{ statusLabel(record.status) }}</span>
          </template>
        </template>
      </a-table>
    </div>

    <!-- Withdraw Modal -->
    <a-modal v-model:open="withdrawVisible" title="申请提现" @ok="handleWithdraw" ok-text="确认提现" width="420">
      <div class="withdraw-form">
        <div class="balance-row">
          <span class="balance-label">可提现金额</span>
          <span class="balance-value">{{ fmtFen(withdrawableAmount * 100) }}</span>
        </div>
        <a-form layout="vertical" style="margin-top:20px">
          <a-form-item label="提现方式">
            <a-radio-group v-model:value="withdrawType">
              <a-radio value="alipay">支付宝</a-radio>
              <a-radio value="bank">银行卡</a-radio>
              <a-radio value="wechat">微信</a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item label="提现金额">
            <a-input-number v-model:value="withdrawAmount" :min="1" :max="1086.5" prefix="¥" style="width:100%" size="large" />
          </a-form-item>
        </a-form>
        <div class="tip-text">预计 1-3 个工作日到账</div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import type { TableColumnsType } from 'ant-design-vue'
import * as echarts from 'echarts'
import { earningsApi } from '@/api/earnings'
import { metricsApi } from '@/api/metrics'
import { fmtFen } from '@/utils/format'
import type { EarningRecord } from '@/types/api'

const chartEl = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

const dateRange      = ref<any>(null)
const searchKey      = ref('')
const statusFilter   = ref('all')
const withdrawVisible = ref(false)
const withdrawType   = ref('alipay')
const withdrawAmount = ref(0)

// Stats state
const stats = ref([
  { label: '今日收益',  value: '—', trend: '数据加载中…', trendClass: '' },
  { label: '本月收益',  value: '—', trend: '数据加载中…', trendClass: '' },
  { label: '累计收益',  value: '—', trend: '历史总计',    trendClass: '' },
  { label: '待结算',   value: '—', trend: '7日内到账',   trendClass: '' },
  { label: '可提现',   value: '—', trend: '可立即提现',  trendClass: '' },
])

const withdrawableAmount = ref(0)
const records = ref<EarningRecord[]>([])

const filteredRecords = computed(() => {
  let res = records.value
  if (statusFilter.value !== 'all') res = res.filter(r => r.status === statusFilter.value)
  if (searchKey.value) res = res.filter(r => r.keyword.includes(searchKey.value) || r.channelName.includes(searchKey.value))
  return res
})

function statusClass(s: string) {
  return s === 'settled' ? 'success' : s === 'pending' ? 'warning' : 'info'
}
function statusLabel(s: string) {
  return s === 'settled' ? '已结算' : s === 'pending' ? '待结算' : '已锁定'
}

const columns: TableColumnsType = [
  { title: '日期',      dataIndex: 'date',         key: 'date',         width: 120 },
  { title: '关键词',    dataIndex: 'keyword',       key: 'keyword' },
  { title: '渠道',      dataIndex: 'channelName',  key: 'channelName', width: 120 },
  { title: '负责人',    dataIndex: 'ownerName',    key: 'ownerName',   width: 90 },
  { title: '金额',      dataIndex: 'amount',        key: 'amount',       width: 110 },
  { title: '状态',      dataIndex: 'status',        key: 'status',       width: 100 },
]

function handleWithdraw() {
  message.success(`已申请提现 ¥${withdrawAmount.value.toFixed(2)}，预计1-3个工作日到账`)
  withdrawVisible.value = false
}

function initChart(trendData: Array<{ date: string; earnings: number }>) {
  if (!chartEl.value) return
  if (!chart) chart = echarts.init(chartEl.value)
  chart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 16, right: 16, top: 32, bottom: 32, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: 'var(--color-bg-elevated)', borderColor: 'var(--color-border)', textStyle: { color: 'var(--color-text-primary)' }, formatter: (p: any) => `${p[0].name}<br/>收益 ${fmtFen(p[0].value)}` },
    xAxis: { type: 'category', data: trendData.map(p => p.date.slice(5)), axisLine: { lineStyle: { color: 'var(--color-border)' } }, axisLabel: { color: 'var(--color-text-tertiary)' } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: 'var(--color-border)', type: 'dashed' } }, axisLabel: { formatter: (v: number) => fmtFen(v), color: 'var(--color-text-tertiary)' } },
    series: [{
      name: '收益', type: 'bar', data: trendData.map(p => p.earnings),
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#6366f1' }, { offset: 1, color: '#8b5cf6' }]), borderRadius: [6, 6, 0, 0] },
      barWidth: '28%',
    }],
  })
}

async function loadData() {
  try {
    const end   = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
    const [summary, recordList, trendPoints] = await Promise.all([
      earningsApi.summary(),
      earningsApi.list({ page: 1, pageSize: 50 }),
      metricsApi.trend({ from: start, to: end }),
    ])

    const s = summary as any
    stats.value = [
      { label: '累计收益', value: fmtFen(s.total   ?? 0), trend: '历史总计',    trendClass: '' },
      { label: '已结算',  value: fmtFen(s.settled  ?? 0), trend: '已完成结算',  trendClass: '' },
      { label: '待结算',  value: fmtFen(s.pending  ?? 0), trend: '7日内到账',   trendClass: '' },
      { label: '已锁定',  value: fmtFen(s.locked   ?? 0), trend: '锁定中',      trendClass: '' },
      { label: '可提现',  value: fmtFen(s.settled  ?? 0), trend: '可立即提现',  trendClass: '' },
    ]
    withdrawableAmount.value = (s.settled ?? 0) / 100
    withdrawAmount.value = withdrawableAmount.value
    records.value = recordList.list

    initChart(trendPoints.map(p => ({ date: p.date, earnings: p.earnings })))
  } catch (_) { /* empty state */ }
}

const handleResize = () => chart?.resize()
onMounted(() => { loadData(); window.addEventListener('resize', handleResize) })
onUnmounted(() => { chart?.dispose(); window.removeEventListener('resize', handleResize) })
</script>

<style scoped>
.earnings-view { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 4px; }
.page-sub { font-size: 13px; color: var(--color-text-tertiary); margin: 0; }
.btn-primary { height: 38px; padding: 0 20px; background: var(--color-accent); border-radius: var(--radius-md); font-size: 14px; font-weight: 600; color: white; display: inline-flex; align-items: center; gap: 8px; transition: all var(--transition-fast); border: none; cursor: pointer; }
.btn-primary:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); }
.stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; transition: border-color var(--transition-base); }
.stat-card:hover { border-color: var(--color-border-hover); }
.stat-label { font-size: 12px; color: var(--color-text-tertiary); margin-bottom: 8px; }
.stat-value { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 6px; }
.stat-trend { font-size: 12px; color: var(--color-text-disabled); }
.stat-trend.up { color: var(--color-success); }
.chart-card, .table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.card-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.filter-row { display: flex; gap: 12px; }
.chart-box { height: 240px; }
.amount-val { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--color-accent); }
.balance-row { display: flex; justify-content: space-between; align-items: center; padding: 16px; background: var(--color-bg-secondary); border-radius: var(--radius-md); }
.balance-label { font-size: 14px; color: var(--color-text-secondary); }
.balance-value { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-accent); }
.tip-text { font-size: 12px; color: var(--color-text-tertiary); margin-top: 12px; }
</style>
