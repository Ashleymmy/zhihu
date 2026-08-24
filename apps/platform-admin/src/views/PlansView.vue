<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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

interface ChannelOption { id: string; zhihuChannelId: string; name: string }
interface TaskOption { id: string; zhihuTaskId: string; name: string }

const fmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 })
const statusLabels: Record<string, string> = { active: '投放中', paused: '已暂停', draft: '草稿', ended: '已结束', rejected: '已拒绝', archived: '已归档' }

/** picker blur 延迟收起（让点击选项先生效） */
function closeTaskPicker() { setTimeout(() => { taskPickerOpen.value = false }, 150) }
function closeChannelPicker() { setTimeout(() => { channelPickerOpen.value = false }, 150) }

const channels = ref<ChannelOption[]>([])
const tasks = ref<TaskOption[]>([])
const submitting = ref(false)

/** 可搜索下拉（任务/渠道） */
const taskQuery = ref('')
const channelQuery = ref('')
const taskPickerOpen = ref(false)
const channelPickerOpen = ref(false)

const filteredTasks = computed(() => {
  const q = taskQuery.value.trim().toLowerCase()
  if (!q) return tasks.value
  return tasks.value.filter((t) => `${t.name}${t.zhihuTaskId}`.toLowerCase().includes(q))
})
const filteredChannels = computed(() => {
  const q = channelQuery.value.trim().toLowerCase()
  if (!q) return channels.value
  return channels.value.filter((c) => `${c.name}${c.zhihuChannelId}`.toLowerCase().includes(q))
})

const selectedTask = computed(() => tasks.value.find((t) => t.zhihuTaskId === form.value.taskId))
const selectedChannel = computed(() => channels.value.find((c) => c.zhihuChannelId === form.value.channelId))

const form = ref({ keyword: '', taskId: '', channelId: '', landingUrl: '', name: '', dailyBudgetYuan: '', startDate: '', endDate: '' })

/** 关键词实时校验 */
const keywordCheck = ref<{ checking: boolean; available: boolean | null }>({ checking: false, available: null })
let keywordTimer: ReturnType<typeof setTimeout> | null = null

function onKeywordInput() {
  keywordCheck.value = { checking: false, available: null }
  if (keywordTimer) clearTimeout(keywordTimer)
  const kw = form.value.keyword.trim()
  if (!kw || !form.value.channelId) return
  keywordTimer = setTimeout(async () => {
    keywordCheck.value = { checking: true, available: null }
    try {
      const r = await apis.plans.checkKeyword(form.value.channelId, kw)
      keywordCheck.value = { checking: false, available: r.available }
    } catch { keywordCheck.value = { checking: false, available: null } }
  }, 600)
}

function pickTask(t: TaskOption) {
  form.value.taskId = t.zhihuTaskId
  taskQuery.value = `${t.name}（${t.zhihuTaskId}）`
  taskPickerOpen.value = false
}

function pickChannel(c: ChannelOption) {
  form.value.channelId = c.zhihuChannelId
  channelQuery.value = `${c.name}（${c.zhihuChannelId}）`
  channelPickerOpen.value = false
  // 渠道变化后重新校验关键词
  if (form.value.keyword.trim()) onKeywordInput()
}

