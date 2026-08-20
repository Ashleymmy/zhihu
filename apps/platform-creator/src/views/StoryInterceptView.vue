<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore, apis } from '../stores/auth'

/** 评论截流词（知乎 OpenApi §2.9.3） */
interface InterceptWord { type?: number; keyword: string; channel?: string; createChannel?: string; status?: number; validedAt?: string }

const items = ref<InterceptWord[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref('')
const typeFilter = ref<0 | 1>(0)
const statusFilter = ref<number | ''>('')
const keyword = ref('')

const statusLabels: Record<number, string> = { 1: '审核中', 2: '判定违规', 3: '判定正常' }
const statusClass: Record<number, string> = { 1: 'paused', 2: 'rejected', 3: 'active' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const resp: any = await apis.story.interceptWords({
      type: typeFilter.value,
      status: statusFilter.value === '' ? undefined : statusFilter.value,
      keyword: keyword.value.trim() || undefined,
      limit: 50,
    })
    items.value = Array.isArray(resp) ? resp : (resp?.data ?? [])
    total.value = resp?.pagination?.total ?? items.value.length
  }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/zhihu-story" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">05 / 评论截流</p>
        <h1>评论截流</h1>
        <p>评论截流词的举报与判定记录，实时来自知乎开放平台。</p>
      </div>
      <div class="page-actions">
        <select v-model="typeFilter" @change="load">
          <option :value="0">被举报方</option>
          <option :value="1">举报方</option>
        </select>
        <select v-model="statusFilter" @change="load">
          <option value="">全部状态</option>
          <option :value="1">审核中</option>
          <option :value="2">判定违规</option>
          <option :value="3">判定正常</option>
        </select>
        <input v-model="keyword" placeholder="搜索截流词" style="width: 140px;" @keyup.enter="load" />
        <button class="row-action" @click="load">查询</button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">截流词列表</span>
        <span class="toolbar-count">{{ total }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!items.length" class="empty-panel"><span>暂无截流词记录。提交举报需在知乎侧关联作品与截图，如需请联系统管理员。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>截流词</th><th>归属渠道</th><th>创建渠道</th><th>判定状态</th><th>生效时间</th></tr></thead>
          <tbody>
            <tr v-for="(w, i) in items" :key="i">
              <td><strong>{{ w.keyword }}</strong></td>
              <td style="font-size: 11px;">{{ w.channel || '—' }}</td>
              <td style="font-size: 11px;">{{ w.createChannel || '—' }}</td>
              <td><span :class="['status-badge', statusClass[w.status ?? 1]]">{{ statusLabels[w.status ?? 1] ?? '审核中' }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ w.validedAt || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
