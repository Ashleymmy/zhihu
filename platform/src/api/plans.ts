import { http } from './http'
import type {
  Plan,
  PlanListReq,
  PlanListResp,
  CreatePlanReq,
  UpdatePlanReq,
  CheckKeywordReq,
  CheckKeywordResp,
} from '@/types/api'

export const plansApi = {
  list: (params?: PlanListReq) =>
    http.get<PlanListResp>('/plans', params as Record<string, unknown>),

  get: (id: string) =>
    http.get<Plan>(`/plans/${id}`),

  create: (data: CreatePlanReq) =>
    http.post<Plan>('/plans', data),

  update: (id: string, data: UpdatePlanReq) =>
    http.patch<Plan>(`/plans/${id}`, data),

  checkKeyword: (data: CheckKeywordReq) =>
    http.post<CheckKeywordResp>('/plans/check-keyword', data),
}
