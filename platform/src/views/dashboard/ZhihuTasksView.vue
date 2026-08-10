<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">推广任务</h1><p class="pg-sub">查看可用的知乎联盟推广任务</p></div>
      <div class="header-actions">
        <a-button :loading="tk.loading" @click="loadPage(page)">刷新</a-button>
        <a-button v-if="auth.can('project.manage')" type="primary" :loading="syncing" @click="syncTasks">同步任务</a-button>
      </div>
    </div>

    <div class="alert-info">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      任务来自本地同步镜像；子账号只能读取，数据同步由管理员执行。
    </div>

    <div class="table-card">
      <a-table :data-source="tk.tasks" :loading="tk.loading" row-key="id" size="middle"
               :pagination="{ total: tk.total, pageSize: tk.limit, current: page, onChange: loadPage }"
               :locale="{ emptyText: '暂无推广任务' }">
        <a-table-column title="任务名称" data-index="task_name" :ellipsis="true" />
        <a-table-column title="产品" data-index="product_name" :width="120" />
        <a-table-column title="状态" :width="80">
          <template #default="{ record }">
            <span :class="['badge', statusClass(record.status)]"><span class="badge-dot"/>{{ record.status || '—' }}</span>
          </template>
        </a-table-column>
        <a-table-column title="有效期" :ellipsis="true">
          <template #default="{ record }">{{ formatPeriod(record.expiry_time) }}</template>
        </a-table-column>
        <a-table-column title="结算口径" data-index="pay_caliber" :ellipsis="true" />
        <a-table-column title="任务 ID" :width="220">
          <template #default="{ record }">
            <span class="mono-sm">{{ record.id }}</span>
            <button class="copy-btn" @click="copyId(record.id)">复制</button>
          </template>
        </a-table-column>
      </a-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { tasksApi } from '@/api/tasks'
import { useAuthStore } from '@/stores/auth'
import { useZTaskStore }    from '@/stores/zTask.store'

const auth = useAuthStore()
const tk   = useZTaskStore()
const page = ref(1)
const syncing = ref(false)

const statusClass = (s: string) =>
  ['active', '开启'].includes(s) ? 'badge-success' : ['paused', '暂停'].includes(s) ? 'badge-warning' : 'badge-default'

async function loadPage(p: number) {
  page.value = p
  await tk.fetchTasks('', p - 1)
}
function formatPeriod(expiry: string) {
  return expiry ? expiry.slice(0, 10) : '—'
}
async function copyId(id: string) {
  await navigator.clipboard.writeText(id); message.success('已复制 Task ID')
}
async function syncTasks() {
  syncing.value = true
  try {
    await tasksApi.sync()
    message.success('任务同步已提交，请稍后刷新')
  } catch (e: any) {
    message.error(e.message || '任务同步失败')
  } finally {
    syncing.value = false
  }
}
onMounted(() => loadPage(1))
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.header-actions { display: flex; gap: 8px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.alert-info { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--color-info-bg); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-info); margin-bottom: 16px; }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.mono-sm { font-size: 11.5px; font-family: var(--font-mono); color: var(--color-text-tertiary); }
.copy-btn { margin-left: 6px; padding: 2px 8px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 11px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.copy-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
</style>
