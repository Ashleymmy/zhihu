<template>
  <div class="compositions-view">
    <el-tabs v-model="activeTab">

      <!-- ── 作品列表 ── -->
      <el-tab-pane label="作品列表" name="list">
        <el-form inline style="margin-top: 12px">
          <el-form-item label="渠道">
            <el-select
              v-model="query.channel_id"
              placeholder="选择渠道"
              style="width: 200px"
              @change="() => query.keyword = ''"
            >
              <el-option v-for="o in channelStore.channelOptions" :key="o.value" v-bind="o" />
            </el-select>
          </el-form-item>
          <el-form-item label="关键词">
            <el-input v-model="query.keyword" placeholder="KOC 关键词（必填）" style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-button
              type="primary"
              :disabled="!query.channel_id || !query.keyword"
              :loading="compositionStore.loading"
              @click="doSearch"
            >查询</el-button>
          </el-form-item>
        </el-form>

        <el-alert
          title="channel_id 和关键词均必填，无法查询全部作品"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
        />

        <el-table
          :data="compositionStore.items"
          v-loading="compositionStore.loading"
          empty-text="暂无数据，请输入渠道和关键词查询"
          border
        >
          <el-table-column prop="keyword" label="关键词" width="120" />
          <el-table-column prop="composition_id" label="作品 ID" width="160" show-overflow-tooltip>
            <template #default="{ row }">
              <span style="font-size: 12px; font-family: monospace">{{ row.composition_id }}</span>
              <el-button link size="small" @click="copyText(row.composition_id)">复制</el-button>
            </template>
          </el-table-column>
          <el-table-column prop="composition_url" label="作品链接" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <el-link :href="row.composition_url" target="_blank" type="primary">{{ row.composition_url }}</el-link>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="100">
            <template #default="{ row }">
              {{ COMPOSITION_TYPE_LABELS[row.composition_type] }} /
              {{ COMPOSITION_SUB_TYPE_LABELS[row.composition_sub_type] }}
            </template>
          </el-table-column>
          <el-table-column prop="submit_time" label="提交时间" width="160" />
          <el-table-column prop="popularize_channel" label="渠道" width="120" show-overflow-tooltip />
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openUpdateForm(row)">修改</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-bar">
          <el-pagination
            v-model:current-page="currentPage"
            :page-size="compositionStore.limit"
            :total="compositionStore.total"
            layout="total, prev, pager, next"
            @current-change="compositionStore.fetchPage"
          />
        </div>
      </el-tab-pane>

      <!-- ── 单个创建 ── -->
      <el-tab-pane label="创建作品" name="create">
        <el-alert
          title="⚠️ 渠道必须与创建推广计划时选择的渠道完全一致，否则 API 将返回「计划未找到」"
          type="warning"
          :closable="false"
          show-icon
          style="max-width: 680px; margin-top: 12px; margin-bottom: 4px"
        />
        <composition-form
          style="max-width: 680px; margin-top: 12px"
          :loading="compositionStore.creating"
          :initial="createInitial"
          @submit="onCreateSubmit"
        />
      </el-tab-pane>

      <!-- ── 批量创建 ── -->
      <el-tab-pane label="批量创建" name="batch">
        <div style="max-width: 640px; margin-top: 12px">
          <el-alert
            title="批量创建作品（模板 4）"
            type="info"
            :closable="false"
            style="margin-bottom: 16px"
          >
            ① 使用模板 4（bind_type=1 填 plan_id，bind_type=2 填关键词）→ ② 填写分类/媒体账号/地址等 →
            ③ 上传 → ④ 自动轮询下载结果
          </el-alert>
          <el-form label-width="110px">
            <el-form-item label="渠道">
              <el-select v-model="batchChannelId" placeholder="选择渠道" style="width: 100%">
                <el-option v-for="o in channelStore.channelOptions" :key="o.value" v-bind="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="绑定类型">
              <el-radio-group v-model="batchBindType">
                <el-radio :value="1">Plan ID（模板第一列填计划id）</el-radio>
                <el-radio :value="2">关键词（模板第一列填关键词）</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="Excel 文件">
              <el-upload
                :auto-upload="false"
                :on-change="(f: UploadFile) => batchFile = f.raw ?? null"
                accept=".xlsx,.xls"
                :limit="1"
              >
                <el-button>选择文件（模板 4）</el-button>
              </el-upload>
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="compositionStore.batchUploading || compositionStore.batchPolling"
                :disabled="!batchFile || !batchChannelId"
                @click="submitBatch"
              >
                {{ compositionStore.batchPolling ? '等待结果...' : '上传并批量创建' }}
              </el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 修改弹窗 -->
    <el-dialog v-model="updateDialogVisible" title="修改推广作品" width="700px">
      <el-alert
        title="只有「审核未通过」的作品可以修改，修改后重新提交审核。"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      />
      <composition-form
        v-if="editingItem"
        :loading="compositionStore.updating"
        :initial="editInitial"
        @submit="onUpdateSubmit"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { useChannelStore } from '@/stores/channel.store'
