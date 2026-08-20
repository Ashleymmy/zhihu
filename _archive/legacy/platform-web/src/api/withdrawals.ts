import { http } from './http'
import type { Withdrawal, CreateWithdrawalReq, PageResp } from '@/types/api'

export const withdrawalsApi = {
  list: (params?: { page?: number; pageSize?: number; status?: 'pending' | 'approved' | 'rejected' }) =>
    http.get<PageResp<Withdrawal>>('/withdrawals', params),

  create: (data: CreateWithdrawalReq) =>
    http.post<Withdrawal>('/withdrawals', data),

  approve: (id: string) =>
    http.post<Withdrawal>(`/withdrawals/${id}/approve`),

  reject: (id: string, remark: string) =>
    http.post<Withdrawal>(`/withdrawals/${id}/reject`, { remark }),
}
