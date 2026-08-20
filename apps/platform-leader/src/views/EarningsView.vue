<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EarningRecord, EarningsSummary, Withdrawal } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator, type MessageKey } from '@zhihu-koc/shared-i18n'
import { isApiError, type ApiError } from '@zhihu-koc/shared-services'
import { FinanceGateBanner, StatCard, DonutChart, LineChart } from '@zhihu-koc/shared-components'
import { formatCurrency, formatDate } from '@zhihu-koc/shared-utils'
import { APP_ROLE } from '../app-config'
import { apis } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const summary = ref<EarningsSummary | null>(null)
const earnings = ref<EarningRecord[]>([])
const withdrawals = ref<Withdrawal[]>([])
const errorMessage = ref('')
const financeGate = ref<ApiError | null>(null)

const canApprove = APP_ROLE === 'admin'
const canApply = APP_ROLE !== 'admin'

/* ===== 图表数据 ===== */
const statusSlices = computed(() => {
  if (!summary.value) return []
  return [
    { label: '待确认', value: summary.value.pending, color: '#b98a2f' },
    { label: '已确认', value: summary.value.confirmed, color: '#e66b3a' },
    { label: '已支付', value: summary.value.paid, color: '#5d7668' },
  ]
})

const dailySeries = computed(() => {
  const byDate = new Map<string, number>()
  for (const e of earnings.value) {
    const day = ((e as any).settleDate ?? e.date ?? '').slice(5, 10)
    if (!day) continue
    byDate.set(day, (byDate.get(day) ?? 0) + Number(e.amount) / 100)
  }
  const days = [...byDate.keys()].sort()
  return { labels: days, points: days.map((d) => byDate.get(d) ?? 0) }
})

const applyAmountYuan = ref('')
const applyMethod = ref<'alipay' | 'wechat'>('alipay')
const applyAccount = ref('')
const rejectRemark = ref('')

function captureError(error: unknown) {
  if (isApiError(error) && error.code === 50310) {
    // 财务链路 fail-closed：展示门禁横幅而非普通错误
    financeGate.value = error
    return
  }
  errorMessage.value = isApiError(error) ? error.message : String(error)
}

async function load() {
  try {
    ;[summary.value, earnings.value, withdrawals.value] = await Promise.all([
      apis.earnings.summary(),
      apis.earnings.list({ pageSize: 20 }).then((data) => data.list),
      apis.withdrawals.list({ pageSize: 20 }).then((data) => data.list),
    ])
  } catch (error) {
    captureError(error)
  }
}

async function apply() {
  const yuan = Number(applyAmountYuan.value)
  if (!Number.isFinite(yuan) || yuan <= 0 || !applyAccount.value.trim()) return
  errorMessage.value = ''
  financeGate.value = null
  try {
    await apis.withdrawals.apply({
      amount: Math.round(yuan * 100),
      payMethod: applyMethod.value,
      payAccount: applyAccount.value.trim(),
    })
    await load()
  } catch (error) {
    captureError(error)
  }
}

async function approve(id: string) {
  errorMessage.value = ''
  financeGate.value = null
  try {
    await apis.withdrawals.approve(id)
    await load()
  } catch (error) {
    captureError(error)
  }
}

