<template>
  <div class="kw-page">
    <div class="pg-header">
      <div><h1 class="pg-title">编词与回传</h1><p class="pg-sub">团长 / 运营分配任务，KOC 达人提交内容并追踪回传结果</p></div>
      <button class="btn-accent-sm" @click="openBind">+ {{ createButtonLabel }}</button>
    </div>

    <!-- Filter row -->
    <div class="filter-row">
      <div class="search-box">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input v-model="q" placeholder="搜索词条关键词…" />
      </div>
      <a-select v-model:value="planFilter" placeholder="筛选计划" style="width:200px" allow-clear>
        <a-select-option v-for="p in plans" :key="p.id" :value="p.id">{{ p.keyword }} · {{ p.channelName }}</a-select-option>
      </a-select>
      <div class="filter-chips">
        <span v-for="s in statusFilters" :key="s.val" :class="['chip', { active: statusF === s.val }]" @click="statusF = s.val">{{ s.label }}</span>
      </div>
    </div>

    <!-- Table -->
    <div class="table-card">
      <a-table :dataSource="filtered" :columns="cols" :pagination="{ pageSize: 10 }" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'keyword'">
            <div class="kw-main">{{ record.keyword }}</div>
            <div class="kw-sub">{{ record.channelName }}</div>
          </template>
          <template v-if="column.key === 'bindStatus'">
            <span :class="['badge', record.displayStatus.badgeClass]"><span class="badge-dot"/>{{ record.displayStatus.label }}</span>
            <div v-if="statusError(record as KwRow)" class="status-error" :title="statusError(record as KwRow) || undefined">
              {{ statusError(record as KwRow) }}
            </div>
          </template>
          <template v-if="column.key === 'assignee'">
            <span style="font-size:12.5px;color:var(--color-text-secondary)">{{ assigneeLabel(record as any) }}</span>
          </template>
          <template v-if="column.key === 'promoUrl'">
            <a v-if="record.promoUrl" :href="record.promoUrl" target="_blank" rel="noopener noreferrer" class="url-link">查看内容</a>
            <span v-else style="color:var(--color-text-disabled);font-size:12px">—</span>
          </template>
          <template v-if="column.key === 'updated'">
            <span style="font-size:12px;color:var(--color-text-tertiary)">{{ record.updatedAt ? dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm') : '—' }}</span>
          </template>
          <template v-if="column.key === 'actions'">
            <div class="actions-cell">
              <button class="act-btn" @click="editComp(record as any)">编辑回传</button>
            </div>
          </template>
        </template>
      </a-table>
    </div>

    <!-- Bind Modal -->
    <a-modal v-model:open="showBind" :title="editingId ? '编辑回传' : createButtonLabel" :footer="null" width="520">
      <a-form :model="bForm" layout="vertical" @finish="handleBind">
        <a-form-item label="推广计划" name="planId" :rules="[{ required: true, message: '请选择推广计划' }]">
          <a-select v-model:value="bForm.planId" placeholder="选择计划">
            <a-select-option v-for="p in plans" :key="p.id" :value="p.id">{{ p.keyword }} · {{ p.channelName }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="内容链接" name="promoUrl" :rules="promoUrlRules">
          <a-input v-model:value="bForm.promoUrl" placeholder="https://www.zhihu.com/question/…" />
        </a-form-item>
        <template v-if="!editingId">
          <a-form-item label="媒体平台" name="mediaType" :rules="[{ required: true, message: '请选择媒体平台' }]">
            <a-select v-model:value="bForm.mediaType" placeholder="选择作品发布平台">
              <a-select-option v-for="item in mediaTypeOptions" :key="item.value" :value="String(item.value)">{{ item.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="媒体账号" name="mediaAccount" :rules="[{ required: true, whitespace: true, message: '请输入媒体账号' }]">
            <a-input v-model:value="bForm.mediaAccount" placeholder="作品发布平台的账号名称或 ID" />
          </a-form-item>
          <a-form-item label="作品类型" name="compositionType" :rules="[{ required: true, message: '请选择作品类型' }]">
            <a-select v-model:value="bForm.compositionType" placeholder="选择作品类型" @change="onCompositionTypeChange">
              <a-select-option v-for="item in compositionTypeOptions" :key="item.value" :value="Number(item.value)">{{ item.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="作品子类型" name="compositionSubType" :rules="[{ required: true, message: '请选择作品子类型' }]">
            <a-select v-model:value="bForm.compositionSubType" placeholder="选择作品子类型">
              <a-select-option v-for="item in compositionSubTypeOptions" :key="item.value" :value="Number(item.value)">{{ item.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="作品发布时间" name="releaseTime" :rules="[{ required: true, message: '请选择作品发布时间' }]">
            <a-date-picker v-model:value="bForm.releaseTime" value-format="YYYY-MM-DD HH:mm:ss" show-time style="width:100%" />
          </a-form-item>
        </template>
        <div style="display:flex;gap:10px;margin-top:8px">
          <a-button @click="showBind=false" style="flex:1">取消</a-button>
          <a-button type="primary" html-type="submit" :loading="submitting" style="flex:1">{{ editingId ? '保存' : '提交回传' }}</a-button>
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { compositionsApi } from '@/api/compositions'
import { plansApi } from '@/api/plans'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import type { Composition, Plan } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { useMetaStore } from '@/stores/meta'
import {
  normalizePromoUrl,
  resolveCompositionDisplayStatus,
  type CompositionDisplayStatus,
} from '@/utils/compositionFeedback'

interface KwRow extends Composition { displayStatus: CompositionDisplayStatus }

const compositions = ref<KwRow[]>([])
const auth         = useAuthStore()
const meta         = useMetaStore()
const createButtonLabel = computed(() => auth.isBoss || auth.isLeader ? '新增作品回传' : '提交编词回传')
const plans        = ref<Plan[]>([])
const q            = ref('')
const planFilter   = ref<string>()
const statusF      = ref('all')
const showBind     = ref(false)
const submitting   = ref(false)
const editingId    = ref<string>()
const bForm = ref({ planId: '', promoUrl: '', mediaType: '', mediaAccount: '', compositionType: 1, compositionSubType: 1, releaseTime: '' })
const mediaTypeOptions = computed(() => meta.mediaTypeOptions)
const compositionTypeOptions = computed(() => meta.compositionTypeOptions)
const compositionSubTypeOptions = computed(() => {
  const matching = meta.enums?.compositionSubType.filter(item => Number(item.parent) === bForm.value.compositionType) ?? []
  return matching.length > 0 ? matching : meta.enums?.compositionSubType ?? []
})

const statusFilters = [
  { val: 'all', label: '全部' }, { val: 'pending', label: '待回传' },
  { val: 'syncing', label: '回传中' }, { val: 'reviewing', label: '审核中' },
  { val: 'bound', label: '已绑定' }, { val: 'failed', label: '失败' },
  { val: 'ended', label: '已结束' },
]

const filtered = computed(() => compositions.value
  .filter(k => statusF.value === 'all' || k.displayStatus.key === statusF.value)
  .filter(k => !planFilter.value || k.planId === planFilter.value)
  .filter(k => !q.value || k.keyword.includes(q.value)))

const assigneeLabel = (row: KwRow) => row.assigneeName || (row.ownerId === auth.user?.id ? '本人' : row.ownerId ? `账号 ${row.ownerId}` : '未分配')
const statusError = (row: KwRow) => row.syncStatus === 'failed' ? row.syncError : row.status === 'rejected' ? row.rejectReason : null
const promoUrlRules = [
  { required: true, message: '请输入内容链接' },
  {
    validator: (_rule: unknown, value: string) => {
      try {
        normalizePromoUrl(value ?? '')
        return Promise.resolve()
      } catch (error) {
        return Promise.reject(error)
      }
    },
    trigger: 'blur' as const,
  },
]

function openBind() {
  editingId.value = undefined
  bForm.value = {
    planId: '',
    promoUrl: '',
    mediaType: String(mediaTypeOptions.value[0]?.value ?? ''),
    mediaAccount: '',
    compositionType: Number(compositionTypeOptions.value[0]?.value ?? 1),
    compositionSubType: Number(meta.enums?.compositionSubType.find(item => Number(item.parent) === Number(compositionTypeOptions.value[0]?.value ?? 0))?.value ?? 11),
    releaseTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  }
  showBind.value = true
}
function onCompositionTypeChange(value: unknown) {
  const type = Number(value)
  const options = meta.enums?.compositionSubType.filter(item => Number(item.parent) === type) ?? []
  if (options.length > 0) bForm.value.compositionSubType = Number(options[0].value)
}
function editComp(r: KwRow) {
  editingId.value = r.id
  bForm.value = {
    planId: r.planId,
    promoUrl: r.promoUrl,
    mediaType: r.mediaType,
    mediaAccount: r.mediaAccount,
    compositionType: r.compositionType,
    compositionSubType: r.compositionSubType,
    releaseTime: r.releaseTime ? dayjs(r.releaseTime).format('YYYY-MM-DD HH:mm:ss') : '',
  }
  showBind.value = true
}
async function handleBind() {
  submitting.value = true
  try {
    const promoUrl = normalizePromoUrl(bForm.value.promoUrl)
    bForm.value.promoUrl = promoUrl
    if (editingId.value) {
      await compositionsApi.update(editingId.value, { promoUrl })
      message.success('已更新')
    } else {
      await compositionsApi.create({
        planId: bForm.value.planId,
        promoUrl,
        mediaType: bForm.value.mediaType,
        mediaAccount: bForm.value.mediaAccount.trim(),
        compositionType: bForm.value.compositionType,
        compositionSubType: bForm.value.compositionSubType,
        releaseTime: dayjs(bForm.value.releaseTime).toISOString(),
      })
      message.success('作品回传已提交')
    }
    showBind.value = false
    await loadData()
  } catch (e: any) {
    message.error(e.message || '提交失败')
  } finally { submitting.value = false }
}

async function loadData() {
  const [compositionResult, planResult] = await Promise.allSettled([
    compositionsApi.list({ page: 1, pageSize: 100 }),
    plansApi.list({ page: 1, pageSize: 50 }),
  ])
  if (compositionResult.status === 'fulfilled') {
    compositions.value = compositionResult.value.list.map(c => ({
      ...c,
      displayStatus: resolveCompositionDisplayStatus(c),
    }))
  } else {
    message.error(compositionResult.reason?.message || '加载回传记录失败')
  }
  if (planResult.status === 'fulfilled') {
    plans.value = planResult.value.list
  } else {
    message.error(planResult.reason?.message || '加载推广计划失败')
  }
}

const cols = [
  { title: '关键词 / 渠道', key: 'keyword' },
  { title: '绑定状态', key: 'bindStatus', width: 180 },
  { title: '达人',    key: 'assignee', width: 100 },
  { title: '内容链接', dataIndex: 'promoUrl', key: 'promoUrl', width: 100 },
  { title: '更新时间', dataIndex: 'updatedAt', key: 'updated', width: 150 },
  { title: '操作',   key: 'actions', width: 110 },
]

onMounted(async () => {
  await meta.loadEnums()
  await loadData()
})
</script>

<style scoped>
.kw-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.btn-accent-sm { padding: 8px 16px; background: var(--color-accent); border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; color: white; cursor: pointer; transition: all var(--transition-fast); }
.btn-accent-sm:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); }
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.search-box { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-disabled); min-width: 200px; }
.search-box:focus-within { border-color: var(--color-accent); }
.search-box input { background: none; border: none; outline: none; font-size: 13px; color: var(--color-text-secondary); width: 100%; }
.filter-chips { display: flex; gap: 6px; }
.chip { padding: 5px 12px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.chip.active, .chip:hover { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent); }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.kw-main { font-size: 13px; font-weight: 500; color: var(--color-text-primary); font-family: var(--font-mono); }
.kw-sub { font-size: 11px; color: var(--color-text-disabled); margin-top: 2px; }
.url-link { font-size: 12px; color: var(--color-accent); text-decoration: none; }
.url-link:hover { text-decoration: underline; }
.status-error { max-width: 160px; margin-top: 4px; overflow: hidden; color: var(--color-error); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.actions-cell { display: flex; gap: 6px; }
.act-btn { padding: 4px 10px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 11.5px; color: var(--color-text-secondary); cursor: pointer; transition: all var(--transition-fast); }
.act-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.act-btn.danger:hover { border-color: var(--color-error); color: var(--color-error); }
</style>
