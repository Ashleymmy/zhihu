import { defineStore } from 'pinia'
import { ref } from 'vue'
import { alliancePlanApi, allianceBatchApi } from '@/api/alliance'
import type { CreatePlanReq } from '@/api/alliance'
import { message } from 'ant-design-vue'

export const useZPlanStore = defineStore('zPlan', () => {
  const creating      = ref(false)
  const lastPlanId    = ref('')
  const lastChannelId = ref('')
  const batchUploading = ref(false)
  const batchPolling  = ref(false)

  async function submitCreatePlan(req: CreatePlanReq) {
    creating.value = true
    try {
      const res = await alliancePlanApi.createPlan(req)
      lastPlanId.value    = res.plan_id
      lastChannelId.value = req.channel_id
      message.success(`计划创建成功！Plan ID: ${res.plan_id}`)
    } catch { /* error handled by interceptor */ } finally { creating.value = false }
  }

  async function submitBatchCreate(file: File, fields: { task_id: string; channel_id: string; popularize_type: number }) {
    batchUploading.value = true
    try {
      const { batch_task_id } = await alliancePlanApi.batchCreatePlans(file, fields)
      batchUploading.value = false
      batchPolling.value = true
      await pollResult(batch_task_id, '批量创建计划结果.xlsx')
    } catch { /* error handled */ } finally { batchUploading.value = false; batchPolling.value = false }
  }

  async function pollResult(taskId: string, filename: string, maxRetry = 30, interval = 3000) {
    for (let i = 0; i < maxRetry; i++) {
      await new Promise(r => setTimeout(r, interval))
      try {
        const blob = await allianceBatchApi.getResult(taskId)
        allianceBatchApi.downloadBlob(blob, filename)
        message.success('批量任务完成，结果已下载')
        return
      } catch { /* 任务未完成，继续等待 */ }
    }
    message.error('批量任务超时，请稍后手动查询结果')
  }

  return { creating, lastPlanId, lastChannelId, batchUploading, batchPolling, submitCreatePlan, submitBatchCreate }
})
