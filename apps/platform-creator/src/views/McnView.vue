<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { McnAccount } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const accounts = ref<McnAccount[]>([])
const loading = ref(true)
const error = ref('')
const showModal = ref(false)
const form = ref({ accountKey: '', accountName: '' })

async function load() {
  loading.value = true
  try { accounts.value = await apis.mcn.list() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function createAccount() {
  if (!form.value.accountKey.trim() || !form.value.accountName.trim()) return
  try {
    await apis.mcn.create(form.value)
    showModal.value = false
    form.value = { accountKey: '', accountName: '' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">MCN / ACCOUNTS</p>
        <h1>MCN 管理</h1>
      </div>
      <button class="primary-action" @click="showModal = true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        添加 MCN
      </button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar"><span class="toolbar-title">MCN 账号</span><span class="toolbar-count">{{ accounts.length }}</span></div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!accounts.length" class="empty-panel"><span>暂无 MCN 账号。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>账号 Key</th><th>账号名称</th><th>状态</th><th>创建时间</th></tr></thead>
          <tbody>
            <tr v-for="a in accounts" :key="a.id">
              <td style="font-family: var(--font-mono); font-size: 10px;">{{ a.accountKey }}</td>
              <td><strong>{{ a.accountName }}</strong></td>
              <td><span :class="['status-badge', a.status === 'active' ? 'active' : 'ended']">{{ { active: '活跃', suspended: '已暂停', archived: '已归档' }[a.status] }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ new Date(a.createdAt).toLocaleDateString('zh-CN') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <Teleport to="body">
      <div v-if="showModal" style="position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; background: rgba(33, 33, 33, 0.4); backdrop-filter: blur(2px);" @click.self="showModal = false">
        <div style="width: min(420px, 90vw); padding: 28px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--white); box-shadow: var(--shadow-float);">
          <h2 style="margin: 0 0 20px; font-family: var(--font-display); font-size: 22px;">添加 MCN 账号</h2>
          <form class="form-grid" @submit.prevent="createAccount" style="gap: 16px;">
            <div><label>账号 Key</label><input v-model="form.accountKey" required /></div>
            <div><label>账号名称</label><input v-model="form.accountName" required /></div>
            <div class="form-submit" style="display: flex; gap: 10px; margin-top: 8px;">
              <button type="submit" class="primary-action" style="flex: 1;">确认添加</button>
              <button type="button" class="ghost-aurora" @click="showModal = false">取消</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
