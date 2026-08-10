import { http } from './http'
import type { CallbackRule, CallbackLog, PageResp } from '@/types/api'

export const callbacksApi = {
  // Rules
  listRules: (params?: { page?: number; pageSize?: number }) =>
    http.get<PageResp<CallbackRule>>('/callbacks/rules', params),

  createRule: (data: { planId: string; callbackUrl: string; events: string[]; status?: 'active' | 'inactive' }) =>
    http.post<CallbackRule>('/callbacks/rules', data),

  updateRule: (id: string, data: { callbackUrl?: string; events?: string[]; status?: 'active' | 'inactive' }) =>
    http.patch<CallbackRule>(`/callbacks/rules/${id}`, data),

  deleteRule: (id: string) =>
    http.del<void>(`/callbacks/rules/${id}`),

  // Secret key
  getSecret: () =>
    http.get<{ secret: string }>('/callbacks/secret'),

  rotateSecret: () =>
    http.post<{ secret: string }>('/callbacks/secret/rotate'),

  // Logs
  listLogs: (params?: { page?: number; pageSize?: number; status?: 'success' | 'failed' | 'retry' }) =>
    http.get<PageResp<CallbackLog>>('/callbacks/logs', params),
}
