/**
 * 推广计划 Store
 * 来源：docs/03-接口文档.md § 三
 *
 * 计划只有「创建」接口，无列表，主要管理创建状态和结果。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createPlan, batchCreatePlans } from '@/services/plan.service'
import { getBatchTaskResult, downloadBlob } from '@/services/batch.service'
import { ElMessage } from 'element-plus'
import type { CreatePlanRequest, BatchCreatePlanFormFields } from '@/types/models'

export const usePlanStore = defineStore('plan', () => {
  // ─── 单个创建 ─────────────────────────────────────────────────────────────
  const creating = ref(false)
  const lastPlanId = ref<string>('')
  /** 与 lastPlanId 配套，记录计划所属的渠道，创建作品时必须使用同一 channel_id */
  const lastChannelId = ref<string>('')

  async function submitCreatePlan(req: CreatePlanRequest): Promise<string> {
    creating.value = true
    try {
      const res = await createPlan(req)
      lastPlanId.value = res.plan_id
      lastChannelId.value = req.channel_id   // ← 同步保存，供跳转至作品页预填
      ElMessage.success(`创建成功，计划 ID：${res.plan_id}`)
      return res.plan_id
    } finally {
      creating.value = false
    }
  }

  // ─── 批量创建 ─────────────────────────────────────────────────────────────
  const batchUploading = ref(false)
  const batchPolling = ref(false)
  const batchTaskId = ref<string>('')

  async function submitBatchCreate(
    file: File,
    fields: BatchCreatePlanFormFields,
  ): Promise<void> {
    batchUploading.value = true
    try {
      const res = await batchCreatePlans(file, fields)
      batchTaskId.value = res.batch_task_id
      ElMessage.success('批量任务已提交，正在等待结果...')
      await pollBatchResult(res.batch_task_id)
    } finally {
      batchUploading.value = false
    }
  }

  /** 轮询批量任务结果（任务未完成时接口报错，等待后重试） */
  async function pollBatchResult(taskId: string, maxRetries = 30): Promise<void> {
    batchPolling.value = true
    try {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const blob = await getBatchTaskResult(taskId)
          downloadBlob(blob, `批量计划结果_${taskId}.xlsx`)
          ElMessage.success('批量结果已下载')
          return
        } catch {
          // 任务未完成，等 3s 后重试
          await new Promise(r => setTimeout(r, 3000))
        }
      }
      ElMessage.error('轮询超时，请稍后手动重试')
    } finally {
      batchPolling.value = false
    }
  }

  return {
    creating, lastPlanId, lastChannelId, submitCreatePlan,
    batchUploading, batchPolling, batchTaskId, submitBatchCreate,
  }
})