async function reject(id: string) {
  if (!rejectRemark.value.trim()) return
  errorMessage.value = ''
  financeGate.value = null
  try {
    await apis.withdrawals.reject(id, rejectRemark.value.trim())
    rejectRemark.value = ''
    await load()
  } catch (error) {
    captureError(error)
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h1 class="page-title">{{ t('nav.earnings') }}</h1>
    <p v-if="errorMessage" class="page-error" role="alert">{{ errorMessage }}</p>

    <FinanceGateBanner
      v-if="financeGate"
      :title="t('finance.blocked')"
      :hint="t('finance.blockedHint')"
      :gates-label="t('finance.failedGates')"
      :failed-gates="financeGate.failedGates"
      class="earnings-banner"
    />

    <div v-if="summary" class="earnings-grid">
      <StatCard :label="t('earnings.summaryPending')" :value="formatCurrency(summary.pending)" />
      <StatCard :label="t('earnings.summaryConfirmed')" :value="formatCurrency(summary.confirmed)" />
      <StatCard :label="t('earnings.summaryPaid')" :value="formatCurrency(summary.paid)" />
      <StatCard :label="t('earnings.summaryTotal')" :value="formatCurrency(summary.total)" />
    </div>

    <section v-if="summary" class="panel">
      <h2>收益构成与趋势</h2>
      <div class="earnings-charts">
        <DonutChart :slices="statusSlices" center-label="总额(分)" />
        <div class="earnings-trend">
          <p class="chart-caption">按结算日期的收益分布（元）</p>
          <LineChart v-if="dailySeries.labels.length" :labels="dailySeries.labels" :series="[{ label: '收益', points: dailySeries.points }]" :height="180" />
          <p v-else class="page-placeholder">暂无收益记录</p>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>{{ t('nav.earnings') }}</h2>
      <p v-if="!earnings.length" class="page-placeholder">{{ t('earnings.empty') }}</p>
      <table v-else class="panel__table">
        <thead>
          <tr>
            <th>{{ t('metrics.date') }}</th>
            <th>{{ t('plans.keyword') }}</th>
            <th>{{ t('plans.channel') }}</th>
            <th>{{ t('plans.owner') }}</th>
            <th>{{ t('earnings.amount') }}</th>
            <th>{{ t('plans.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in earnings" :key="record.id">
            <td>{{ formatDate(record.date) }}</td>
            <td>{{ record.keyword }}</td>
            <td>{{ record.channelName }}</td>
            <td>{{ record.ownerName }}</td>
            <td>{{ formatCurrency(record.amount) }}</td>
            <td>{{ t(`earnings.statusMap.${record.status}` as MessageKey) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>{{ t('withdrawals.title') }}</h2>

      <form v-if="canApply" class="withdraw-form" @submit.prevent="apply">
        <input v-model="applyAmountYuan" :placeholder="t('withdrawals.amount')" data-testid="withdraw-amount" />
        <select v-model="applyMethod">
          <option value="alipay">{{ t('withdrawals.methodMap.alipay') }}</option>
          <option value="wechat">{{ t('withdrawals.methodMap.wechat') }}</option>
        </select>
        <input v-model="applyAccount" :placeholder="t('withdrawals.payAccount')" data-testid="withdraw-account" />
        <button type="submit" data-testid="withdraw-apply">{{ t('withdrawals.apply') }}</button>
      </form>

      <p v-if="!withdrawals.length" class="page-placeholder">{{ t('withdrawals.empty') }}</p>
      <table v-else class="panel__table">
        <thead>
          <tr>
            <th>{{ t('earnings.amount') }}</th>
            <th>{{ t('withdrawals.payMethod') }}</th>
            <th>{{ t('withdrawals.payAccount') }}</th>
            <th>{{ t('plans.status') }}</th>
            <th>{{ t('projects.createdAt') }}</th>
            <th v-if="canApprove"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in withdrawals" :key="item.id">
            <td>{{ formatCurrency(item.amount) }}</td>
            <td>{{ t(`withdrawals.methodMap.${item.payMethod}` as MessageKey) }}</td>
            <td>{{ item.payAccount }}</td>
            <td>
              {{ t(`withdrawals.statusMap.${item.status}` as MessageKey) }}
              <small v-if="item.remark" class="withdraw-remark">{{ item.remark }}</small>
            </td>
            <td>{{ formatDate(item.createdAt) }}</td>
            <td v-if="canApprove" class="withdraw-actions">
              <template v-if="item.status === 'pending'">
                <button type="button" data-testid="withdraw-approve" @click="approve(item.id)">
                  {{ t('withdrawals.approve') }}
                </button>
                <input v-model="rejectRemark" :placeholder="t('withdrawals.rejectRemark')" />
                <button type="button" class="withdraw-actions__danger" @click="reject(item.id)">
                  {{ t('withdrawals.reject') }}
                </button>
              </template>
            </td>
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
.earnings-banner {
  margin-bottom: 20px;
}
.earnings-charts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 28px;
  align-items: center;
}
.earnings-trend { min-width: 0; }
.chart-caption {
  margin: 0 0 10px;
  color: var(--ink-soft);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
}
@media (max-width: 900px) {
  .earnings-charts { grid-template-columns: 1fr; }
}
.earnings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}
.panel {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--white);
  margin-bottom: 20px;
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
  font-size: 11px;
  min-width: 660px;
}
.panel__table th {
  padding: 13px 22px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  text-align: left;
  font-size: 9px;
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
.withdraw-form {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.withdraw-form input,
.withdraw-form select {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 12px;
  background: var(--white);
  min-height: 38px;
  flex: 1;
  min-width: 140px;
}
.withdraw-form button {
  padding: 10px 18px;
  border: 1px solid var(--forest);
  border-radius: var(--radius);
  background: var(--forest);
  color: var(--white);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.16s ease;
  box-shadow: 2px 2px 0 #b8c2b7;
}
.withdraw-form button:hover {
  transform: translateY(-1px);
  box-shadow: 3px 3px 0 #b8c2b7;
}
.withdraw-form button:active {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0 #b8c2b7;
}
.withdraw-remark {
  display: block;
  margin-top: 4px;
  color: var(--ink-soft);
  font-size: 10px;
}
.withdraw-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.withdraw-actions input {
  width: 140px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 11px;
  background: var(--white);
}
.withdraw-actions button {
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--white);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.16s ease;
}
.withdraw-actions button:hover {
  border-color: var(--forest);
  color: var(--forest);
}
.withdraw-actions__danger {
  border-color: var(--clay) !important;
  color: var(--clay) !important;
}
.withdraw-actions__danger:hover {
  background: #f1ded9;
}
</style>
