<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import type { TrendPoint } from '@zhihu-koc/shared-contracts'
import { LineChart } from '@zhihu-koc/shared-components'
import { useAuthStore, apis } from '../stores/auth'

const trend = ref<TrendPoint[]>([])
const loading = ref(true)
const error = ref('')
const dateFrom = ref('')
const dateTo = ref('')

const fmt = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })

function dateOffset(days: number) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }

const maxImpressions = computed(() => Math.max(...trend.value.map(t => t.impressions), 1))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params: any = {}
    if (dateFrom.value) params.from = dateFrom.value
    if (dateTo.value) params.to = dateTo.value
    trend.value = await apis.metrics.trend(params)
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header analytics-header">
      <div>
        <p class="eyebrow">ANALYTICS / DATA</p>
        <h1>数据分析</h1>
      </div>
      <div class="page-actions">
        <div class="date-filter">
          <input v-model="dateFrom" type="date" placeholder="开始日期" />
          <span>至</span>
          <input v-model="dateTo" type="date" placeholder="结束日期" />
          <button class="row-action" @click="load">查询</button>
        </div>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>

    <template v-else>
      <!-- 趋势图表（用 CSS 柱状图模拟） -->
      <article class="panel chart-panel" style="min-height: 360px;">
        <header class="panel-title">
          <div>
            <p>TRAFFIC TREND</p>
            <h2>流量转化趋势</h2>
          </div>
        </header>
        <LineChart
          v-if="trend.length"
          :labels="trend.map(p => p.date.slice(5))"
          :series="[
            { label: '曝光', points: trend.map(p => p.impressions) },
            { label: '点击', color: '#5d7668', points: trend.map(p => p.clicks) },
            { label: '转化', color: '#b98a2f', points: trend.map(p => p.conversions) },
          ]"
        />
      </article>

      <!-- 明细表格 -->
      <article class="panel data-panel" style="min-height: 200px;">
        <div class="list-toolbar">
          <span class="toolbar-title">数据明细</span>
          <span class="toolbar-count">{{ trend.length }} 天</span>
        </div>
        <div v-if="!trend.length" class="empty-panel"><span>暂无数据。请调整日期范围后重试。</span></div>
        <div v-else class="responsive-table">
          <table>
            <thead><tr><th>日期</th><th>曝光</th><th>点击</th><th>转化</th><th>消耗</th><th>收益</th></tr></thead>
            <tbody>
              <tr v-for="point in trend" :key="point.date">
                <td style="font-family: var(--font-mono); font-size: 12px;">{{ point.date }}</td>
                <td><strong>{{ fmt.format(point.impressions) }}</strong></td>
                <td><strong>{{ fmt.format(point.clicks) }}</strong></td>
                <td><strong>{{ fmt.format(point.conversions) }}</strong></td>
                <td>{{ money.format(point.spend / 100) }}</td>
                <td style="color: var(--forest);"><strong>{{ money.format(point.earnings / 100) }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </template>
  </div>
</template>
