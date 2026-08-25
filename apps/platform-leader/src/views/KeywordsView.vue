<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Plan } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const plans = ref<Plan[]>([])
const loading = ref(true)
const error = ref('')
const showForm = ref(false)
const form = ref({ keyword: '', targetUrl: '', eventType: 'impression' })

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await apis.plans.list({ page: 1, pageSize: 100 })
    plans.value = data.list
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function bindKeyword() {
  if (!form.value.keyword.trim() || !form.value.targetUrl.trim()) return
  try {
    // TODO: 后端需要实现关键词绑定接口
    showForm.value = false
    form.value = { keyword: '', targetUrl: '', eventType: 'impression' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">KEYWORDS / CALLBACK</p>
        <h1>关键词回传</h1>
        <p style="max-width: 520px; margin: 6px 0 0; color: var(--ink-soft); font-size: 13px; line-height: 1.7;">绑定推广词条并配置回传事件，让内容、投放和转化在同一条链路中发生。</p>
      </div>
      <button class="primary-action" @click="showForm = !showForm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        绑定词条
      </button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <!-- 路径说明 -->
    <section class="workflow-grid" style="grid-template-columns: repeat(3, 1fr);">
      <article class="panel" style="padding: 20px; text-align: center;">
        <div style="display: grid; width: 37px; height: 37px; place-items: center; border-radius: 50%; color: var(--forest); background: #dbe9db; margin: 0 auto 12px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </div>
        <p class="eyebrow" style="margin-bottom: 4px;">01</p>
        <h3 style="margin: 0 0 4px; font-size: 14px;">词条</h3>
        <p style="margin: 0; font-size: 13px; color: var(--ink-soft);">绑定推广关键词</p>
      </article>
      <article class="panel" style="padding: 20px; text-align: center;">
        <div style="display: grid; width: 37px; height: 37px; place-items: center; border-radius: 50%; color: var(--forest); background: #dbe9db; margin: 0 auto 12px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
        </div>
        <p class="eyebrow" style="margin-bottom: 4px;">02</p>
        <h3 style="margin: 0 0 4px; font-size: 14px;">知乎内容</h3>
        <p style="margin: 0; font-size: 13px; color: var(--ink-soft);">关联知乎推广内容</p>
      </article>
      <article class="panel" style="padding: 20px; text-align: center;">
        <div style="display: grid; width: 37px; height: 37px; place-items: center; border-radius: 50%; color: var(--clay); background: #f1ded9; margin: 0 auto 12px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
        </div>
        <p class="eyebrow" style="margin-bottom: 4px;">03</p>
        <h3 style="margin: 0 0 4px; font-size: 14px;">回传事件</h3>
        <p style="margin: 0; font-size: 13px; color: var(--ink-soft);">配置转化回传</p>
      </article>
    </section>

    <!-- 绑定表单 -->
    <article v-if="showForm" class="panel form-panel">
      <header>
        <div class="panel-icon cyan">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </div>
        <h2>绑定推广词条</h2>
      </header>
      <form class="form-grid" @submit.prevent="bindKeyword">
        <div>
          <label>关键词</label>
          <input v-model="form.keyword" placeholder="输入推广关键词" required />
        </div>
        <div>
          <label>目标 URL</label>
          <input v-model="form.targetUrl" placeholder="https://www.zhihu.com/..." required />
        </div>
        <div>
          <label>事件类型</label>
          <select v-model="form.eventType">
            <option value="impression">曝光</option>
            <option value="click">点击</option>
            <option value="conversion">转化</option>
          </select>
        </div>
        <div class="form-submit">
          <button type="submit" class="primary-action">确认绑定</button>
          <button type="button" class="ghost-aurora" @click="showForm = false">取消</button>
        </div>
      </form>
    </article>

    <!-- 已绑定列表 -->
    <article class="panel data-panel" style="min-height: 200px;">
      <div class="list-toolbar">
        <span class="toolbar-title">已绑定词条</span>
        <span class="toolbar-count">{{ plans.length }}</span>
      </div>
      <div v-if="loading" style="display: grid; min-height: 160px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!plans.length" class="empty-panel"><span>还没有绑定任何词条。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>关键词</th><th>渠道</th><th>状态</th><th>同步状态</th></tr></thead>
          <tbody>
            <tr v-for="p in plans" :key="p.id">
              <td><strong>{{ p.keyword }}</strong></td>
              <td>{{ p.channelName }}</td>
              <td><span :class="['status-badge', p.status]">{{ { pending: '待审核', active: '投放中', paused: '已暂停', rejected: '已拒绝', ended: '已结束' }[p.status] }}</span></td>
              <td><span :class="['status-badge', p.syncStatus === 'synced' ? 'active' : 'draft']">{{ { local: '本地', syncing: '同步中', synced: '已同步', failed: '失败' }[p.syncStatus] }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
