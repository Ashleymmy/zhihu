/**
 * 推广计划服务
 * 来源：docs/03-接口文档.md § 三
 */
import { apiPost } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  CreatePlanRequest,
  CreatePlanResponse,
  BatchCreatePlanResponse,
  BatchCreatePlanFormFields,
} from '@/types/models'

/**
 * § 3.1 单个创建推广计划
 *
 * ⚠️ keyword 仅支持单个关键词，不含逗号/空格。
 * ⚠️ second_channel_id 不参与签名（签名拦截器已处理）。
 */
export function createPlan(req: CreatePlanRequest): Promise<CreatePlanResponse> {
  return apiPost<CreatePlanResponse>(API_PATHS.PLAN_CREATE, req)
}

/**
 * § 3.2 批量创建推广计划（Form-Data）
 *
 * 异步接口，返回 batch_task_id，需轮询 § 6.1 获取结果。
 * 完整流程封装在 composables/useBatchUpload.ts（见架构设计文档）。
 */
export function batchCreatePlans(
  file: File,
  fields: BatchCreatePlanFormFields,
): Promise<BatchCreatePlanResponse> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('task_id', fields.task_id)
  formData.append('channel_id', fields.channel_id)
  formData.append('popularize_type', String(fields.popularize_type))
  if (fields.second_channel_id) {
    formData.append('second_channel_id', fields.second_channel_id)
  }

  return apiPost<BatchCreatePlanResponse>(API_PATHS.PLAN_BATCH_CREATE, formData, {
    headers: {
      'X-Requested-With': 'openApi',
      'Content-Type': 'multipart/form-data',
    },
  })
}
