<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { MetricsOverview, Plan, TrendPoint } from '@zhihu-koc/shared-contracts'
import { RouteTrace, LineChart } from '@zhihu-koc/shared-components'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const overview = ref<MetricsOverview | null>(null)
const trend = ref<TrendPoint[]>([])
const recentPlans = ref<Plan[]>([])
const loading = ref(true)
const error = ref('')

const fmt = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })

const activePlans = computed(() => recentPlans.value.filter((p) => p.status === 'active'))
const pendingPlans = computed(() => recentPlans.value.filter((p) => p.status === 'pending'))
const todayLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

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
    <!-- 页首：编号 + 决策导向标题 + 路线刻度 -->
    <header class="page-header">
      <div>
        <p class="section-index">01 / 数据看板</p>
        <h1>{{ pendingPlans.length ? `先处理等待审核的 ${pendingPlans.length} 条计划。` : '先看清增长正在往哪里走。' }}</h1>
        <p>{{ todayLabel }}。OPC 已整理好本周的投放线索与待处理事项。</p>
        <RouteTrace code="ROUTE / 01" label="指标 → 计划 → 行动" style="margin-top: 20px;" />
      </div>
      <router-link to="/plans" class="ghost-aurora">全部计划 →</router-link>
    </header>

    <!-- 指标带：1px 分隔线，无卡片 -->
    <section v-if="overview" v-reveal class="metric-band">
      <div class="metric-cell">
        <p>曝光</p>
        <strong>{{ f(overview.totalImpressions) }}</strong>
        <small>本期累计</small>
      </div>
      <div class="metric-cell">
        <p>点击</p>
        <strong>{{ f(overview.totalClicks) }}</strong>
        <small>点击率 {{ pct(overview.totalClicks, overview.totalImpressions) }}%</small>
      </div>
      <div class="metric-cell">
        <p>转化</p>
        <strong>{{ f(overview.totalConversions) }}</strong>
        <small>转化率 {{ pct(overview.totalConversions, overview.totalClicks) }}%</small>
      </div>
      <div class="metric-cell">
        <p>消耗</p>
        <strong>{{ fm(overview.totalSpend) }}</strong>
        <small>本期累计</small>
      </div>
    </section>

    <!-- 主工作区：队列 + 右侧运行摘要 -->
    <section v-reveal="80" class="workspace-grid">
      <div class="min-w-0">
        <p class="section-index">02 / 计划队列</p>
        <h2 class="workspace-title">接下来要推进的计划</h2>
        <div v-if="recentPlans.length" class="table-list queue-list">
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
            <span :class="['status-badge', plan.status]">{{ { pending: '待审核', active: '投放中', paused: '已暂停', draft: '草稿', ended: '已结束', rejected: '已拒绝' }[plan.status] }}</span>
          </div>
        </div>
        <div v-else class="empty-panel">
          <span>目前还没有推广计划。</span>
        </div>

        <!-- 一周投放信号 -->
        <div style="margin-top: 40px;">
          <p class="section-index quiet">03 / 一周信号</p>
          <h2 class="workspace-title">投放数据按天沉淀</h2>
          <LineChart
            v-if="trend.length"
            :labels="trend.map(p => p.date.slice(5))"
            :series="[
              { label: '曝光', points: trend.map(p => p.impressions) },
              { label: '点击', color: '#5d7668', points: trend.map(p => p.clicks) },
              { label: '转化', color: '#b98a2f', points: trend.map(p => p.conversions) },
            ]"
          />
          <div v-else class="empty-panel">
            <span>NO SIGNAL YET</span>
            <strong>第一条计划，会从这里留下数据痕迹。</strong>
          </div>
        </div>
      </div>

      <!-- 右栏：运行摘要 -->
      <aside class="workspace-rail">
        <p class="section-index quiet">04 / 运行摘要</p>
        <h2 class="workspace-title" style="font-size: 22px;">{{ pendingPlans.length ? '有待处理事项' : '稳定，但需留意' }}</h2>
        <div class="rail-lines">
          <div class="rail-line">
            <span><i class="dot" :class="{ signal: pendingPlans.length > 0 }" />待审核计划</span>
            <b>{{ pendingPlans.length ? `${pendingPlans.length} 条待处理` : '无' }}</b>
          </div>
          <div class="rail-line">
            <span><i class="dot" />活跃计划</span>
            <b>{{ activePlans.length }} / {{ recentPlans.length }} 正常</b>
          </div>
          <div class="rail-line">
            <span><i class="dot" />数据同步</span>
            <b>{{ trend.length ? '已同步' : '等待数据' }}</b>
          </div>
        </div>
        <div class="rail-note">
          <p>容量注记 / {{ new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) }}</p>
          <span>{{ recentPlans.length ? '账户状态稳定，继续关注转化效率。' : '从一条明确的计划开始。' }}</span>
        </div>
      </aside>
    </section>

    <!-- 加载/错误状态 -->
    <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>
  </div>
</template>
