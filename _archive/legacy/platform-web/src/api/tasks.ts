import { http } from './http'
import type { PageResp, Task } from '@/types/api'

export const tasksApi = {
  list: (params?: { page?: number; pageSize?: number; status?: string; keyword?: string }) =>
    http.get<PageResp<Task>>('/tasks', params),

  sync: () =>
    http.post<{ jobId: string; status: string }>('/tasks/sync'),
}
