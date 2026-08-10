<template>
  <div class="analytics-page">
    <div class="pg-header">
      <div><h1 class="pg-title">数据分析</h1><p class="pg-sub">多维度营销效果分析，洞察推广计划与词条表现</p></div>
      <div class="pg-actions">
        <a-select v-model:value="dateRange" style="width:140px" @change="loadData">
          <a-select-option value="7d">近7天</a-select-option>
          <a-select-option value="14d">近14天</a-select-option>
          <a-select-option value="30d">近30天</a-select-option>
        </a-select>
        <a-select v-model:value="selectedPlan" style="width:180px" placeholder="全部计划" allow-clear @change="loadData">
          <a-select-option v-for="p in plans" :key="p.id" :value="p.id">{{ p.keyword }} · {{ p.channelName }}</a-select-option>
        </a-select>
      </div>
    </div>

    <!-- Summary KPIs -->
    <div class="kpi-grid">
      <div v-for="(kpi, i) in kpis" :key="kpi.label"
           class="kpi-card animate-card"
           :style="{ animationDelay: i * 60 + 'ms' }">
        <div class="kpi-label">{{ kpi.label }}</div>
        <div class="kpi-value">{{ kpi.value }}</div>
        <div :class="['kpi-change', kpi.up ? 'up' : 'down']">{{ kpi.up ? '↑' : '↓' }} {{ kpi.change }}</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-row">
      <div class="chart-card large">
        <div class="card-head"><span class="card-title">趋势总览</span>
          <div class="metric-tabs">
            <span v-for="m in metricDefs" :key="m.key" :class="['m-tab', {active: activeMtab===m.key}]" @click="activeMtab=m.key; updateChart()">{{ m.label }}</span>
          </div>
        </div>
        <div ref="trendEl" class="echart-box" />
      </div>
      <div class="chart-card sm">
        <div class="card-head"><span class="card-title">词条状态分布</span></div>
        <div ref="pieEl" class="echart-box" />
      </div>
    </div>

    <!-- Top keywords -->
    <div class="top-kw-section">
      <div class="sec-head"><span class="sec-title">TOP 词条效果</span></div>
      <div class="table-card">
        <a-table :dataSource="topKws" :columns="kwCols" :pagination="false" row-key="keyword" size="middle">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'keyword'">
              <span style="font-family:var(--font-mono);font-size:13px;color:var(--color-text-primary);font-weight:500">{{ record.keyword }}</span>
            </template>
            <template v-if="column.key === 'ctr'">
              <div class="pct-bar-wrap"><div class="pct-bar-bg"><div class="pct-bar" :style="{width: Math.min(record.ctr*100,100)+'%'}"/></div><span>{{ fmtPct(record.ctr) }}</span></div>
            </template>
            <template v-if="column.key === 'cvr'">
              <div class="pct-bar-wrap"><div class="pct-bar-bg"><div class="pct-bar green" :style="{width: Math.min(record.cvr*100,100)+'%'}"/></div><span>{{ fmtPct(record.cvr) }}</span></div>
            </template>
            <template v-if="column.key === 'spend'">
              <span style="font-family:var(--font-mono);font-size:12px">{{ fmtFen(record.spend) }}</span>
            </template>
          </template>
        </a-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { metricsApi } from '@/api/metrics'
import { plansApi } from '@/api/plans'
import { compositionsApi } from '@/api/compositions'
import { fmtPct, fmtFen, fmtNum } from '@/utils/format'
import type { Plan, TrendPoint, OverviewResp } from '@/types/api'

const trendEl = ref<HTMLDivElement>()
const pieEl   = ref<HTMLDivElement>()
let trendChart: echarts.ECharts | null = null
let pieChart:   echarts.ECharts | null = null

const dateRange   = ref('7d')
const selectedPlan = ref<string>()
const activeMtab  = ref('impressions')
const metricDefs  = [
  { key: 'impressions', label: '曝光' },
  { key: 'clicks',      label: '点击' },
  { key: 'conversions', label: '转化' },
]
const metricColors: Record<string, string> = { impressions: '#6366f1', clicks: '#10b981', conversions: '#f59e0b' }

const overview     = ref<OverviewResp | null>(null)
const trendPoints  = ref<TrendPoint[]>([])
const plans        = ref<Plan[]>([])
const topKws       = ref<any[]>([])
const compCounts   = ref({ approved: 0, pending: 0, rejected: 0, other: 0 })

const kpis = computed(() => {
  const o = overview.value
  if (!o) return [
    { label: '平均CTR', value: '—', change: '—', up: true },
    { label: '平均CVR', value: '—', change: '—', up: true },
    { label: '平均CPC', value: '—', change: '—', up: false },
    { label: '总收益',  value: '—', change: '—', up: true },
  ]
  return [
    { label: '平均CTR', value: fmtPct(o.ctr),             change: '—', up: true },
    { label: '平均CVR', value: fmtPct(o.cvr),             change: '—', up: true },
    { label: '平均CPC', value: fmtFen(o.cpc),             change: '—', up: false },
    { label: '总收益',  value: fmtFen(o.totalEarnings),  change: '—', up: true },
  ]
})

function getDays(range: string) { return range === '7d' ? 7 : range === '14d' ? 14 : 30 }

