import { defineStore } from 'pinia'
import { ref } from 'vue'
import { allianceContentTagApi, allianceBatchApi } from '@/api/alliance'
import type { ContentTagResult } from '@/api/alliance'
import { message } from 'ant-design-vue'

export const useZContentTagStore = defineStore('zContentTag', () => {
  const singleResult  = ref<ContentTagResult | null>(null)
  const singleLoading = ref(false)
  const batchUploading = ref(false)
  const batchPolling  = ref(false)

  async function querySingle(url: string, tagTypes: number[]) {
    singleLoading.value = true; singleResult.value = null
    try { singleResult.value = await allianceContentTagApi.getTag(url, tagTypes) }
    finally { singleLoading.value = false }
  }

  async function submitBatch(file: File) {
    batchUploading.value = true
    try {
      const { batch_task_id } = await allianceContentTagApi.batchGetTags(file)
      batchUploading.value = false; batchPolling.value = true
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          const blob = await allianceBatchApi.getResult(batch_task_id)
          allianceBatchApi.downloadBlob(blob, '内容标签批量查询结果.xlsx')
          message.success('批量查询完成，结果已下载'); return
        } catch { /* 继续等待 */ }
      }
      message.error('批量任务超时')
    } finally { batchUploading.value = false; batchPolling.value = false }
  }

  return { singleResult, singleLoading, batchUploading, batchPolling, querySingle, submitBatch }
})
