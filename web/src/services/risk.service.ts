/**
 * 风险举报服务
 * 来源：docs/03-接口文档.md § 十四
 */
import { apiGet, apiPost } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  SubmitRiskWordRequest,
  GetRiskWordsQuery,
  RiskWordsResponse,
} from '@/types/models'

/** § 14.1 提交风险词（⚠️ 不可撤销，UI 需二次确认） */
export function submitRiskWord(req: SubmitRiskWordRequest): Promise<void> {
  return apiPost<void>(API_PATHS.RISK_WORDS, req)
}

/** § 14.2 获取风险词列表 */
export function getRiskWords(query: GetRiskWordsQuery): Promise<RiskWordsResponse> {
  return apiGet<RiskWordsResponse>(API_PATHS.RISK_WORDS, { params: query })
}
