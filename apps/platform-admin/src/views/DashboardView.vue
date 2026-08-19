<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { MetricsOverview, Plan, TrendPoint } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const overview = ref<MetricsOverview | null>(null)
const trend = ref<TrendPoint[]>([])
const recentPlans = ref<Plan[]>([])
const loading = ref(true)
const error = ref('')

const fmt = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })

function dateOffset(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

onMounted(async () => {
  try {
    const [ov, tr, pl] = await Promise.all([
      apis.metrics.overview(),
      apis.metrics.trend({ from: dateOffset(-6), to: dateOffset(0) }),
      apis.plans.list({ page: 1, pageSize: 5 }),
    ])
    overview.value = ov
    trend.value = tr
    recentPlans.value = pl.list
  } catch (e: any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
})

function f(n: number) { return fmt.format(n || 0) }
function fm(n: number) { return money.format((n || 0) / 100) }
function pct(a: number, b: number) { return b ? ((a / b) * 100).toFixed(2) : '0.00' }
</script>

<template>
  <div class="page-stack">
    <!-- 周报引言 -->
    <section class="dashboard-hero">
      <div class="hero-copy">
        <p class="eyebrow">WEEKLY / OPERATION NOTE</p>
        <h1>今天，先看清<br /><em>增长正在往哪里走。</em></h1>
        <p>{{ new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) }}。OPC 已整理好本周的投放线索与待处理事项。</p>
      </div>
      <div class="health-card">
        <span>活跃计划</span>
        <strong>{{ recentPlans.filter(p => p.status === 'active').length }}</strong>
        <b>个<small></small></b>
        <div class="health-track"><i /></div>
        <footer>
          <span><em /> 系统运行正常</span>
        </footer>
      </div>
    </section>

    <!-- 聚焦条 -->
    <section class="focus-strip" style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--white);">
      <div style="display: flex; align-items: baseline; gap: 6px;">
        <span style="font-size: 11px; color: var(--ink-soft);">正在投放</span>
        <strong style="font-family: var(--font-display); font-size: 22px; color: var(--forest);">{{ recentPlans.filter(p => p.status === 'active').length }}</strong>
        <small style="font-size: 11px; color: var(--ink-soft);">个计划</small>
      </div>
      <p style="flex: 1; margin: 0; font-size: 12px; color: var(--ink-soft);">
        账户状态稳定。<b style="color: var(--ink);">{{ recentPlans.length ? '继续关注转化效率。' : '从一条明确的计划开始。' }}</b>
      </p>
    </section>

    <!-- 指标卡片 -->
    <section class="metric-grid" v-if="overview">
      <article class="metric-card">
        <div>
          <span>曝光</span>
          <i class="metric-icon cyan">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          </i>
        </div>
        <strong>{{ f(overview.totalImpressions) }}</strong>
        <p>本期累计</p>
      </article>
      <article class="metric-card">
        <div>
          <span>点击</span>
          <i class="metric-icon indigo">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
          </i>
        </div>
        <strong>{{ f(overview.totalClicks) }}</strong>
        <p>点击率 <b>{{ pct(overview.totalClicks, overview.totalImpressions) }}%</b></p>
      </article>
      <article class="metric-card">
        <div>
          <span>转化</span>
          <i class="metric-icon mint">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          </i>
        </div>
        <strong>{{ f(overview.totalConversions) }}</strong>
        <p>转化率 <b>{{ pct(overview.totalConversions, overview.totalClicks) }}%</b></p>
      </article>
      <article class="metric-card">
        <div>
          <span>消耗</span>
          <i class="metric-icon violet">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
          </i>
        </div>
        <strong>{{ fm(overview.totalSpend) }}</strong>
        <p>本期累计</p>
      </article>
    </section>

    <!-- 趋势图 + 近期计划 -->
    <section class="activity-grid">
      <article class="panel activity-panel">
        <header class="panel-title">
          <div>
            <p>SEVEN-DAY SIGNAL</p>
            <h2>一周投放信号</h2>
          </div>
          <span style="font-size: 10px; color: var(--moss);">{{ trend.length ? '已同步' : '等待第一条数据' }}</span>
        </header>
        <div v-if="trend.length" style="margin-top: 16px;">
          <div v-for="point in trend" :key="point.date" style="display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--paper-deep);">
            <span style="font-family: var(--font-mono); font-size: 10px; color: var(--ink-soft); width: 60px;">{{ point.date.slice(5) }}</span>
            <div style="flex: 1; height: 4px; background: var(--paper-deep); border-radius: 2px;">
              <div :style="{ width: `${Math.min(100, (point.impressions / (overview?.totalImpressions || 1)) * 100 * 7)}%`, height: '100%', background: 'var(--forest)', borderRadius: '2px' }" />
            </div>
            <span style="font-family: var(--font-mono); font-size: 10px; color: var(--ink); width: 50px; text-align: right;">{{ f(point.impressions) }}</span>
          </div>
        </div>
        <div v-else class="empty-panel" style="margin-top: 16px;">
          <span>NO SIGNAL YET</span>
          <strong>第一条计划，会从这里留下数据痕迹。</strong>
          <p>创建并启动计划后，曝光、点击与转化趋势会按天沉淀。</p>
        </div>
      </article>

      <article class="panel activity-panel">
        <header class="panel-title">
          <div>
            <p>RECENT CAMPAIGNS</p>
            <h2>近期推广计划</h2>
          </div>
          <router-link to="/plans" style="font-size: 11px; font-weight: 800; color: var(--forest);">全部计划 →</router-link>
        </header>
        <div v-if="recentPlans.length" class="table-list">
          <div v-for="(plan, index) in recentPlans" :key="plan.id" class="campaign-row">
            <span class="list-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <div>
              <strong>{{ plan.keyword }}</strong>
              <small>{{ plan.channelName }}</small>
            </div>
            <div class="budget">
              <small>日预算</small>
              <strong>{{ plan.dailyBudget != null ? fm(plan.dailyBudget) : '—' }}</strong>
            </div>
            <span :class="['status-badge', plan.status]">{{ { active: '投放中', paused: '已暂停', draft: '草稿', ended: '已结束', rejected: '已拒绝' }[plan.status] }}</span>
          </div>
        </div>
        <div v-else class="empty-panel" style="margin-top: 16px;">
          <span>目前还没有推广计划。</span>
        </div>
      </article>
    </section>

    <!-- 加载/错误状态 -->
    <div v-if="loading" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>
  </div>
</template>
