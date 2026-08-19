<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Plan, PlanStatus } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator, type MessageKey } from '@zhihu-koc/shared-i18n'
import { isApiError } from '@zhihu-koc/shared-services'
import { formatCurrency } from '@zhihu-koc/shared-utils'
import { apis } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const plans = ref<Plan[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const statusFilter = ref<PlanStatus | ''>('')
const errorMessage = ref('')
const loading = ref(false)

const STATUS_OPTIONS: PlanStatus[] = ['pending', 'active', 'paused', 'rejected', 'ended']

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await apis.plans.list({
      page: page.value,
      pageSize,
      status: statusFilter.value || undefined,
    })
    plans.value = data.list
    total.value = data.total
  } catch (error) {
    errorMessage.value = isApiError(error) ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function retry(id: string) {
  errorMessage.value = ''
  try {
    await apis.plans.retry(id)
    await load()
  } catch (error) {
    errorMessage.value = isApiError(error) ? error.message : String(error)
  }
}

function changeStatus(value: string) {
  statusFilter.value = value as PlanStatus | ''
  page.value = 1
  void load()
}

onMounted(load)
</script>

<template>
  <section>
    <h1 class="page-title">{{ t('nav.plans') }}</h1>
    <p v-if="errorMessage" class="page-error" role="alert">{{ errorMessage }}</p>

    <div class="plans-toolbar">
      <select :value="statusFilter" data-testid="plan-status-filter" @change="changeStatus(($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('common.all') }}</option>
        <option v-for="status in STATUS_OPTIONS" :key="status" :value="status">
          {{ t(`plans.statusMap.${status}` as MessageKey) }}
        </option>
      </select>
      <span class="plans-total">{{ total }}</span>
    </div>

    <p v-if="!loading && !plans.length" class="page-placeholder">{{ t('plans.empty') }}</p>
    <table v-else class="plans-table">
      <thead>
        <tr>
          <th>{{ t('plans.keyword') }}</th>
          <th>{{ t('plans.channel') }}</th>
          <th>{{ t('plans.owner') }}</th>
          <th>{{ t('plans.dailyBudget') }}</th>
          <th>{{ t('plans.status') }}</th>
          <th>{{ t('plans.syncStatus') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plan in plans" :key="plan.id">
          <td>
            <a :href="plan.landingUrl" target="_blank" rel="noopener">{{ plan.keyword }}</a>
          </td>
          <td>{{ plan.channelName }}</td>
          <td>{{ plan.ownerName }}</td>
          <td>{{ plan.dailyBudget === null ? '—' : formatCurrency(plan.dailyBudget) }}</td>
          <td>{{ t(`plans.statusMap.${plan.status}` as MessageKey) }}</td>
          <td>
            {{ t(`plans.syncMap.${plan.syncStatus}` as MessageKey) }}
            <small v-if="plan.syncError" class="plans-sync-error">{{ plan.syncError }}</small>
          </td>
          <td>
            <button v-if="plan.syncStatus === 'failed'" type="button" class="plans-retry" @click="retry(plan.id)">
              {{ t('plans.retry') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
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
.plans-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.plans-toolbar select {
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.plans-total {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}
.plans-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  background: #fff;
  border: 1px solid #f0f0f0;
}
.plans-table th,
.plans-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f5f5f5;
  text-align: left;
}
.plans-sync-error {
  display: block;
  color: #cf1322;
}
.plans-retry {
  padding: 4px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}
</style>