import { useCompositionStore } from '@/stores/composition.store'
import {
  COMPOSITION_TYPE_LABELS,
  COMPOSITION_SUB_TYPE_LABELS,
} from '@/constants/enums'
import type {
  CompositionListItem,
  CreateCompositionV2Request,
} from '@/types/models'
import CompositionForm from '@/components/CompositionForm.vue'

const route = useRoute()
const channelStore = useChannelStore()
const compositionStore = useCompositionStore()

const activeTab = ref('list')
const currentPage = ref(1)

/**
 * 从 route query 预填创建表单（从"创建计划"页跳转时自动携带 plan_id + channel_id）
 * ⚠️ channel_id 必须与创建该计划时使用的渠道完全一致，否则 API 返回"计划未找到"
 */
const createInitial = computed<Partial<CreateCompositionV2Request> | undefined>(() => {
  const plan_id   = route.query.plan_id   as string | undefined
  const channel_id = route.query.channel_id as string | undefined
  if (!plan_id && !channel_id) return undefined
  return {
    ...(plan_id    ? { plan_id }    : {}),
    ...(channel_id ? { channel_id } : {}),
  }
})

const query = reactive({ channel_id: '', keyword: '' })

async function doSearch() {
  currentPage.value = 1
  await compositionStore.fetchList({
    channel_id: query.channel_id,
    keyword: query.keyword,
    limit: compositionStore.limit,
  })
}

// 批量
const batchFile = ref<File | null>(null)
const batchChannelId = ref('')
const batchBindType = ref(1)

async function submitBatch() {
  if (!batchFile.value || !batchChannelId.value) return
  await compositionStore.submitBatch(batchFile.value, {
    channel_id: batchChannelId.value,
    bind_type: batchBindType.value,
  })
}

// 创建
async function onCreateSubmit(req: CreateCompositionV2Request) {
  await compositionStore.submitCreate(req)
}

// 更新
const updateDialogVisible = ref(false)
const editingItem = ref<CompositionListItem | null>(null)
const editInitial = computed(() =>
  editingItem.value
    ? {
        channel_id:           editingItem.value.popularize_channel,
        composition_type:     editingItem.value.composition_type,
        composition_sub_type: editingItem.value.composition_sub_type,
        composition_url:      editingItem.value.composition_url,
      }
    : undefined,
)

function openUpdateForm(row: CompositionListItem) {
  editingItem.value = row
  updateDialogVisible.value = true
}

async function onUpdateSubmit(req: CreateCompositionV2Request) {
  if (!editingItem.value) return
  await compositionStore.submitUpdate(editingItem.value.composition_id, req)
  updateDialogVisible.value = false
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}

onMounted(() => {
  channelStore.fetchChannels()
  // 从计划页跳转过来时，自动切换到「创建作品」tab
  if (route.query.tab === 'create') {
    activeTab.value = 'create'
  }
})
</script>

<style scoped>
.compositions-view { padding: 20px; }
.pagination-bar { display: flex; justify-content: flex-end; margin-top: 12px; }
</style>
