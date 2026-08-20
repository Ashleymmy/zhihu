/**
 * 推广作品类型
 * 来源：docs/03-接口文档.md § 四
 *
 * 只对接 v2 接口（§ 4.1 ~ § 4.4）。v1（§ 4.5~§ 4.8）2026-08-25 下线，不实现。
 */
import type { PaginationQuery, BatchTaskResponse } from './common'
import type { MediaType, CompositionType, CompositionSubType } from '@/constants/enums'

// ─── § 4.1 单个创建推广作品（v2）────────────────────────────────────────────
export interface CreateCompositionV2Request {
  plan_id:                string
  channel_id:             string
  /** 媒体类型，传中文原文，见 § 2.1 */
  media_type:             MediaType
  media_account:          string
  /** 作品一级分类，见 § 2.2 */
  composition_type:       CompositionType
  /** 作品二级分类，必填且参与签名；必须与一级分类合法组合，见 § 2.3 */
  composition_sub_type:   CompositionSubType
  composition_url:        string
  /** 作品在第三方平台的发布时间，秒级时间戳（≠ 当前 timestamp） */
  release_time:           number
}

export interface CreateCompositionResponse {
  composition_id: string
}

// ─── § 4.2 批量创建推广作品（v2，Form-Data） ────────────────────────────────
export interface BatchCreateCompositionV2FormFields {
  /** 绑定类型，决定 Excel 第一列语义，见 § 2.5 */
  bind_type:   number
  channel_id:  string
}

/** § 4.2 返回 batch_task_id，查 § 6.1 获取结果 */
export type BatchCreateCompositionV2Response = BatchTaskResponse

// ─── § 4.3 单个更新推广作品（v2）────────────────────────────────────────────
/**
 * ⚠️ 业务限制：只有「审核未通过」的作品可更新。
 * composition_id 放在 URL 路径，body 中填剩余字段。
 */
export type UpdateCompositionV2Request = CreateCompositionV2Request

// ─── § 4.4 查询推广作品列表（v2）────────────────────────────────────────────
export interface GetCompositionListQuery extends PaginationQuery {
  channel_id: string
  /** 必填；按关键词查询，无法查全部 */
  keyword:    string
}

/** § 4.4 返回结构（无 media_type/media_account/release_time，更新前需用户手动补齐）*/
export interface CompositionListItem {
  keyword:              string
  popularize_task:      string
  popularize_channel:   string
  create_channel:       string
  composition_id:       string
  composition_url:      string
  submit_time:          string
  /** v2 新增 */
  composition_type:     CompositionType
  /** v2 新增 */
  composition_sub_type: CompositionSubType
}

/**
 * § 4.4 分页（⚠️ 此接口无 is_first / is_end 字段）
 */
export interface CompositionListPagination {
  total:  number
  offset: number
  limit:  number
}

export interface CompositionListResponse {
  data:       CompositionListItem[]
  pagination: CompositionListPagination
}
