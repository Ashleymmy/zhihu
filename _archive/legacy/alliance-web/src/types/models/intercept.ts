/**
 * 评论截流举报类型
 * 来源：docs/03-接口文档.md § 十一
 */
import type { PaginationQuery, Pagination } from './common'
import type { ReportDataView, AuditStatusQuery, AuditStatusResponse } from '@/constants/enums'

// ─── § 11.1 评论截流截图上传 ──────────────────────────────────────────────────
/** 建议统一使用 § 15.1 基础文件上传，功能更全（额外返回 file_url）*/
export interface UploadInterceptImageResponse {
  image_token: string
}

// ─── § 11.2 评论截流词举报 ────────────────────────────────────────────────────
export interface SubmitInterceptWordRequest {
  composition_id: string
  keyword:        string
  /**
   * 截图 token，多个用英文逗号分隔，最多 3 张。
   * ⚠️ 是字符串，不是数组；参与签名；前端需 tokens.join(',')
   */
  image_tokens:   string
}

// ─── § 11.3 查询评论截流词列表 ────────────────────────────────────────────────
export interface GetInterceptWordsQuery extends PaginationQuery {
  /** 数据视角，见 § 2.8 */
  type?:    ReportDataView
  keyword?: string
  /**
   * 审核状态筛选。
   * ⚠️ 请求用 1/2/3（AuditStatusQuery），返回是 0/1/2（AuditStatusResponse）
   */
  status?:  AuditStatusQuery
}

export interface InterceptWord {
  type:           number
  keyword:        string
  channel:        string
  create_channel: string
  /** ⚠️ 返回用 0/1/2，与请求参数的 1/2/3 不同，见 § 2.9 */
  status:         AuditStatusResponse
  valided_at:     string
}

export interface InterceptWordsResponse {
  data:       InterceptWord[]
  pagination: Pagination
}
