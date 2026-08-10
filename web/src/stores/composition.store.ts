/**
 * 推广作品 Store
 * 来源：docs/03-接口文档.md § 四
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  createComposition,
  updateComposition,
  listCompositions,
  batchCreateCompositions,
} from '@/services/composition.service'
import { getBatchTaskResult, downloadBlob } from '@/services/batch.service'
import { ElMessage } from 'element-plus'
import type {
  CompositionListItem,
  CreateCompositionV2Request,
  GetCompositionListQuery,
  BatchCreateCompositionV2FormFields,
} from '@/types/models'

export const useCompositionStore = defineStore('composition', () => {
  // ─── 列表 ──────────────────────────────────────────────────────────────────
  const items = ref<CompositionListItem[]>([])
  const loading = ref(false)
  const total = ref(0)
  const offset = ref(0)
  const limit = ref(20)
  const lastQuery = ref<GetCompositionListQuery | null>(null)

  async function fetchList(query: GetCompositionListQuery): Promise<void> {
    loading.value = true
    lastQuery.value = query
    try {
      const res = await listCompositions(query)
      items.value = res.data
      total.value = res.pagination.total
      offset.value = res.pagination.offset
    } finally {
      loading.value = false
    }
  }

  async function fetchPage(page: number): Promise<void> {
    if (!lastQuery.value) return
    await fetchList({ ...lastQuery.value, offset: (page - 1) * limit.value, limit: limit.value })
  }

  // ─── 创建 ──────────────────────────────────────────────────────────────────
  const creating = ref(false)

  async function submitCreate(req: CreateCompositionV2Request): Promise<string> {
    creating.value = true
    try {
      const res = await createComposition(req)
      ElMessage.success(`作品创建成功，ID：${res.composition_id}`)
      return res.composition_id
    } finally {
      creating.value = false
    }
  }

  // ─── 更新 ──────────────────────────────────────────────────────────────────
  const updating = ref(false)

  async function submitUpdate(
    compositionId: string,
    req: CreateCompositionV2Request,
  ): Promise<void> {
    updating.value = true
    try {
      await updateComposition(compositionId, req)
      ElMessage.success('作品更新成功')
      // 刷新当前列表
      if (lastQuery.value) await fetchList(lastQuery.value)
    } finally {
      updating.value = false
    }
  }

  // ─── 批量创建 ──────────────────────────────────────────────────────────────
  const batchUploading = ref(false)
  const batchPolling = ref(false)

  async function submitBatch(
    file: File,
    fields: BatchCreateCompositionV2FormFields,
  ): Promise<void> {
    batchUploading.value = true
    try {
      const res = await batchCreateCompositions(file, fields)
      ElMessage.success('批量任务已提交，等待结果...')
      batchPolling.value = true
      for (let i = 0; i < 30; i++) {
        try {
          const blob = await getBatchTaskResult(res.batch_task_id)
          downloadBlob(blob, `批量作品结果_${res.batch_task_id}.xlsx`)
          ElMessage.success('结果已下载')
          return
        } catch {
          await new Promise(r => setTimeout(r, 3000))
        }
      }
      ElMessage.warning('轮询超时，请稍后手动查询结果')
    } finally {
      batchUploading.value = false
      batchPolling.value = false
    }
  }

  return {
    items, loading, total, offset, limit,
    fetchList, fetchPage,
    creating, submitCreate,
    updating, submitUpdate,
    batchUploading, batchPolling, submitBatch,
  }
})
