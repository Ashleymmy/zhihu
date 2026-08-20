<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AccountMonitorItem } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const rows = ref<AccountMonitorItem[]>([])
const loading = ref(true)
const error = ref('')

function fmt(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function load() {
  loading.value = true
  try { rows.value = await apis.adminTools.monitor() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/system" class="back-link">← 返回系统工具</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">02 / 子账号监控</p>
        <h1>子账号监控</h1>
        <p>各账号的登录与操作行为概览（近 7 日）。</p>
      </div>
      <button class="row-action" @click="load">刷新</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">账号行为</span>
        <span class="toolbar-count">{{ rows.length }}</span>
      </div>
      <div v-if="loading" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>账号</th><th>角色</th><th>状态</th><th>最后登录</th><th>近 7 日操作</th><th>最近动作</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><strong>{{ r.displayName }}</strong> <small style="color: var(--ink-soft); font-family: var(--font-mono); font-size: 10px;">{{ r.username }}</small></td>
              <td><span class="status-badge draft">{{ r.role }}</span></td>
              <td><span :class="['status-badge', r.isActive ? 'active' : 'ended']">{{ r.isActive ? '活跃' : '已禁用' }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ fmt(r.lastLoginAt) }}</td>
              <td style="font-family: var(--font-mono); font-size: 11px;">{{ r.actionCount7d ?? 0 }}</td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ r.lastAction ? `${r.lastAction} · ${fmt(r.lastActionAt)}` : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