async function loadData() {
  try {
    const days  = getDays(dateRange.value)
    const end   = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)
    const params = { from: start, to: end, planId: selectedPlan.value }

    const [ov, trend, kws, compList, planList] = await Promise.all([
      metricsApi.overview(),
      metricsApi.trend(params),
      metricsApi.byKeyword(params),
      compositionsApi.list({ page: 1, pageSize: 100 }),
      plansApi.list({ page: 1, pageSize: 50 }),
    ])
    overview.value    = ov
    trendPoints.value = trend
    topKws.value      = (kws as any).list?.slice(0, 10) ?? []
    plans.value       = planList.list

    const items = compList.list
    compCounts.value = {
      approved: items.filter(c => c.status === 'approved').length,
      pending:  items.filter(c => ['pending','accepted','submitted'].includes(c.status)).length,
      rejected: items.filter(c => c.status === 'rejected').length,
      other:    0,
    }

    renderTrendChart()
    renderPieChart()
  } catch (_) { /* empty state */ }
}

function renderTrendChart() {
  if (!trendEl.value) return
  if (!trendChart) trendChart = echarts.init(trendEl.value)
  const pts = trendPoints.value
  const key = activeMtab.value as keyof TrendPoint
  const color = metricColors[activeMtab.value]
  trendChart.setOption({
    backgroundColor: 'transparent',
    grid: { top: 16, right: 16, bottom: 24, left: 52 },
    tooltip: { trigger: 'axis', backgroundColor: '#1c1e27', borderColor: 'rgba(248,250,252,0.08)', textStyle: { color: '#f1f5f9' } },
    xAxis: { type: 'category', data: pts.map(p => p.date.slice(5)), axisLine: { lineStyle: { color: 'rgba(248,250,252,0.08)' } }, axisLabel: { color: '#64748b', fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(248,250,252,0.05)' } } },
    series: [{ name: metricDefs.find(m=>m.key===activeMtab.value)?.label ?? '', type: 'line', smooth: true, data: pts.map(p => (p as any)[key] ?? 0), lineStyle: { color, width: 2.5 }, symbol: 'none', areaStyle: { color: { type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{offset:0,color:color+'28'},{offset:1,color:color+'00'}] } } }],
  })
}

function renderPieChart() {
  if (!pieEl.value) return
  if (!pieChart) pieChart = echarts.init(pieEl.value)
  const { approved, pending, rejected } = compCounts.value
  pieChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', backgroundColor: '#1c1e27', borderColor: 'rgba(248,250,252,0.08)', textStyle: { color: '#f1f5f9' } },
    legend: { bottom: 8, textStyle: { color: '#94a3b8', fontSize: 11 } },
    series: [{
      name: '词条分布', type: 'pie', radius: ['40%','68%'], center: ['50%','45%'],
      label: { show: false }, labelLine: { show: false },
      data: [
        { value: approved, name: '审核通过', itemStyle: { color: '#10b981' } },
        { value: pending,  name: '审核中',   itemStyle: { color: '#6366f1' } },
        { value: rejected, name: '审核拒绝', itemStyle: { color: '#ef4444' } },
      ].filter(d => d.value > 0),
    }],
  })
}

function updateChart() { renderTrendChart() }

const handleResize = () => { trendChart?.resize(); pieChart?.resize() }
onMounted(() => { loadData(); window.addEventListener('resize', handleResize) })
onUnmounted(() => { trendChart?.dispose(); pieChart?.dispose(); window.removeEventListener('resize', handleResize) })

const kwCols = [
  { title: '关键词', key: 'keyword' },
  { title: '曝光', dataIndex: 'impressions', key: 'impressions', customRender: ({ text }: { text: number }) => fmtNum(text), width: 100 },
  { title: '点击', dataIndex: 'clicks', key: 'clicks', customRender: ({ text }: { text: number }) => fmtNum(text), width: 80 },
  { title: 'CTR', key: 'ctr', width: 150 },
  { title: 'CVR', key: 'cvr', width: 150 },
  { title: '转化数', dataIndex: 'conversions', key: 'conversions', width: 80 },
  { title: '花费', key: 'spend', width: 100 },
]
</script>

<style scoped>
.analytics-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.pg-actions { display: flex; gap: 8px; }
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
.kpi-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 18px; }
.kpi-label { font-size: 12px; color: var(--color-text-tertiary); margin-bottom: 8px; }
.kpi-value { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 5px; }
.kpi-change.up { font-size: 11.5px; color: var(--color-success); }
.kpi-change.down { font-size: 11.5px; color: var(--color-error); }
.charts-row { display: grid; grid-template-columns: 1fr 280px; gap: 14px; margin-bottom: 20px; }
.chart-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.card-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.metric-tabs { display: flex; gap: 4px; }
.m-tab { padding: 4px 10px; border-radius: var(--radius-full); font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.m-tab.active, .m-tab:hover { background: var(--color-accent-subtle); color: var(--color-accent); }
.echart-box { height: 200px; }
.chart-card.sm .echart-box { height: 180px; }
.sec-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.sec-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.pct-bar-wrap { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-secondary); font-family: var(--font-mono); }
.pct-bar-bg { flex: 1; height: 4px; background: var(--color-bg-active); border-radius: 99px; overflow: hidden; max-width: 80px; }
.pct-bar { height: 100%; background: var(--color-accent); border-radius: 99px; }
.pct-bar.green { background: var(--color-success); }
</style>
