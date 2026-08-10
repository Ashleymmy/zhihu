import { http } from './http'
import type {
  OverviewResp,
  TrendReq,
  TrendResp,
  KeywordMetricsReq,
  KeywordMetricsResp,
} from '@/types/api'

export const metricsApi = {
  // No filter params — backend applies scope from JWT
  overview: () =>
    http.get<OverviewResp>('/metrics/overview'),

  // from/to instead of start_date/end_date
  trend: (params?: TrendReq) =>
    http.get<TrendResp>('/metrics/trend', params),

  byKeyword: (params?: KeywordMetricsReq) =>
    http.get<KeywordMetricsResp>('/metrics/by-keyword', params),
}
