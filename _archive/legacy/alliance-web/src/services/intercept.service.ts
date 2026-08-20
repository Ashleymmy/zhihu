/**
 * 评论截流举报服务
 * 来源：docs/03-接口文档.md § 十一
 */
import { apiGet, apiPost } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  SubmitInterceptWordRequest,
  GetInterceptWordsQuery,
  InterceptWordsResponse,
} from '@/types/models'

/** § 11.2 评论截流词举报（⚠️ 不可撤销，UI 需二次确认） */
export function submitInterceptWord(
  req: SubmitInterceptWordRequest,
): Promise<void> {
  return apiPost<void>(API_PATHS.INTERCEPT_WORDS, req)
}

/** § 11.3 查询评论截流词列表 */
export function getInterceptWords(
  query: GetInterceptWordsQuery,
): Promise<InterceptWordsResponse> {
  return apiGet<InterceptWordsResponse>(API_PATHS.INTERCEPT_WORDS, { params: query })
}
