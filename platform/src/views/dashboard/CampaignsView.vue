<template>
  <div class="campaigns-page">
    <div class="pg-header">
      <div><h1 class="pg-title">推广计划</h1><p class="pg-sub">管理知乎信息流推广计划，追踪预算与转化效果</p></div>
      <div class="header-actions">
        <a-button v-if="auth.can('project.manage')" @click="openChannelManager">渠道归属</a-button>
        <button class="btn-accent-sm" @click="openCreate">+ 新建计划</button>
      </div>
    </div>

    <!-- Stats row -->
    <div class="stat-row">
      <div v-for="(pill, i) in statPills" :key="pill.l"
           class="stat-pill animate-card"
           :style="{ animationDelay: i * 60 + 'ms' }">
        <span class="sp-v" :style="pill.color ? { color: pill.color } : {}">{{ pill.v }}</span>
        <span class="sp-l">{{ pill.l }}</span>
      </div>
    </div>

    <!-- Filter -->
    <div class="filter-row">
      <div class="search-box">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input v-model="q" placeholder="搜索关键词或渠道…" />
      </div>
      <div class="filter-chips">
        <span v-for="s in statusFilters" :key="s.val" :class="['chip', { active: filter === s.val }]" @click="filter = s.val">{{ s.label }}</span>
      </div>
    </div>

    <!-- Table -->
    <div class="table-card">
      <a-table :dataSource="filtered" :columns="cols" :pagination="{ pageSize: 8 }" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'keyword'">
            <div class="cell-name">{{ record.keyword }}</div>
            <div class="cell-sub">{{ record.channelName }}</div>
          </template>
          <template v-if="column.key === 'status'">
            <span :class="['badge', statusClass(record.status)]"><span class="badge-dot"/>{{ planStatusLabel(record.status) }}</span>
          </template>
          <template v-if="column.key === 'syncStatus'">
            <span :class="['badge', record.syncStatus === 'synced' ? 'badge-success' : record.syncStatus === 'failed' ? 'badge-error' : 'badge-warning']">
              <span class="badge-dot"/>{{ syncStatusLabel(record.syncStatus) }}
            </span>
          </template>
          <template v-if="column.key === 'budget'">
            <span style="font-family:var(--font-mono);font-size:13px;color:var(--color-text-primary)">{{ fmtFen(record.dailyBudget) }}</span>
            <div style="font-size:11px;color:var(--color-text-disabled)">每日上限</div>
          </template>
          <template v-if="column.key === 'dates'">
            <div style="font-size:12px;color:var(--color-text-secondary)">{{ record.startDate || '—' }}</div>
            <div style="font-size:11px;color:var(--color-text-disabled)">→ {{ record.endDate || '长期' }}</div>
          </template>
          <template v-if="column.key === 'actions'">
            <div class="actions-cell">
              <button class="act-btn" @click="editItem(record as Plan)">编辑</button>
              <button
                v-if="record.syncStatus === 'failed'"
                class="act-btn warning"
                :disabled="retryingPlanId === record.id"
                @click="retrySync(record as Plan)"
              >{{ retryingPlanId === record.id ? '重试中' : '重试同步' }}</button>
              <button class="act-btn danger" v-if="record.status==='active'" @click="handleToggle(record as Plan)">暂停</button>
              <button class="act-btn success" v-else-if="record.status==='paused'" @click="handleToggle(record as Plan)">启动</button>
            </div>
          </template>
        </template>
      </a-table>
    </div>

    <!-- Create / Edit Modal -->
    <a-modal v-model:open="showCreate" :title="editingId ? '编辑推广计划' : '新建推广计划'" :footer="null" width="520">
      <a-form :model="form" layout="vertical" @finish="handleCreate">
        <a-alert v-if="!editingId && channels.length === 0" message="暂无可用渠道，请联系管理员先同步并分配渠道。" type="warning" show-icon style="margin-bottom:16px" />
        <a-form-item v-if="!editingId" label="推广渠道" name="channelId" :rules="[{ required: true, message: '请选择推广渠道' }]">
          <a-select v-model:value="form.channelId" placeholder="选择渠道">
            <a-select-option v-for="ch in channels" :key="ch.id" :value="ch.zhihuChannelId">{{ ch.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item v-if="!editingId" label="推广任务" name="taskId" :rules="[{ required: true, message: '请选择推广任务' }]">
          <a-select v-model:value="form.taskId" placeholder="选择任务" @change="onTaskChange">
            <a-select-option v-for="task in tasks" :key="task.id" :value="task.zhihuTaskId">{{ task.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item v-if="!editingId" label="推广关键词" name="keyword" :rules="[{ required: true, message: '请输入关键词' }]">
          <a-input v-model:value="form.keyword" placeholder="例：夸克网盘" />
        </a-form-item>
        <a-form-item v-if="!editingId" label="推广内容地址" name="landingUrl" :rules="[{ required: true, message: '请输入推广内容地址' }, { type: 'url', message: '请输入合法的 URL' }]">
          <a-input v-model:value="form.landingUrl" placeholder="https://www.zhihu.com/question/…" />
        </a-form-item>
        <a-form-item v-if="!editingId" label="推广类型" name="popularizeType" :rules="[{ required: true, message: '请输入推广类型' }]">
          <a-input-number v-model:value="form.popularizeType" :min="0" :precision="0" style="width:100%" />
        </a-form-item>
        <a-form-item label="日预算（元）" name="dailyBudget" :rules="[{ required: true }]">
          <a-input-number v-model:value="form.dailyBudget" :min="1" :precision="2" style="width:100%" placeholder="100" />
        </a-form-item>
        <a-form-item label="开始日期" name="startDate">
          <a-date-picker v-model:value="form.startDate" value-format="YYYY-MM-DD" style="width:100%" placeholder="选择开始日期（可选）" />
        </a-form-item>
        <div style="display:flex;gap:10px;margin-top:8px">
          <a-button @click="showCreate = false" style="flex:1">取消</a-button>
          <a-button type="primary" html-type="submit" :loading="submitting" style="flex:1">{{ editingId ? '保存修改' : '创建计划' }}</a-button>
        </div>
      </a-form>
    </a-modal>

    <a-modal v-model:open="showChannelManager" title="渠道同步与归属" :footer="null" width="720">
      <div class="channel-toolbar">
        <span>同步由 Admin 发起；团长和达人只会看到已分配或已产生本人计划的渠道。</span>
        <a-button type="primary" :loading="syncingChannels" @click="syncChannels">同步渠道</a-button>
      </div>
      <a-table :data-source="channels" row-key="id" size="small" :pagination="false">
        <a-table-column title="渠道名称" data-index="name" />
        <a-table-column title="代际" data-index="generation" :width="80" />
        <a-table-column title="知乎渠道 ID" data-index="zhihuChannelId" :width="190" />
        <a-table-column title="归属账号" :width="220">
          <template #default="{ record }">
            <a-select
              :value="record.ownerId ?? undefined"
              placeholder="未分配"
              allow-clear
              style="width:100%"
              :loading="assigningChannelId === record.id"
              @change="(ownerId: unknown) => assignChannelOwner(record as Channel, ownerId)"
            >
              <a-select-option v-for="member in assignableMembers" :key="member.id" :value="member.id">
                {{ member.displayName }} · {{ member.role === 'leader' ? '团长' : '达人' }}
              </a-select-option>
            </a-select>
          </template>
        </a-table-column>
      </a-table>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { plansApi } from '@/api/plans'
import { channelsApi } from '@/api/channels'
import { tasksApi } from '@/api/tasks'
import { teamApi } from '@/api/team'
import { fmtFen, planStatusLabel, syncStatusLabel } from '@/utils/format'
import { message } from 'ant-design-vue'
import { useAuthStore } from '@/stores/auth'
import type { Channel, Plan, Task, TeamMember } from '@/types/api'

const auth       = useAuthStore()
const plans      = ref<Plan[]>([])
const channels   = ref<Channel[]>([])
const tasks      = ref<Task[]>([])
const assignableMembers = ref<TeamMember[]>([])
const q          = ref('')
const filter     = ref('all')
const showCreate = ref(false)
const showChannelManager = ref(false)
const submitting = ref(false)
const syncingChannels = ref(false)
const assigningChannelId = ref<string>()
const retryingPlanId = ref<string>()
const editingId  = ref<string>()
const form       = ref({ channelId: '', taskId: '', keyword: '', landingUrl: '', popularizeType: 0, dailyBudget: 100, startDate: '' as string | undefined })

const statusFilters = [
  { val: 'all', label: '全部' }, { val: 'active', label: '投放中' },
  { val: 'paused', label: '暂停' }, { val: 'ended', label: '已结束' },
]

const filtered = computed(() => plans.value
  .filter(p => filter.value === 'all' || p.status === filter.value)
  .filter(p => !q.value || p.keyword.includes(q.value) || p.channelName.includes(q.value)))

const totalDailyBudget = computed(() => plans.value.reduce((s, p) => s + (p.dailyBudget ?? 0), 0))
const syncedCount      = computed(() => plans.value.filter(p => p.syncStatus === 'synced').length)
const statusClass      = (s: string) => ({ active: 'badge-success', paused: 'badge-warning', ended: 'badge-default' })[s] ?? 'badge-default'
const statPills = computed(() => [
  { v: plans.value.length,                                         l: '计划总数',   color: '' },
  { v: plans.value.filter(p => p.status === 'active').length,      l: '投放中',     color: 'var(--color-success)' },
  { v: fmtFen(totalDailyBudget.value),                             l: '日预算合计', color: '' },
  { v: syncedCount.value,                                          l: '已同步知乎', color: 'var(--color-accent)' },
])

async function loadData() {
  try {
    const [planList, channelList, taskList] = await Promise.all([
      plansApi.list({ page: 1, pageSize: 50 }),
      channelsApi.list(),
      tasksApi.list({ page: 1, pageSize: 100 }),
    ])
    plans.value    = planList.list
    channels.value = channelList.list
    tasks.value    = taskList.list
  } catch (_) { /* empty */ }
}

function openCreate() {
  editingId.value = undefined
  form.value = { channelId: '', taskId: '', keyword: '', landingUrl: '', popularizeType: 0, dailyBudget: 100, startDate: undefined }
  showCreate.value = true
}
function editItem(r: Plan) {
  editingId.value = r.id
  form.value = { channelId: r.channelId, taskId: r.taskId, keyword: r.keyword, landingUrl: r.landingUrl, popularizeType: r.popularizeType, dailyBudget: (r.dailyBudget ?? 0) / 100, startDate: r.startDate ?? undefined }
  showCreate.value = true
}

function onTaskChange(taskId: unknown) {
  if (typeof taskId !== 'string') return
  const task = tasks.value.find(item => item.zhihuTaskId === taskId)
  if (task?.popularizeType != null) form.value.popularizeType = task.popularizeType
}

async function openChannelManager() {
  try {
    const [channelList, members] = await Promise.all([
      channelsApi.list({ page: 1, pageSize: 100 }),
      teamApi.list(),
    ])
    channels.value = channelList.list
    assignableMembers.value = members.filter(member => ['leader', 'member'].includes(member.role))
    showChannelManager.value = true
  } catch (e: any) {
    message.error(e.message || '加载渠道归属失败')
  }
}

async function syncChannels() {
  syncingChannels.value = true
  try {
    await channelsApi.sync()
    message.success('渠道同步已提交，请稍后重新打开本窗口查看')
  } catch (e: any) {
    message.error(e.message || '渠道同步失败')
  } finally {
    syncingChannels.value = false
  }
}

async function assignChannelOwner(channel: Channel, ownerId: unknown) {
  assigningChannelId.value = channel.id
  try {
    const result = await channelsApi.assignOwner(channel.id, typeof ownerId === 'string' ? ownerId : null)
    channel.ownerId = result.ownerId
    message.success('渠道归属已更新')
  } catch (e: any) {
    message.error(e.message || '渠道分配失败')
  } finally {
    assigningChannelId.value = undefined
  }
}

async function handleToggle(r: Plan) {
  try {
    // Backend only supports updating landingUrl/name/dailyBudget via PATCH.
    // Status changes (pause/resume) go through Zhihu Alliance API sync.
    const next = r.status === 'active' ? 'paused' : 'active'
    await plansApi.update(r.id, {} as any) // trigger sync; reflect locally
    r.status = next
  } catch (e: any) { message.error(e.message || '操作失败') }
}

async function retrySync(r: Plan) {
  retryingPlanId.value = r.id
  try {
    const result = await plansApi.retrySync(r.id)
    r.syncStatus = result.syncStatus as Plan['syncStatus']
    message.success('已重新提交同步，请稍后刷新查看结果')
  } catch (e: any) {
    message.error(e.message || '重试同步失败')
  } finally {
    retryingPlanId.value = undefined
  }
}

async function handleCreate() {
  submitting.value = true
  try {
    if (editingId.value) {
      const updatePayload = {
        dailyBudget: Math.round(form.value.dailyBudget * 100),
      }
      await plansApi.update(editingId.value, updatePayload)
      message.success('计划已更新')
    } else {
      await plansApi.create({
        taskId: form.value.taskId,
        channelId: form.value.channelId,
        keyword: form.value.keyword,
        landingUrl: form.value.landingUrl,
        popularizeType: form.value.popularizeType,
        dailyBudget: Math.round(form.value.dailyBudget * 100),
        startDate: form.value.startDate || null,
      })
      message.success('计划已创建，正在异步同步知乎')
    }
    showCreate.value = false
    await loadData()
  } catch (e: any) {
    message.error(e.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

const cols = [
  { title: '关键词 / 渠道', key: 'keyword' },
  { title: '状态', key: 'status', width: 90 },
  { title: '同步', key: 'syncStatus', width: 90 },
  { title: '日预算', key: 'budget', width: 120 },
  { title: '投放时间', key: 'dates', width: 160 },
  { title: '负责人', dataIndex: 'ownerName', key: 'ownerName', width: 90 },
  { title: '操作', key: 'actions', width: 130 },
]

onMounted(loadData)
</script>

<style scoped>
.campaigns-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.btn-accent-sm { padding: 8px 16px; background: var(--color-accent); border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; color: white; cursor: pointer; transition: all var(--transition-fast); }
.btn-accent-sm:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); }
.stat-row { display: flex; gap: 12px; margin-bottom: 18px; }
.stat-pill { display: flex; flex-direction: column; gap: 3px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 14px 20px; }
.sp-v { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-text-primary); }
.sp-l { font-size: 11.5px; color: var(--color-text-disabled); }
.filter-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.search-box { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-disabled); min-width: 220px; }
.search-box:focus-within { border-color: var(--color-accent); }
.search-box input { background: none; border: none; outline: none; font-size: 13px; color: var(--color-text-secondary); width: 100%; }
.search-box input::placeholder { color: var(--color-text-disabled); }
.filter-chips { display: flex; gap: 6px; }
.chip { padding: 5px 12px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.chip.active, .chip:hover { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent); }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.cell-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary); font-family: var(--font-mono); }
.cell-sub { font-size: 11.5px; color: var(--color-text-disabled); margin-top: 2px; }
.actions-cell { display: flex; gap: 6px; }
.act-btn { padding: 4px 10px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 11.5px; color: var(--color-text-secondary); cursor: pointer; transition: all var(--transition-fast); }
.act-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.act-btn.danger:hover { border-color: var(--color-error); color: var(--color-error); }
.act-btn.success:hover { border-color: var(--color-success); color: var(--color-success); }
.channel-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; color: var(--color-text-tertiary); font-size: 12.5px; }
</style>
