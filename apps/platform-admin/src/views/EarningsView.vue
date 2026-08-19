<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { EarningRecord, EarningsSummary, Withdrawal } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator, type MessageKey } from '@zhihu-koc/shared-i18n'
import { isApiError, type ApiError } from '@zhihu-koc/shared-services'
import { FinanceGateBanner, StatCard } from '@zhihu-koc/shared-components'
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
  margin: 0 0 12px;
  font-size: 18px;
}
.page-error {
  margin: 0 0 12px;
  color: #cf1322;
  font-size: 13px;
}
.page-placeholder {
  color: rgba(0, 0, 0, 0.45);
}
.earnings-banner {
  margin-bottom: 16px;
}
.earnings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.panel {
  padding: 16px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fff;
  margin-bottom: 16px;
}
.panel h2 {
  margin: 0 0 12px;
  font-size: 15px;
}
.panel__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.panel__table th,
.panel__table td {
  padding: 8px;
  border-bottom: 1px solid #f5f5f5;
  text-align: left;
}
.withdraw-form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.withdraw-form input,
.withdraw-form select {
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.withdraw-form button {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.withdraw-remark {
  display: block;
  color: rgba(0, 0, 0, 0.45);
}
.withdraw-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.withdraw-actions input {
  width: 120px;
  padding: 4px 8px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 12px;
}
.withdraw-actions button {
  padding: 4px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}
.withdraw-actions__danger {
  border-color: #ffa39e !important;
  color: #cf1322;
}
</style>
