/**
 * 推广作品服务（v2）
 * 来源：docs/03-接口文档.md § 四（§ 4.1–§ 4.4）
 *
 * v1 接口（§ 4.5–§ 4.8）2026-08-25 下线，不实现。
 */
import { apiGet, apiPost, apiPut } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  CreateCompositionV2Request,
  CreateCompositionResponse,
  UpdateCompositionV2Request,
  GetCompositionListQuery,
  CompositionListResponse,
  BatchCreateCompositionV2FormFields,
  BatchCreateCompositionV2Response,
} from '@/types/models'
import { BindType } from '@/constants/enums'

/**
 * § 4.1 单个创建推广作品（v2）
 *
 * ⚠️ composition_sub_type 必须与 composition_type 合法组合（见 § 2.3）。
 * ⚠️ composition_sub_type 参与签名（签名拦截器已处理）。
 */
export function createComposition(
  req: CreateCompositionV2Request,
): Promise<CreateCompositionResponse> {
  return apiPost<CreateCompositionResponse>(API_PATHS.COMPOSITION_V2_CREATE, req)
}

/**
 * § 4.2 批量创建推广作品（v2，Form-Data）
 *
 * 异步接口，返回 batch_task_id，结果查 § 6.1。
 * ⚠️ 用模板 4，不能用 v1 模板 2。
 */
export function batchCreateCompositions(
  file: File,
  fields: BatchCreateCompositionV2FormFields,
): Promise<BatchCreateCompositionV2Response> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('bind_type', String(fields.bind_type ?? BindType.PlanId))
  formData.append('channel_id', fields.channel_id)

  return apiPost<BatchCreateCompositionV2Response>(
    API_PATHS.COMPOSITION_V2_BATCH_CREATE,
    formData,
    {
      headers: {
        'X-Requested-With': 'openApi',
        'Content-Type': 'multipart/form-data',
      },
    },
  )
}

/**
 * § 4.3 单个更新推广作品（v2）
 *
 * ⚠️ 业务限制：只有「审核未通过」的作品可以更新。
 * ⚠️ 全量更新，不支持部分字段更新。
 */
export function updateComposition(
  compositionId: string,
  req: UpdateCompositionV2Request,
): Promise<void> {
  return apiPut<void>(API_PATHS.COMPOSITION_V2_UPDATE(compositionId), req)
}

/**
 * § 4.4 查询推广作品列表（v2）
 *
 * ⚠️ channel_id 和 keyword 均必填，无法查全部作品。
 * ⚠️ 返回的 pagination 没有 is_first / is_end 字段。
 */
export function listCompositions(
  query: GetCompositionListQuery,
): Promise<CompositionListResponse> {
  return apiGet<CompositionListResponse>(API_PATHS.COMPOSITION_V2_LIST, {
    params: query,
  })
}
