<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore, apis } from '../stores/auth'

/** 产品库：从推广任务（popularize_tasks）聚合 product_name 维度 */
interface ProductRow { name: string; taskCount: number; statuses: string[] }

const products = ref<ProductRow[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const resp = await apis.story.listTasks({ page: 1, pageSize: 100 })
    const map = new Map<string, ProductRow>()
    for (const t of resp.list as any[]) {
      const name = t.product_name ?? t.productName ?? '未标注产品'
      const row: ProductRow = map.get(name) ?? { name, taskCount: 0, statuses: [] }
      row.taskCount++
      if (t.status && !row.statuses.includes(t.status)) row.statuses.push(t.status)
      map.set(name, row)
    }
    products.value = [...map.values()].sort((a, b) => b.taskCount - a.taskCount)
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
        <p class="section-index">09 / 产品库</p>
        <h1>产品库</h1>
        <p>从推广任务聚合的产品维度视图，数据来自知乎同步的推广任务。</p>
      </div>
      <button class="row-action" @click="load">刷新</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">产品列表</span>
        <span class="toolbar-count">{{ products.length }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!products.length" class="empty-panel"><span>暂无产品数据。产品维度来自知乎同步的推广任务。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>产品名称</th><th>关联任务数</th><th>任务状态</th></tr></thead>
          <tbody>
            <tr v-for="p in products" :key="p.name">
              <td><strong>{{ p.name }}</strong></td>
              <td style="font-family: var(--font-mono); font-size: 13px;">{{ p.taskCount }}</td>
              <td><span v-for="s in p.statuses" :key="s" class="status-badge draft" style="margin-right: 6px;">{{ s }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
