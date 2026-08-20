/**
 * 风险举报类型
 * 来源：docs/03-接口文档.md § 十四
 */
import type { PaginationQuery, Pagination } from './common'
import type {
  RiskType, ReportDataView, AuditStatusQuery, AuditStatusResponse,
} from '@/constants/enums'

// ─── § 14.1 提交风险词 ───────────────────────────────────────────────────────
export interface SubmitRiskWordRequest {
  keyword:        string
  risk_type:      RiskType
  composition_id: string
  /**
   * 举报截图 token，由 § 15.1 获取，多个逗号分隔，最多 3 张。
   * ⚠️ 参与签名，原样传字符串不要编码
   */
  image_tokens:   string
  /**
   * 风险 URL。
   * ⚠️ risk_type=1（截流词）可选；risk_type=2（搬运词）必填。
   */
  risk_url?:      string
  damage_keyword?: string
}

// ─── § 14.2 获取风险词列表 ───────────────────────────────────────────────────
export interface GetRiskWordsQuery extends PaginationQuery {
  type?:      ReportDataView
  keyword?:   string
  risk_type?: RiskType
  /**
   * ⚠️ 请求用 1/2/3（AuditStatusQuery），返回是 0/1/2（AuditStatusResponse）
   */
  status?:    AuditStatusQuery
}

export interface RiskWord {
  type:           number
  risk_type:      RiskType
  keyword:        string
  channel:        string
  create_channel: string
  /** ⚠️ 返回用 0/1/2，见 § 2.9 */
  status:         AuditStatusResponse
  valided_at:     string
}

export interface RiskWordsResponse {
  data:       RiskWord[]
  pagination: Pagination
}
