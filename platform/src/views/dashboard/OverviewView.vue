<template>
  <div class="overview-page">
    <!-- Header -->
    <div class="pg-header">
      <div>
        <h1 class="pg-title">数据总览</h1>
        <p class="pg-sub">{{ today }} · 所有数据实时更新</p>
      </div>
      <div class="pg-actions">
        <router-link to="/dashboard/campaigns" class="btn-outline-sm">+ 新建计划</router-link>
        <router-link to="/dashboard/analytics" class="btn-accent-sm">查看分析 →</router-link>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid">
      <!-- skeleton while loading -->
      <template v-if="loading">
        <div v-for="i in 4" :key="i" class="kpi-card">
          <div class="kpi-top">
            <div class="skeleton" style="height:13px;width:60px"></div>
            <div class="skeleton" style="width:32px;height:32px;border-radius:var(--radius-md)"></div>
          </div>
          <div class="skeleton" style="height:30px;width:100px;margin-bottom:10px"></div>
          <div class="skeleton" style="height:11px;width:80px"></div>
        </div>
      </template>
      <!-- real cards -->
      <template v-else>
        <div
          v-for="(kpi, i) in kpis" :key="kpi.label"
          class="kpi-card animate-card"
          :style="{ animationDelay: i * 55 + 'ms' }"
        >
          <div class="kpi-top">
            <span class="kpi-label">{{ kpi.label }}</span>
            <div class="kpi-icon" :style="{ background: kpi.bg }">
              <span v-html="kpi.icon" />
            </div>
          </div>
          <div class="kpi-value">{{ kpi.value }}</div>
          <div class="kpi-change" :class="kpi.up ? 'up' : 'down'">
            {{ kpi.up ? '↑' : '↓' }} {{ kpi.change }}
          </div>
        </div>
      </template>
    </div>

    <!-- Charts row -->
    <div class="chart-row">
      <div class="chart-card main-chart animate-card" style="animation-delay:240ms">
        <div class="card-head"><span class="card-title">近7日趋势</span>
          <div class="legend-row">
            <span class="leg-dot" style="background:#6366f1"/>曝光
            <span class="leg-dot" style="background:#10b981"/>点击
            <span class="leg-dot" style="background:#f59e0b"/>转化
          </div>
        </div>
        <div ref="chartEl" class="echart-box" />
      </div>
      <div class="stat-aside animate-card" style="animation-delay:300ms">
        <div class="aside-title">计划状态分布</div>
        <div v-for="s in campaignStatus" :key="s.label" class="status-row">
          <div class="sr-left"><span class="sr-dot" :style="{ background: s.color }" />{{ s.label }}</div>
          <div class="sr-right">
            <div class="sr-bar-bg"><div class="sr-bar" :style="{ width: s.pct + '%', background: s.color }"/></div>
            <span class="sr-num">{{ s.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom row -->
    <div class="bottom-row">
      <div class="recent-card animate-card" style="animation-delay:360ms">
        <div class="card-head"><span class="card-title">最近推广计划</span><router-link to="/dashboard/campaigns" class="see-all">查看全部</router-link></div>
        <div v-for="c in recentCampaigns" :key="c.id" class="rc-item">
          <div class="rc-left"><div class="rc-name">{{ c.keyword }}</div><div class="rc-app">{{ c.channelName }}</div></div>
          <div class="rc-mid">
            <span class="rc-budget">{{ fmtFen(c.dailyBudget ?? 0) }}/日</span>
          </div>
          <span :class="['badge', statusClass(c.status)]"><span class="badge-dot"/>{{ planStatusLabel(c.status) }}</span>
        </div>
      </div>
      <div class="recent-card animate-card" style="animation-delay:420ms">
        <div class="card-head"><span class="card-title">最新回传日志</span><router-link to="/dashboard/callbacks" class="see-all">查看全部</router-link></div>
        <div v-for="l in recentLogs" :key="l.id" class="log-item">
          <span :class="['badge', l.status === 'success' ? 'badge-success' : l.status === 'failed' ? 'badge-error' : 'badge-warning']"><span class="badge-dot"/>{{ l.status === 'success' ? '成功' : l.status === 'failed' ? '失败' : '等待' }}</span>
          <span class="log-event">{{ l.event }}</span>
          <span class="log-kw">{{ l.keyword }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { metricsApi } from '@/api/metrics'
import { plansApi } from '@/api/plans'
import { compositionsApi } from '@/api/compositions'
import { fmtFen, fmtPct, fmtNum, planStatusLabel } from '@/utils/format'
import type { Plan, Composition, OverviewResp, TrendPoint } from '@/types/api'

const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
const today = computed(() => new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric', weekday:'long' }))

const overview = ref<OverviewResp | null>(null)
const trendPoints = ref<TrendPoint[]>([])
const plans = ref<Plan[]>([])
const compositions = ref<Composition[]>([])
const loading = ref(true)

const kpis = computed(() => {
  const o = overview.value
  if (!o) return []
  return [
    { label: '总曝光量', value: fmtNum(o.totalImpressions), change: '—', up: true, icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`, bg: 'rgba(99,102,241,0.15)' },
    { label: '总点击量', value: fmtNum(o.totalClicks), change: 'CTR ' + fmtPct(o.ctr), up: true, icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>`, bg: 'rgba(16,185,129,0.15)' },
    { label: '总转化数', value: fmtNum(o.totalConversions), change: 'CVR ' + fmtPct(o.cvr), up: true, icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`, bg: 'rgba(245,158,11,0.15)' },
    { label: '总消耗', value: fmtFen(o.totalSpend), change: 'CPC ' + fmtFen(o.cpc), up: false, icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`, bg: 'rgba(239,68,68,0.15)' },
  ]
})

const campaignStatus = computed(() => {
  const active = plans.value.filter(p => p.status === 'active').length
  const paused = plans.value.filter(p => p.status === 'paused').length
  const ended  = plans.value.filter(p => p.status === 'ended').length
  const total  = plans.value.length || 1
  return [
    { label: '投放中', count: active, pct: Math.round(active / total * 100), color: '#10b981' },
    { label: '暂停',   count: paused, pct: Math.round(paused / total * 100), color: '#f59e0b' },
    { label: '其他',   count: ended,  pct: Math.round(ended  / total * 100), color: '#64748b' },
  ].filter(s => s.count > 0)
})

const recentCampaigns = computed(() => plans.value.slice(0, 3))

const recentLogs = computed(() => compositions.value.slice(0, 5).map(c => ({
  id: c.id,
  status: c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'failed' : 'pending',
  event: ({ pending:'等待分配', accepted:'已接受', submitted:'已提交', approved:'审核通过', rejected:'审核拒绝' } as Record<string, string>)[c.status] ?? c.status,
  keyword: c.keyword,
})))

const statusClass = (s: string) => ({ active: 'badge-success', paused: 'badge-warning', ended: 'badge-default', draft: 'badge-default' })[s] ?? 'badge-default'

function initChart() {
  if (!chartEl.value || !trendPoints.value.length) return
  chart = echarts.init(chartEl.value)
  const pts = trendPoints.value
  chart.setOption({
    backgroundColor: 'transparent',
    grid: { top: 16, right: 16, bottom: 24, left: 48 },
    tooltip: { trigger: 'axis', backgroundColor: '#1c1e27', borderColor: 'rgba(248,250,252,0.08)', textStyle: { color: '#f1f5f9' } },
    xAxis: { type: 'category', data: pts.map(p => p.date.slice(5)), axisLine: { lineStyle: { color: 'rgba(248,250,252,0.08)' } }, axisLabel: { color: '#64748b', fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(248,250,252,0.05)' } } },
    series: [
      { name: '曝光', type: 'line', smooth: true, data: pts.map(p => p.impressions), lineStyle: { color: '#6366f1', width: 2.5 }, symbol: 'none', areaStyle: { color: { type: 'linear', x:0,y:0,x2:0,y2:1, colorStops: [{ offset:0, color:'rgba(99,102,241,0.18)'}, {offset:1, color:'rgba(99,102,241,0)'}] } } },
      { name: '点击',  type: 'line', smooth: true, data: pts.map(p => p.clicks),      lineStyle: { color: '#10b981', width: 2 }, symbol: 'none', areaStyle: { color: { type:'linear', x:0,y:0,x2:0,y2:1, colorStops: [{offset:0,color:'rgba(16,185,129,0.12)'},{offset:1,color:'rgba(16,185,129,0)'}] } } },
      { name: '转化',  type: 'line', smooth: true, data: pts.map(p => p.conversions), lineStyle: { color: '#f59e0b', width: 2 }, symbol: 'none' },
    ],
  })
  window.addEventListener('resize', () => chart?.resize())
}

onMounted(async () => {
  try {
    const end   = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
    const [ov, trend, planList, compList] = await Promise.all([
      metricsApi.overview(),
      metricsApi.trend({ from: start, to: end }),
      plansApi.list({ page: 1, pageSize: 20 }),
      compositionsApi.list({ page: 1, pageSize: 5 }),
    ])
    overview.value    = ov
    trendPoints.value = trend
    plans.value       = planList.list
    compositions.value = compList.list
  } catch (_) { /* show empty state */ } finally {
    loading.value = false
    initChart()
  }
})
onUnmounted(() => { chart?.dispose() })
</script>

<style scoped>
.overview-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.pg-actions { display: flex; gap: 8px; align-items: center; }
.btn-outline-sm { padding: 7px 14px; border: 1px solid var(--color-border-hover); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-text-secondary); transition: all var(--transition-fast); }
.btn-outline-sm:hover { border-color: var(--color-accent); color: var(--color-accent); }
.btn-accent-sm { padding: 7px 14px; background: var(--color-accent); border-radius: var(--radius-md); font-size: 12.5px; font-weight: 600; color: white; transition: all var(--transition-fast); }
.btn-accent-sm:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); }
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
.kpi-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 18px; transition: border-color var(--transition-fast); }
.kpi-card:hover { border-color: var(--color-border-hover); }
.kpi-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.kpi-label { font-size: 12px; color: var(--color-text-tertiary); font-weight: 500; }
.kpi-icon { width: 32px; height: 32px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; }
.kpi-value { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 6px; }
.kpi-change { font-size: 11.5px; font-weight: 500; }
.kpi-change.up { color: var(--color-success); }
.kpi-change.down { color: var(--color-error); }
.chart-row { display: grid; grid-template-columns: 1fr 260px; gap: 14px; margin-bottom: 20px; }
.chart-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.card-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.legend-row { display: flex; align-items: center; gap: 12px; font-size: 11.5px; color: var(--color-text-tertiary); }
.leg-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.echart-box { height: 200px; }
.stat-aside { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; }
.aside-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 18px; }
.status-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.sr-left { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--color-text-secondary); min-width: 56px; }
.sr-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.sr-right { display: flex; align-items: center; gap: 8px; flex: 1; }
.sr-bar-bg { flex: 1; height: 5px; background: var(--color-bg-active); border-radius: 99px; overflow: hidden; }
.sr-bar { height: 100%; border-radius: 99px; transition: width 0.6s; }
.sr-num { font-size: 12px; font-weight: 600; color: var(--color-text-tertiary); min-width: 16px; text-align: right; }
.bottom-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.recent-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; }
.see-all { font-size: 11.5px; color: var(--color-accent); transition: opacity var(--transition-fast); }
.see-all:hover { opacity: 0.75; }
.rc-item { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--color-border); }
.rc-item:last-child { border-bottom: none; }
.rc-left { min-width: 120px; }
.rc-name { font-size: 12.5px; font-weight: 500; color: var(--color-text-primary); margin-bottom: 2px; }
.rc-app { font-size: 11px; color: var(--color-text-disabled); }
.rc-mid { display: flex; align-items: center; gap: 7px; flex: 1; }
.rc-bar-bg { flex: 1; height: 4px; background: var(--color-bg-active); border-radius: 99px; overflow: hidden; }
.rc-bar { height: 100%; background: var(--gradient-accent); border-radius: 99px; }
.rc-budget { font-size: 11.5px; color: var(--color-text-tertiary); font-family: var(--font-mono); }
.log-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--color-border); font-size: 12px; }
.log-item:last-child { border-bottom: none; }
.log-event { color: var(--color-text-secondary); font-weight: 500; min-width: 80px; }
.log-kw { color: var(--color-text-tertiary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-lat { color: var(--color-text-disabled); font-family: var(--font-mono); font-size: 11px; min-width: 48px; text-align: right; }
</style>
