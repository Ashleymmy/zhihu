import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { allianceCompositionApi, allianceBatchApi } from '@/api/alliance'
import type { CompositionListItem, CreateCompositionReq } from '@/api/alliance'
import { createCompositionQuerySnapshot, normalizeCompositionItems } from '@/utils/compositionList'
import { message } from 'ant-design-vue'

export const useZCompositionStore = defineStore('zComposition', () => {
  const items         = ref<CompositionListItem[]>([])
  const loading       = ref(false)
  const creating      = ref(false)
  const updating      = ref(false)
  const total         = ref(0)
  const offset        = ref(0)
  const limit         = ref(20)
  const lastQuery     = ref<{ channel_id: string; keyword: string } | null>(null)
  const current       = computed(() => Math.floor(offset.value / limit.value) + 1)
  const batchUploading = ref(false)
  const batchPolling  = ref(false)

  async function fetchList(query: { channel_id: string; keyword: string }) {
    const snapshot = createCompositionQuerySnapshot(query)
    loading.value = true; lastQuery.value = snapshot; offset.value = 0
    try {
      const res = await allianceCompositionApi.listCompositions({ ...snapshot, offset: 0, limit: limit.value })
      const nextItems = normalizeCompositionItems<CompositionListItem>(res.data)
      items.value = nextItems
      offset.value = typeof res.pagination?.offset === 'number' ? res.pagination.offset : 0
      total.value = res.pagination?.total ?? nextItems.length
      return nextItems
    } finally { loading.value = false }
  }

  async function fetchPage(page: number) {
    if (!lastQuery.value) return
    const requestedOffset = (page - 1) * limit.value
    loading.value = true; offset.value = requestedOffset
    try {
      const res = await allianceCompositionApi.listCompositions({ ...lastQuery.value, offset: requestedOffset, limit: limit.value })
      const nextItems = normalizeCompositionItems<CompositionListItem>(res.data)
      items.value = nextItems
      offset.value = typeof res.pagination?.offset === 'number' ? res.pagination.offset : requestedOffset
      total.value = res.pagination?.total ?? nextItems.length
      return nextItems
    } finally { loading.value = false }
  }

  async function submitCreate(req: CreateCompositionReq): Promise<string> {
    creating.value = true
    try {
      const res = await allianceCompositionApi.createComposition(req)
      message.success(`作品创建成功！ID: ${res.composition_id}`)
      return res.composition_id
    } finally { creating.value = false }
  }

  async function submitUpdate(id: string, req: Partial<CreateCompositionReq>) {
    updating.value = true
    try {
      await allianceCompositionApi.updateComposition(id, req)
      message.success('作品已更新')
      if (lastQuery.value) await fetchList(lastQuery.value)
    } finally { updating.value = false }
  }

  async function submitBatch(file: File, fields: { bind_type: number; channel_id: string }) {
    batchUploading.value = true
    try {
      const { batch_task_id } = await allianceCompositionApi.batchCreateCompositions(file, fields)
      batchUploading.value = false; batchPolling.value = true
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          const blob = await allianceBatchApi.getResult(batch_task_id)
          allianceBatchApi.downloadBlob(blob, '批量创建作品结果.xlsx')
          message.success('批量任务完成，结果已下载'); return
        } catch { /* 继续等待 */ }
      }
      message.error('批量任务超时')
    } finally { batchUploading.value = false; batchPolling.value = false }
  }

  return { items, loading, creating, updating, total, offset, limit, current, lastQuery, batchUploading, batchPolling, fetchList, fetchPage, submitCreate, submitUpdate, submitBatch }
})
