import { http } from './http'
import type {
  EarningsListReq,
  EarningsListResp,
  EarningsSummaryResp,
} from '@/types/api'

export const earningsApi = {
  list: (params?: EarningsListReq) =>
    http.get<EarningsListResp>('/earnings', params),

  summary: () =>
    http.get<EarningsSummaryResp>('/earnings/summary'),
}
