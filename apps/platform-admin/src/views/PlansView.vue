<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { Plan } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const route = useRoute()
/** 从知乎故事聚合页进入（/zhihu-story/plans）时显示返回入口 */
const fromStoryHub = route.path.startsWith('/zhihu-story')

const plans = ref<Plan[]>([])
const loading = ref(true)
const error = ref('')
const showModal = ref(false)

const form = ref({ keyword: '', channel: '知乎信息流', dailyBudget: '10000', status: 'draft' })

const fmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })
const statusLabels: Record<string, string> = { active: '投放中', paused: '已暂停', draft: '草稿', ended: '已结束', rejected: '已拒绝', archived: '已归档' }

async function load() {
  loading.value = true
  try {
    const data = await apis.plans.list({ page: 1, pageSize: 50 })
    plans.value = data.list
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function createPlan() {
  if (!form.value.keyword.trim()) return
  try {
    // TODO: 后端需要实现创建计划接口
    await apis.plans.list({ page: 1, pageSize: 50 })
    showModal.value = false
    form.value = { keyword: '', channel: '知乎信息流', dailyBudget: '10000', status: 'draft' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

async function retrySync(id: string) {
  try { await apis.plans.retry(id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

async function deletePlan(id: string) {
  if (!confirm('确定要删除这个推广计划吗？')) return
  try { await apis.plans.remove(id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link v-if="fromStoryHub" to="/zhihu-story" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="eyebrow">PROMOTION / CAMPAIGNS</p>
        <h1>推广计划</h1>
      </div>
      <div class="page-actions">
        <button class="ghost-aurora" @click="load">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          刷新
        </button>
        <button class="primary-action" @click="showModal = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          创建计划
        </button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <div>
          <span class="toolbar-title">计划列表</span>
          <span class="toolbar-count">{{ plans.length }}</span>
        </div>
      </div>

      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>

      <div v-else-if="!plans.length" class="empty-panel">
        <span>目前还没有推广计划。点击「创建计划」开始。</span>
      </div>

      <div v-else class="responsive-table">
        <table>
          <thead>
            <tr>
              <th>关键词</th>
              <th>渠道</th>
              <th>负责人</th>
              <th>日预算</th>
              <th>状态</th>
              <th>同步</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.id">
              <td><strong>{{ plan.keyword }}</strong></td>
              <td>{{ plan.channelName }}</td>
              <td>{{ plan.ownerName }}</td>
              <td>{{ plan.dailyBudget != null ? fmt.format(plan.dailyBudget / 100) : '—' }}</td>
              <td><span :class="['status-badge', plan.status]">{{ statusLabels[plan.status] }}</span></td>
              <td>
                <span :class="['status-badge', plan.syncStatus === 'synced' ? 'active' : plan.syncStatus === 'failed' ? 'rejected' : 'draft']">
                  {{ { local: '本地', syncing: '同步中', synced: '已同步', failed: '失败' }[plan.syncStatus] }}
                </span>
                <small v-if="plan.syncError" style="display: block; margin-top: 4px; font-size: 9px; color: var(--clay);">{{ plan.syncError }}</small>
              </td>
              <td>
                <div style="display: flex; gap: 6px;">
                  <button v-if="plan.syncStatus === 'failed'" class="row-action" @click="retrySync(plan.id)">重试同步</button>
                  <button class="row-action danger" @click="deletePlan(plan.id)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <!-- 创建计划对话框 -->
    <Teleport to="body">
      <div v-if="showModal" style="position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; background: rgba(33, 33, 33, 0.4); backdrop-filter: blur(2px);" @click.self="showModal = false">
        <div style="width: min(480px, 90vw); padding: 28px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--white); box-shadow: var(--shadow-float);">
          <h2 style="margin: 0 0 20px; font-family: var(--font-display); font-size: 22px;">创建推广计划</h2>
          <form class="form-grid" @submit.prevent="createPlan" style="gap: 16px;">
            <div>
              <label>关键词</label>
              <input v-model="form.keyword" placeholder="输入推广关键词" required />
            </div>
            <div>
              <label>渠道</label>
              <input v-model="form.channel" placeholder="知乎信息流" />
            </div>
            <div>
              <label>日预算（分）</label>
              <input v-model="form.dailyBudget" type="number" placeholder="10000" />
            </div>
            <div>
              <label>状态</label>
              <select v-model="form.status">
                <option value="draft">草稿</option>
                <option value="active">立即投放</option>
              </select>
            </div>
            <div class="form-submit" style="display: flex; gap: 10px; margin-top: 8px;">
              <button type="submit" class="primary-action" style="flex: 1;">确认创建</button>
              <button type="button" class="ghost-aurora" @click="showModal = false">取消</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
