<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { MetricsOverview, TrendPoint } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'
import { isApiError } from '@zhihu-koc/shared-services'
import { StatCard } from '@zhihu-koc/shared-components'
import { formatCount, formatCurrency, formatRate } from '@zhihu-koc/shared-utils'
import { apis } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const overview = ref<MetricsOverview | null>(null)
const trend = ref<TrendPoint[]>([])
const errorMessage = ref('')

onMounted(async () => {
  try {
    ;[overview.value, trend.value] = await Promise.all([apis.metrics.overview(), apis.metrics.trend()])
  } catch (error) {
    errorMessage.value = isApiError(error) ? error.message : String(error)
  }
})
</script>

<template>
  <section>
    <h1 class="page-title">{{ t('nav.overview') }}</h1>
    <p v-if="errorMessage" class="page-error" role="alert">{{ errorMessage }}</p>

    <div v-if="overview" class="overview-grid">
      <StatCard :label="t('metrics.impressions')" :value="formatCount(overview.totalImpressions)" />
      <StatCard :label="t('metrics.clicks')" :value="formatCount(overview.totalClicks)" :hint="`${t('metrics.ctr')} ${formatRate(overview.ctr)}`" />
      <StatCard :label="t('metrics.conversions')" :value="formatCount(overview.totalConversions)" :hint="`${t('metrics.cvr')} ${formatRate(overview.cvr)}`" />
      <StatCard :label="t('metrics.earningsTotal')" :value="formatCurrency(overview.totalEarnings)" />
    </div>

    <section class="panel">
      <h2>{{ t('metrics.trend') }}</h2>
      <p v-if="!trend.length" class="page-placeholder">{{ t('common.empty') }}</p>
      <table v-else class="panel__table">
        <thead>
          <tr>
            <th>{{ t('metrics.date') }}</th>
            <th>{{ t('metrics.impressions') }}</th>
            <th>{{ t('metrics.clicks') }}</th>
            <th>{{ t('metrics.conversions') }}</th>
            <th>{{ t('metrics.earningsTotal') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in trend" :key="point.date">
            <td>{{ point.date }}</td>
            <td>{{ formatCount(point.impressions) }}</td>
            <td>{{ formatCount(point.clicks) }}</td>
            <td>{{ formatCount(point.conversions) }}</td>
            <td>{{ formatCurrency(point.earnings) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped>
.page-title {
  margin: 0 0 18px;
  font-size: 26px;
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: -0.04em;
  color: var(--ink);
}
.page-error {
  margin: 0 0 16px;
  padding: 12px;
  background: #f1ded9;
  color: #964639;
  font-size: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--clay);
}
.page-placeholder {
  color: var(--ink-soft);
  font-size: 12px;
}
.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}
.panel {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--white);
  box-shadow: var(--shadow);
}
.panel h2 {
  margin: 0 0 16px;
  font-size: 21px;
  font-family: var(--font-display);
  font-weight: 600;
  color: var(--ink);
}
.panel__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  min-width: 660px;
}
.panel__table th {
  padding: 13px 22px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  text-align: left;
  font-size: 11px;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
  color: var(--ink-soft);
}
.panel__table td {
  padding: 15px 22px;
  border-bottom: 1px solid var(--paper-deep);
  text-align: left;
  color: var(--ink);
}
</style>
