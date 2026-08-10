/**
 * 内容标签服务
 * 来源：docs/03-接口文档.md § 十三
 */
import { apiGet, apiPost } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import { ContentTagType } from '@/constants/enums'
import type { ContentTagResult, BatchContentTagResponse } from '@/types/models'

/**
 * § 13.1 单个内容标签查询
 *
 * ⚠️ 返回的 JSON key 是中文（'兴趣', '一级领域', '内容等级'）。
 * ⚠️ 仅支持回答和文章链接，不支持其他内容类型。
 */
export function getContentTag(
  url: string,
  tagTypes: ContentTagType[] = [
    ContentTagType.Interest,
    ContentTagType.FirstCategory,
    ContentTagType.ContentLevel,
  ],
): Promise<ContentTagResult> {
  return apiGet<ContentTagResult>(API_PATHS.CONTENT_TAG, {
    params: { url, tags: tagTypes.join(',') },
  })
}

/**
 * § 13.2 内容标签批量查询（Form-Data，异步）
 *
 * 返回 batch_task_id，结果查 § 6.1。使用模板 3。
 */
export function batchQueryContentTags(file: File): Promise<BatchContentTagResponse> {
  const formData = new FormData()
  formData.append('file', file)
  return apiPost<BatchContentTagResponse>(API_PATHS.CONTENT_TAGS, formData, {
    headers: {
      'X-Requested-With': 'openApi',
      'Content-Type': 'multipart/form-data',
    },
  })
}
