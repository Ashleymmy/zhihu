/**
 * 内容标签 Store
 * 来源：docs/03-接口文档.md § 十三
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getContentTag, batchQueryContentTags } from '@/services/content-tag.service'
import { getBatchTaskResult, downloadBlob } from '@/services/batch.service'
import { ContentTagType } from '@/constants/enums'
import { ElMessage } from 'element-plus'
import type { ContentTagResult } from '@/types/models'

export const useContentTagStore = defineStore('contentTag', () => {
  // ─── § 13.1 单个查询 ───────────────────────────────────────────────────────
  const singleResult = ref<ContentTagResult | null>(null)
  const singleLoading = ref(false)

  async function querySingle(url: string, tagTypes?: ContentTagType[]): Promise<void> {
    singleLoading.value = true
    singleResult.value = null
    try {
      singleResult.value = await getContentTag(url, tagTypes)
    } finally {
      singleLoading.value = false
    }
  }

  // ─── § 13.2 批量查询 ───────────────────────────────────────────────────────
  const batchLoading = ref(false)
  const batchPolling = ref(false)

  async function submitBatch(file: File): Promise<void> {
    batchLoading.value = true
    try {
      const res = await batchQueryContentTags(file)
      ElMessage.success('批量标签查询任务已提交，等待结果...')
      batchPolling.value = true
      for (let i = 0; i < 30; i++) {
        try {
          const blob = await getBatchTaskResult(res.batch_task_id)
          downloadBlob(blob, `内容标签批量结果_${res.batch_task_id}.xlsx`)
          ElMessage.success('结果已下载')
          return
        } catch {
          await new Promise(r => setTimeout(r, 3000))
        }
      }
      ElMessage.warning('轮询超时，请稍后手动查询')
    } finally {
      batchLoading.value = false
      batchPolling.value = false
    }
  }

  return { singleResult, singleLoading, querySingle, batchLoading, batchPolling, submitBatch }
})
