<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EarningRecord, EarningsSummary } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator, type MessageKey } from '@zhihu-koc/shared-i18n'
import { isApiError, type ApiError } from '@zhihu-koc/shared-services'
import { FinanceGateBanner, StatCard, DonutChart, LineChart } from '@zhihu-koc/shared-components'
import { formatCurrency, formatDate } from '@zhihu-koc/shared-utils'
import { APP_ROLE } from '../app-config'
import { apis, http } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const summary = ref<EarningsSummary | null>(null)
const earnings = ref<EarningRecord[]>([])
const errorMessage = ref('')
const financeGate = ref<ApiError | null>(null)
const settling = ref(false)
const settleFrom = ref('')
const settleTo = ref('')
const showSettleDialog = ref(false)


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
    ;[summary.value, earnings.value] = await Promise.all([
      apis.earnings.summary(),
      apis.earnings.list({ pageSize: 20 }).then((data) => data.list),
    ])
  } catch (error) {
    captureError(error)
  }
}

function openSettleDialog() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  settleTo.value = yesterday.toISOString().slice(0, 10)
  settleFrom.value = settleTo.value
  showSettleDialog.value = true
}

async function triggerSettle() {
  if (!settleFrom.value || !settleTo.value || settling.value) return
  if (settleFrom.value > settleTo.value) {
    errorMessage.value = '开始日期不能晚于结束日期'
    return
  }
  settling.value = true
  errorMessage.value = ''
  try {
    const token = http.tokens.get()
    if (!token) throw new Error('未登录')
    const response = await fetch('/api/v1/admin-tools/settle-earnings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ from: settleFrom.value, to: settleTo.value }),
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || '结算失败')
    }
    showSettleDialog.value = false
    alert(`${settleFrom.value} ~ ${settleTo.value} 的收益结算任务已加入队列，请稍后刷新页面查看新记录`)
    await load()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '结算失败'
  } finally {
    settling.value = false
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
      <div class="section-header">
        <h2>{{ t('nav.earnings') }}</h2>
        <button class="btn-settle" @click="openSettleDialog" :disabled="settling">
          {{ settling ? '结算中...' : '手动结算' }}
        </button>
      </div>
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
      <p class="page-placeholder">提现申请与审批已迁移至「提现审批」页（二级审批：团长初审 → 管理员终审放款）。</p>
      <router-link to="/withdrawals" class="withdraw-link">前往提现审批 →</router-link>
    </section>

    <!-- 手动结算弹窗 -->
    <div v-if="showSettleDialog" class="modal-overlay" @click.self="showSettleDialog = false">
      <div class="modal-content">
        <h3>手动结算</h3>
        <p class="modal-hint">从知乎拉取的收益数据会按定价规则重新计算并生成待确认记录</p>
        <div class="form-field">
          <label>开始日期</label>
          <input type="date" v-model="settleFrom" :max="settleTo" />
        </div>
        <div class="form-field">
          <label>结束日期</label>
          <input type="date" v-model="settleTo" :max="new Date().toISOString().slice(0, 10)" />
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showSettleDialog = false" :disabled="settling">取消</button>
          <button class="btn-primary" @click="triggerSettle" :disabled="settling || !settleFrom || !settleTo">
            {{ settling ? '结算中...' : '确认结算' }}
          </button>
        </div>
      </div>
    </div>
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
  font-size: 12px;
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
  font-size: 13px;
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
  font-size: 12px;
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
  font-size: 13px;
  background: var(--white);
}
.withdraw-actions button {
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--white);
  font-size: 13px;
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
.withdraw-link { display: inline-block; margin-top: 8px; color: var(--clay-deep); font-size: 12px; font-weight: 600; }

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.section-header h2 {
  margin: 0;
}
.btn-settle {
  padding: 8px 16px;
  background: var(--ink);
  color: var(--paper);
  border: none;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-settle:hover:not(:disabled) {
  background: var(--forest-deep);
}
.btn-settle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: var(--white);
  padding: 24px;
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  max-width: 400px;
  width: 90%;
}
.modal-content h3 {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
}
.modal-hint {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--ink-soft);
  line-height: 1.5;
}
.form-field {
  margin-bottom: 20px;
}
.form-field label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
}
.form-field input[type="date"] {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--ink);
}
.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
.btn-primary, .btn-secondary {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary {
  background: var(--ink);
  color: var(--paper);
}
.btn-primary:hover:not(:disabled) {
  background: var(--forest-deep);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  background: var(--paper);
  color: var(--ink);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--paper-deep);
}
</style>