/** 渠道/任务目录同步（需要时可手动触发，通常每天自动跑一次） */
const syncingCatalog = ref(false)
const catalogSyncedAt = ref('')
const catalogMessage = ref('')
async function syncCatalog() {
  syncingCatalog.value = true
  error.value = ''
  catalogMessage.value = '同步任务已提交，正在从知乎拉取…'
  try {
    await Promise.all([apis.channels.sync(), apis.story.syncTasks()])
    // 同步是异步任务：等待执行后刷新目录与计划，并给出数量反馈
    setTimeout(async () => {
      try {
        const [c, t] = await Promise.all([
          apis.channels.list({ page: 1, pageSize: 100 }),
          apis.story.listTasks({ page: 1, pageSize: 100 }),
        ])
        channels.value = c.list as unknown as ChannelOption[]
        tasks.value = t.list as TaskOption[]
        catalogMessage.value = `同步完成：${channels.value.length} 个渠道、${tasks.value.length} 个任务可用`
        await load()
      } catch { catalogMessage.value = '同步已提交，下拉数据稍后自动更新' }
      syncingCatalog.value = false
    }, 6000)
  } catch (e: any) {
    error.value = e?.message ?? String(e)
    catalogMessage.value = ''
    syncingCatalog.value = false
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await apis.plans.list({ page: 1, pageSize: 50 })
    plans.value = data.list
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function openCreate() {  showModal.value = true
  keywordCheck.value = { checking: false, available: null }
  if (!channels.value.length || !tasks.value.length) {
    try {
      const [c, t] = await Promise.all([
        apis.channels.list({ page: 1, pageSize: 100 }),
        apis.story.listTasks({ page: 1, pageSize: 100 }),
      ])
      channels.value = c.list as unknown as ChannelOption[]
      tasks.value = t.list as TaskOption[]
    } catch (e: any) { error.value = '渠道/任务目录加载失败：' + (e?.message ?? String(e)) }
  }
}

async function createPlan() {
  error.value = ''
  if (!form.value.taskId || !form.value.channelId || !form.value.keyword.trim() || !form.value.landingUrl.trim()) {
    error.value = '请完整填写任务、渠道、关键词和推广内容地址'
    return
  }
  submitting.value = true
  try {
    await apis.plans.create({
      taskId: form.value.taskId,
      channelId: form.value.channelId,
      keyword: form.value.keyword.trim(),
      landingUrl: form.value.landingUrl.trim(),
      popularizeType: 0,
      name: form.value.name.trim() || null,
      dailyBudget: form.value.dailyBudgetYuan ? Math.round(Number(form.value.dailyBudgetYuan) * 100) : null,
      startDate: form.value.startDate || null,
      endDate: form.value.endDate || null,
    })
    showModal.value = false
    form.value = { keyword: '', taskId: '', channelId: '', landingUrl: '', name: '', dailyBudgetYuan: '', startDate: '', endDate: '' }
    taskQuery.value = ''
    channelQuery.value = ''
    keywordCheck.value = { checking: false, available: null }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { submitting.value = false }
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
        <button class="ghost-aurora" :disabled="syncingCatalog" @click="syncCatalog">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /><polyline points="21 3 21 9 15 9" /></svg>
          {{ syncingCatalog ? '同步中...' : '同步渠道/任务' }}
        </button>
        <button class="ghost-aurora" @click="load">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          刷新
        </button>
        <button class="primary-action" @click="openCreate">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          创建计划
        </button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>
    <div v-if="catalogMessage" style="padding: 12px 16px; border: 1px solid var(--moss); border-radius: var(--radius); background: #e6ebe7; font-size: 11px; color: var(--moss);">{{ catalogMessage }}</div>

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
            <!-- 推广渠道（可搜索） -->
            <div class="full-span picker-field">
              <label>推广渠道 <span class="required">*</span></label>
              <div class="picker-wrap">
                <input v-model="channelQuery" placeholder="搜索渠道名称或 ID" @focus="channelPickerOpen = true" @blur="closeChannelPicker" @input="form.channelId = ''" />
                <div v-if="channelPickerOpen" class="picker-options">
                  <button v-for="c in filteredChannels.slice(0, 8)" :key="c.id" type="button" class="picker-option" @mousedown.prevent="pickChannel(c)">
                    <strong>{{ c.name }}</strong>
                    <span class="picker-meta">{{ c.zhihuChannelId }}</span>
                  </button>
                  <p v-if="!filteredChannels.length" class="picker-empty">没有匹配的渠道。请先在「系统工具 → 数据处理」同步渠道。</p>
                </div>
              </div>
              <small v-if="selectedChannel" style="color: var(--ink-soft);">已选：{{ selectedChannel.name }}</small>
            </div>

            <!-- 推广任务（可搜索） -->
            <div class="full-span picker-field">
              <label>推广任务 <span class="required">*</span></label>
              <div class="picker-wrap">
                <input v-model="taskQuery" placeholder="搜索任务名称或 ID" @focus="taskPickerOpen = true" @blur="closeTaskPicker" @input="form.taskId = ''" />
                <div v-if="taskPickerOpen" class="picker-options">
                  <button v-for="t in filteredTasks.slice(0, 8)" :key="t.id" type="button" class="picker-option" @mousedown.prevent="pickTask(t)">
                    <strong>{{ t.name }}</strong>
                    <span class="picker-meta">{{ t.zhihuTaskId }}</span>
                  </button>
                  <p v-if="!filteredTasks.length" class="picker-empty">没有匹配的任务。请先在「系统工具 → 数据处理」同步任务。</p>
                </div>
              </div>
              <small v-if="selectedTask" style="color: var(--ink-soft);">已选：{{ selectedTask.name }}</small>
            </div>

            <!-- 关键词 -->
            <div class="full-span">
              <label>推广关键词 <span class="required">*</span></label>
              <input v-model="form.keyword" placeholder="例：夸克网盘" required @input="onKeywordInput" />
              <small style="color: var(--ink-soft);">仅支持单个关键词；最终是否符合词根规则由知乎接口校验。</small>
              <small v-if="keywordCheck.checking" style="color: var(--ink-soft);">校验中...</small>
              <small v-else-if="keywordCheck.available === true" style="color: var(--moss);">✓ 关键词可用</small>
              <small v-else-if="keywordCheck.available === false" style="color: var(--clay);">✗ 关键词不可用（可能已被占用或含通用词根）</small>
            </div>

            <!-- 推广内容地址 -->
            <div class="full-span">
              <label>推广内容地址 <span class="required">*</span></label>
              <input v-model="form.landingUrl" type="url" placeholder="https://www.zhihu.com/question/..." required />
            </div>

            <!-- 推广类型（固定 0，信息流） -->
            <div>
              <label>推广类型</label>
              <input value="信息流（0）" disabled />
            </div>

            <!-- 日预算（元） -->
            <div>
              <label>日预算（元）</label>
              <input v-model="form.dailyBudgetYuan" type="number" min="0" step="0.01" placeholder="100.00" />
            </div>

            <!-- 开始/结束日期 -->
            <div>
              <label>开始日期（可选）</label>
              <input v-model="form.startDate" type="date" />
            </div>
            <div>
              <label>结束日期（可选）</label>
              <input v-model="form.endDate" type="date" />
            </div>

            <!-- 计划名称 -->
            <div class="full-span">
              <label>计划名称（可选）</label>
              <input v-model="form.name" placeholder="便于识别的内部名称" />
            </div>

            <div class="form-submit" style="display: flex; gap: 10px; margin-top: 8px;">
              <button type="submit" class="primary-action" style="flex: 1;" :disabled="submitting">{{ submitting ? '创建中...' : '确认创建' }}</button>
              <button type="button" class="ghost-aurora" @click="showModal = false">取消</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>

</template>

<style scoped>
.required { color: var(--clay); }
.picker-wrap { position: relative; }
.picker-wrap input { width: 100%; }
.picker-options {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  border: 1px solid var(--line);
  border-radius: 2px;
  background: var(--white);
  box-shadow: var(--shadow-float);
  overflow: hidden;
}
.picker-option {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--paper-deep);
  background: transparent;
  text-align: left;
  transition: background 0.15s ease;
}
.picker-option:last-child { border-bottom: 0; }
.picker-option:hover { background: var(--paper-deep); }
.picker-option strong { font-size: 12px; font-weight: 500; }
.picker-meta { color: #7b8286; font-family: var(--font-mono); font-size: 10px; }
.picker-empty { margin: 0; padding: 12px; color: var(--ink-soft); font-size: 11px; }
</style>
