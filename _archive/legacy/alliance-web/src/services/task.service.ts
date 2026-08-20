/**
 * 推广任务服务
 * 来源：docs/03-接口文档.md § 七
 *
 * PopularizeTask（推广任务）包含 task_id，是创建推广计划的必需前置数据。
 */
import { apiGet } from '@/infra/http'
import { API_PATHS } from '@/constants/api-paths'
import type {
  GetPopularizeTasksQuery,
  PopularizeTaskListResponse,
} from '@/types/models'

/**
 * § 7.1 查询推广任务列表
 *
 * ⚠️ 返回的 data 可能为 null，调用方必须兜底。
 * ⚠️ 返回的字段名是 `id`，不是 `task_id`。传给创建计划接口时要映射。
 */
export function getPopularizeTasks(
  query: GetPopularizeTasksQuery,
): Promise<PopularizeTaskListResponse> {
  return apiGet<PopularizeTaskListResponse>(API_PATHS.POPULARIZE_TASKS, {
    params: query,
  })
}
