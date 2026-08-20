<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { DbTableStat } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const tables = ref<DbTableStat[]>([])
const loading = ref(true)
const error = ref('')
const cleanupDays = ref(90)
const cleaning = ref(false)
const cleanupResult = ref('')

async function load() {
  loading.value = true
  try { tables.value = await apis.adminTools.dbStats() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function runCleanup() {
  if (!confirm(`确定清理 ${cleanupDays.value} 天前的操作日志？此操作不可恢复。`)) return
  cleaning.value = true
  cleanupResult.value = ''
  error.value = ''
  try {
    const r = await apis.adminTools.auditCleanup(cleanupDays.value)
    cleanupResult.value = `已清理 ${r.deleted} 条历史操作日志。`
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { cleaning.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/system" class="back-link">← 返回系统工具</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">03 / 数据库维护</p>
        <h1>数据库维护</h1>
        <p>表行数与体积概览，历史操作日志清理。</p>
      </div>
      <button class="row-action" @click="load">刷新</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>
    <div v-if="cleanupResult" style="padding: 12px 16px; border: 1px solid var(--moss); border-radius: var(--radius); background: #e6ebe7; font-size: 11px; color: var(--moss);">{{ cleanupResult }}</div>

    <section class="workspace-grid">
      <div class="min-w-0">
        <article class="panel data-panel" style="min-height: 300px;">
          <div class="list-toolbar">
            <span class="toolbar-title">表体积概览</span>
            <span class="toolbar-count">{{ tables.length }} 张表</span>
          </div>
          <div v-if="loading" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
          <div v-else class="responsive-table">
            <table>
              <thead><tr><th>表名</th><th>行数（估算）</th><th>体积 (MB)</th></tr></thead>
              <tbody>
                <tr v-for="t in tables" :key="t.tableName">
                  <td style="font-family: var(--font-mono); font-size: 11px;">{{ t.tableName }}</td>
                  <td style="font-family: var(--font-mono); font-size: 11px;">{{ t.tableRows.toLocaleString() }}</td>
                  <td style="font-family: var(--font-mono); font-size: 11px;">{{ t.dataMb }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <aside class="workspace-rail">
        <p class="section-index quiet">04 / 日志清理</p>
        <h2 class="workspace-title" style="font-size: 22px;">操作日志保留策略</h2>
        <p style="color: var(--ink-soft); font-size: 12px; line-height: 1.7; margin: 0 0 14px;">审计日志会随时间增长。可定期清理超过保留期的历史记录，保留最近的操作可追溯性。</p>
        <div class="rail-form">
          <label>保留天数</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <select v-model.number="cleanupDays" style="flex: 1;">
              <option :value="30">30 天</option>
              <option :value="90">90 天</option>
              <option :value="180">180 天</option>
              <option :value="365">365 天</option>
            </select>
            <button class="row-action danger" :disabled="cleaning" @click="runCleanup">{{ cleaning ? '清理中...' : '立即清理' }}</button>
          </div>
          <small style="color: var(--ink-soft); font-size: 10px;">仅清理操作日志，不影响业务数据。清理动作本身会记录审计。</small>
        </div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.rail-form { display: grid; gap: 10px; }
.rail-form label { color: var(--ink-soft); font-size: 11px; font-weight: 600; }
</style>
