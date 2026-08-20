import { http } from './http'
import type { Channel, PageResp } from '@/types/api'

export const channelsApi = {
  // Backend returns paginated list; caller maps .list for use as option arrays
  list: (params?: { page?: number; pageSize?: number }) =>
    http.get<PageResp<Channel>>('/channels', params),

  sync: () =>
    http.post<{ jobId: string; status: string }>('/channels/sync'),

  assignOwner: (id: string, ownerId: string | null) =>
    http.patch<{ id: string; ownerId: string | null }>(`/channels/${id}/owner`, { ownerId }),
}
