<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ZhihuTask } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const tasks = ref<ZhihuTask[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref('')
const keyword = ref('')
const statusFilter = ref('')
const syncing = ref(false)
const auth = useAuthStore()

async function syncNow() {
  syncing.value = true
  error.value = ''
  try {
    await apis.story.syncTasks()
    // 同步是异步任务，等几秒后刷新列表
    setTimeout(() => { load(); syncing.value = false }, 5000)
  } catch (e: any) { error.value = e?.message ?? String(e); syncing.value = false }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await apis.story.listTasks({ page: 1, pageSize: 100, keyword: keyword.value.trim() || undefined, status: statusFilter.value || undefined })
    tasks.value = data.list
    total.value = data.total
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

function fmtTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/zhihu-story" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">03 / 任务列表</p>
        <h1>推广任务</h1>
        <p>知乎侧同步下来的推广任务，用于对照计划执行情况。</p>
      </div>
      <div class="page-actions">
        <input v-model="keyword" placeholder="搜索任务名称" style="width: 160px;" @keyup.enter="load" />
        <button class="row-action" @click="load">查询</button>
        <button v-if="auth.user?.role === 'admin'" class="primary-action" :disabled="syncing" @click="syncNow">{{ syncing ? '同步中...' : '从知乎同步' }}</button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">任务列表</span>
        <span class="toolbar-count">{{ total }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!tasks.length" class="empty-panel"><span>暂无推广任务。任务由管理员从知乎侧同步。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>任务名称</th><th>知乎任务号</th><th>单价</th><th>开始</th><th>结束</th><th>状态</th><th>同步时间</th></tr></thead>
          <tbody>
            <tr v-for="t in tasks" :key="t.id">
              <td><strong>{{ t.name }}</strong></td>
              <td style="font-family: var(--font-mono); font-size: 10px;">{{ t.zhihuTaskId }}</td>
              <td style="font-family: var(--font-mono); font-size: 10px;">{{ t.unitPrice != null ? `¥${t.unitPrice}` : '—' }}</td>
              <td style="font-size: 11px;">{{ fmtTime(t.startTime) }}</td>
              <td style="font-size: 11px;">{{ fmtTime(t.endTime) }}</td>
              <td><span class="status-badge draft">{{ t.status ?? '未知' }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ fmtTime(t.syncedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
