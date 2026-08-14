<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">推广作品</h1><p class="pg-sub">管理知乎联盟推广作品，支持单个与批量创建</p></div>
    </div>
    <a-tabs v-model:activeKey="tab" class="z-tabs">

      <!-- ── 作品列表 ── -->
      <a-tab-pane key="list" tab="作品列表">
        <div class="alert-info">
          本页须使用 channel_id + 单个计划关键词从知乎上游实时查询；“本地工作台”使用本地回传记录，两者不是同一数据源。
        </div>
        <div class="filter-row">
          <a-select v-model:value="lq.channel_id" placeholder="选择渠道（必填）" style="width:200px" @change="(val: any) => onChannelChange(val)">
            <a-select-option v-for="o in ch.channelOptions" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
          </a-select>
          <a-input v-model:value="lq.keyword" placeholder="单个计划关键词（必填）" style="width:220px" allow-clear />
          <a-button type="primary" :disabled="!lq.channel_id||!lq.keyword" @click="fetchList">查询</a-button>
        </div>
        <div class="table-card">
          <a-table :data-source="co.items" :loading="co.loading" row-key="composition_id" size="middle"
            :pagination="{ total: co.total, pageSize: co.limit, current: co.current, onChange: co.fetchPage }"
            :locale="{ emptyText: listEmptyText }">
            <a-table-column title="关键词" data-index="keyword" :width="140" />
            <a-table-column title="作品 ID" :width="200">
              <template #default="{ record }">
                <span class="mono-sm">{{ record.composition_id }}</span>
                <button class="copy-btn" @click="copyId(record.composition_id)">复制</button>
              </template>
            </a-table-column>
            <a-table-column title="作品链接" :width="100">
              <template #default="{ record }">
                <a v-if="record.composition_url" :href="record.composition_url" target="_blank" class="link-btn">查看</a>
                <span v-else>—</span>
              </template>
            </a-table-column>
            <a-table-column title="分类" :width="150">
              <template #default="{ record }">{{ formatCompositionCategory(record) }}</template>
            </a-table-column>
            <a-table-column title="提交时间" data-index="submit_time" :width="160" />
            <a-table-column title="状态" :width="100">
              <template #default="{ record }">
                <span :class="['badge', auditStatus(record.audit_status).badgeClass]">
                  {{ auditStatus(record.audit_status).label }}
                </span>
              </template>
            </a-table-column>
            <a-table-column title="操作" :width="80">
              <template #default="{ record }">
                <button v-if="record.audit_status===2" class="copy-btn" @click="openEdit(record)">修改</button>
              </template>
            </a-table-column>
          </a-table>
        </div>
      </a-tab-pane>

      <!-- ── 创建作品 ── -->
      <a-tab-pane key="create" tab="创建作品">
        <a-form :model="cf" layout="vertical" style="max-width:560px;margin-top:8px" @finish="handleCreate">
          <a-form-item label="推广计划 ID" name="plan_id" :rules="[{required:true,message:'请输入 planId'}]">
            <a-input v-model:value="cf.plan_id" placeholder="来自「创建计划」页面的 Plan ID" />
          </a-form-item>
          <a-form-item label="计划关键词（用于创建后查询）" name="keyword" :rules="[{required:true,message:'请输入计划关键词'},{pattern:/^[^,\s，]+$/,message:'仅支持单个关键词，不能含逗号或空格'}]">
            <a-input v-model:value="cf.keyword" placeholder="必须与创建计划时的关键词一致" />
            <div class="optional-tip">该字段只用于创建成功后实时回查，不会加入创建作品的上游请求。</div>
          </a-form-item>
          <a-form-item label="渠道" name="channel_id" :rules="[{required:true,message:'请选择渠道'}]">
            <a-select v-model:value="cf.channel_id" placeholder="选择渠道" style="width:100%">
              <a-select-option v-for="o in ch.channelOptions" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="媒体类型（media_type）" name="media_type" :rules="[{required:true}]">
            <a-select v-model:value="cf.media_type" style="width:100%" placeholder="选择作品发布平台">
              <a-select-option v-for="mediaType in MEDIA_TYPES" :key="mediaType" :value="mediaType">{{ mediaType }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="媒体账号" name="media_account" :rules="[{required:true,message:'请输入媒体账号'}]">
            <a-input v-model:value="cf.media_account" placeholder="知乎账号 ID 或用户名" />
          </a-form-item>
          <a-form-item label="作品类型（composition_type）" :rules="[{required:true}]">
            <a-select v-model:value="cf.composition_type" style="width:100%" @change="onCompositionTypeChange">
              <a-select-option :value="0">其他</a-select-option>
              <a-select-option :value="1">图文</a-select-option>
              <a-select-option :value="2">视频</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="子类型（composition_sub_type）" name="composition_sub_type" :rules="[{required:true}]">
            <a-select v-model:value="cf.composition_sub_type" style="width:100%">
              <a-select-option v-for="item in compositionSubTypeOptions" :key="item.value" :value="item.value">{{ item.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="作品 URL" name="composition_url" :rules="[{required:true,message:'请输入作品 URL'},{type:'url',message:'请输入合法 URL'}]">
            <a-input v-model:value="cf.composition_url" placeholder="知乎内容链接" />
          </a-form-item>
          <a-form-item label="发布时间" name="release_time" :rules="[{required:true,message:'请输入发布时间'}]">
            <a-date-picker v-model:value="cf.release_time" value-format="YYYY-MM-DD HH:mm:ss" show-time style="width:100%" />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" html-type="submit" :loading="co.creating">创建作品</a-button>
          </a-form-item>
        </a-form>
      </a-tab-pane>

      <!-- ── 批量创建 ── -->
      <a-tab-pane key="batch" tab="批量创建">
        <div style="max-width:560px;margin-top:8px">
          <div class="batch-tip">① 下载模板 4 → ② 填写作品信息 → ③ 选择绑定类型 → ④ 上传 Excel → ⑤ 等待并下载结果</div>
          <a-form layout="vertical">
            <a-form-item label="渠道">
              <a-select v-model:value="bf.channel_id" placeholder="选择渠道" style="width:100%">
                <a-select-option v-for="o in ch.channelOptions" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="绑定类型">
              <a-radio-group v-model:value="bf.bind_type">
                <a-radio :value="1">按计划 ID（planId）</a-radio>
                <a-radio :value="2">按关键词</a-radio>
              </a-radio-group>
            </a-form-item>
            <a-form-item label="Excel 文件（模板 4）">
              <input type="file" accept=".xlsx,.xls" class="file-input" @change="onBatchFile" />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" :loading="co.batchUploading||co.batchPolling" :disabled="!batchFile||!bf.channel_id" @click="submitBatch">
                {{ co.batchPolling ? '等待结果…' : '上传并批量创建' }}
              </a-button>
            </a-form-item>
          </a-form>
        </div>
      </a-tab-pane>
    </a-tabs>

    <!-- Edit Modal -->
    <a-modal v-model:open="editVisible" title="修改作品" :footer="null" width="520">
      <a-form :model="ef" layout="vertical" @finish="handleUpdate">
        <a-form-item label="作品 URL"><a-input v-model:value="ef.composition_url" /></a-form-item>
        <div style="display:flex;gap:10px;margin-top:8px">
          <a-button @click="editVisible=false" style="flex:1">取消</a-button>
          <a-button type="primary" html-type="submit" :loading="co.updating" style="flex:1">保存</a-button>
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import { MEDIA_TYPES } from '@/api/alliance'
import type { CompositionListItem, CreateCompositionReq } from '@/api/alliance'
import { useZChannelStore }      from '@/stores/zChannel.store'
import { useZCompositionStore }  from '@/stores/zComposition.store'
import { resolveCompositionAuditStatus } from '@/utils/compositionList'

const ch = useZChannelStore(); const co = useZCompositionStore()
const route = useRoute(); const tab = ref('list')
const lq = reactive({ channel_id: '', keyword: '' })
const cf = reactive({ plan_id:'', keyword:'', channel_id:'', media_type:MEDIA_TYPES[0], media_account:'', composition_type:1, composition_sub_type:1, composition_url:'', release_time:'' })
const bf = reactive({ channel_id:'', bind_type:1 }); const batchFile = ref<File|null>(null)
const editVisible = ref(false); const editingId = ref(''); const ef = reactive({ composition_url:'' })

const compositionSubTypes = {
  0: [{ value: 11, label: '其他' }],
  1: [{ value: 1, label: '实拍' }, { value: 2, label: 'Live 图' }, { value: 3, label: '截屏' }, { value: 4, label: '漫画' }],
  2: [{ value: 5, label: '表情包解说' }, { value: 6, label: '真人演绎' }, { value: 7, label: '猫 meme' }, { value: 8, label: '漫剧' }, { value: 9, label: '解压' }, { value: 10, label: '滚屏' }],
} as const
const compositionSubTypeOptions = computed(() => compositionSubTypes[cf.composition_type as keyof typeof compositionSubTypes])
const compositionTypeLabels = { 0: '其他', 1: '图文', 2: '视频' } as const
const listEmptyText = computed(() => {
  const keyword = lq.keyword.trim()
  if (!lq.channel_id || !keyword) return '请选择 channel_id 并输入单个计划关键词后查询'
  if (co.lastQuery?.channel_id !== lq.channel_id || co.lastQuery?.keyword !== keyword) {
    return '条件已填写，请点击“查询”从知乎上游实时加载'
  }
  return '知乎上游未返回匹配作品，请确认渠道和计划关键词，或稍后重新查询'
})

function formatCompositionCategory(record: CompositionListItem) {
  const type = compositionTypeLabels[record.composition_type as keyof typeof compositionTypeLabels]
  const subType = compositionSubTypes[record.composition_type as keyof typeof compositionSubTypes]
    ?.find(item => item.value === record.composition_sub_type)?.label
  if (type) return subType ? `${type} / ${subType}` : type
  return [record.category1, record.category2].filter(Boolean).join(' / ') || '—'
}

function onChannelChange(id: string) { lq.channel_id = id }
async function fetchList() {
  lq.keyword = lq.keyword.trim()
  if (!lq.channel_id || !lq.keyword) return
  await co.fetchList(lq)
}
async function handleCreate() {
  const req: CreateCompositionReq = {
    plan_id: cf.plan_id,
    channel_id: cf.channel_id,
    media_type: cf.media_type,
    media_account: cf.media_account,
    composition_type: cf.composition_type,
    composition_sub_type: cf.composition_sub_type,
    composition_url: cf.composition_url,
    release_time: dayjs(cf.release_time).unix(),
  }
  const createdId = await co.submitCreate(req)
  lq.channel_id = cf.channel_id
  lq.keyword = cf.keyword.trim()
  tab.value = 'list'
  try {
    const items = await co.fetchList(lq)
    if (!items.some(item => item.composition_id === createdId)) {
      message.warning('作品已创建，但知乎实时列表暂未返回该作品，请稍后重新查询')
    }
  } catch {
    message.warning('作品已创建，但实时列表查询失败，请稍后重新查询')
  }
}
function onCompositionTypeChange(value: unknown) {
  const type = Number(value) as keyof typeof compositionSubTypes
  const options = compositionSubTypes[type]
  if (options) cf.composition_sub_type = options[0].value
}
function openEdit(record: any) { editingId.value = record.composition_id; ef.composition_url = record.composition_url; editVisible.value = true }
async function handleUpdate() { await co.submitUpdate(editingId.value, ef); editVisible.value = false }
function onBatchFile(e: Event) { batchFile.value = (e.target as HTMLInputElement).files?.[0] ?? null }
async function submitBatch() {
  if (!batchFile.value) return
  await co.submitBatch(batchFile.value, bf)
}
async function copyId(id: string) { await navigator.clipboard.writeText(id); message.success('已复制') }
const auditStatus = (status?: number) => resolveCompositionAuditStatus(status)

function routeText(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

onMounted(async () => {
  await ch.fetchChannels()
  const routeTab = routeText(route.query.tab)
  const routeChannelId = routeText(route.query.channel_id)
  const routeKeyword = routeText(route.query.keyword).trim()
  const initialChannelId = routeChannelId || ch.channelOptions[0]?.value || ''

  if (['list', 'create', 'batch'].includes(routeTab)) tab.value = routeTab
  cf.plan_id = routeText(route.query.planId)
  cf.keyword = routeKeyword
  cf.channel_id = initialChannelId
  lq.channel_id = initialChannelId
  lq.keyword = routeKeyword
  bf.channel_id = initialChannelId
})
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.z-tabs :deep(.ant-tabs-nav) { margin-bottom: 16px; }
.alert-info { padding: 10px 14px; background: var(--color-info-bg); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-info); margin-bottom: 14px; }
.filter-row { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.mono-sm { font-size: 11.5px; font-family: var(--font-mono); color: var(--color-text-tertiary); }
.copy-btn { margin-left: 6px; padding: 2px 8px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 11px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.copy-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.link-btn { font-size: 12px; color: var(--color-accent); text-decoration: none; }
.link-btn:hover { text-decoration: underline; }
.batch-tip { padding: 10px 14px; background: var(--color-info-bg); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-info); margin-bottom: 16px; }
.optional-tip { margin-top: 6px; color: var(--color-text-tertiary); font-size: 12px; }
.file-input { color: var(--color-text-secondary); font-size: 13px; }
</style>
