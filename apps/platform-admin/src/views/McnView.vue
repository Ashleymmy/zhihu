<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { McnAccount } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator, type MessageKey } from '@zhihu-koc/shared-i18n'
import { isApiError } from '@zhihu-koc/shared-services'
import { formatDate } from '@zhihu-koc/shared-utils'
import { apis } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const accounts = ref<McnAccount[]>([])
const errorMessage = ref('')
const accountKey = ref('')
const accountName = ref('')
const submitting = ref(false)

async function load() {
  try {
    accounts.value = await apis.mcn.list()
  } catch (error) {
    errorMessage.value = isApiError(error) ? error.message : String(error)
  }
}

async function create() {
  if (!accountKey.value.trim() || !accountName.value.trim() || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await apis.mcn.create({ accountKey: accountKey.value.trim(), accountName: accountName.value.trim() })
    accountKey.value = ''
    accountName.value = ''
    await load()
  } catch (error) {
    errorMessage.value = isApiError(error) ? error.message : String(error)
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h1 class="page-title">{{ t('nav.mcn') }}</h1>
    <p v-if="errorMessage" class="mcn__error" role="alert">{{ errorMessage }}</p>

    <form class="mcn__form" @submit.prevent="create">
      <input v-model="accountKey" :placeholder="t('mcn.accountKey')" data-testid="mcn-key" />
      <input v-model="accountName" :placeholder="t('mcn.accountName')" data-testid="mcn-name" />
      <button type="submit" :disabled="submitting || !accountKey.trim() || !accountName.trim()">
        {{ t('mcn.create') }}
      </button>
    </form>

    <p v-if="!accounts.length" class="page-placeholder">{{ t('mcn.empty') }}</p>
    <table v-else class="mcn__table">
      <thead>
        <tr>
          <th>{{ t('mcn.accountKey') }}</th>
          <th>{{ t('mcn.accountName') }}</th>
          <th>{{ t('projects.createdAt') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="account in accounts" :key="account.id">
          <td><code>{{ account.accountKey }}</code></td>
          <td>{{ account.accountName }}</td>
          <td>{{ formatDate(account.createdAt) }}</td>
          <td>{{ t(`mcn.status.${account.status}` as MessageKey) }}</td>
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
.page-placeholder {
  color: rgba(0, 0, 0, 0.45);
}
.mcn__error {
  margin: 0 0 12px;
  color: #cf1322;
  font-size: 13px;
}
.mcn__form {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.mcn__form input {
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.mcn__form button {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.mcn__form button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mcn__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}
.mcn__table th,
.mcn__table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f5f5f5;
  text-align: left;
}
</style>
