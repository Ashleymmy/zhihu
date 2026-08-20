/**
 * 数据报表服务
 * 来源：docs/03-接口文档.md § 八
 *
 * ⚠️ § 8.1 time_range 在响应顶层，拦截器已特殊处理（返回完整 body）。
 */
import { apiGet } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type { GetRealTimeDataQuery, RealTimeDataResponse } from '@/types/models'
import { ReportDataType, ReportTimeScale } from '@/constants/enums'

/**
 * § 8.1 获取投放实时数据
 *
 * 注意事项（官方原文）：
 *  · 数据每小时更新一次，延迟约 3-4 小时
 *  · 仅供参考，不作为结算依据
 *  · 仅返回当天搜索量超过阈值的部分关键词
 */
export function getRealTimeData(
  query: GetRealTimeDataQuery,
): Promise<RealTimeDataResponse> {
  return apiGet<RealTimeDataResponse>(API_PATHS.REAL_TIME_DATA, {
    params: query,
  })
}

/** 获取常用默认查询参数（关键词维度，天级，全字段） */
export function defaultReportQuery(): GetRealTimeDataQuery {
  return {
    type:       ReportDataType.Keyword,
    time_scale: ReportTimeScale.Day,
    fields:     'search_num,order_num,created_at',
  }
}
