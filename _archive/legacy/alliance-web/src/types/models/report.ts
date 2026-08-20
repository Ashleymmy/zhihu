/**
 * 数据报表类型
 * 来源：docs/03-接口文档.md § 八
 */
import type { ReportDataType, ReportTimeScale, ReportField } from '@/constants/enums'

// ─── § 8.1 获取投放实时数据 ───────────────────────────────────────────────────
export interface GetRealTimeDataQuery {
  /** 数据类型，见 § 2.11，目前固定 1（关键词维度）*/
  type:       ReportDataType
  /** 时间粒度，见 § 2.11，目前固定 1（天级）*/
  time_scale: ReportTimeScale
  /** 查询指标，多个用英文逗号分隔，见 § 2.11 */
  fields:     string
}

export interface RealTimeDataItem {
  keyword:      string
  channel_id:   string
  channel_name: string
  /** 动态字段，内容取决于请求的 fields 参数 */
  fields_data: Partial<{
    search_num: number
    order_num:  number
    created_at: string
  }>
}

/**
 * ⚠️ time_range 在响应的顶层，不在 data 里。
 * 响应拦截器剥 data 外壳时会丢掉它。
 * 服务层需在拦截器前先捕获完整响应，保留 time_range。
 */
export interface RealTimeDataResponse {
  /** 数据时间范围，格式 'yyyy-MM-dd HH:mm:ss ~ yyyy-MM-dd HH:mm:ss' */
  time_range: string
  data:       RealTimeDataItem[]
}
