import { http } from './http'
import type {
  TeamMember,
  CreateMemberReq,
  CreateMemberResp,
  ResetMemberPasswordResp,
  UpdateMemberReq,
} from '@/types/api'

export const teamApi = {
  list: () =>
    http.get<TeamMember[]>('/team/members'),

  create: (data: CreateMemberReq) =>
    http.post<CreateMemberResp>('/team/members', data),

  update: (id: string, data: UpdateMemberReq) =>
    http.patch<TeamMember>(`/team/members/${id}`, data),

  resetPassword: (id: string) =>
    http.post<ResetMemberPasswordResp>(`/team/members/${id}/reset-password`),

  remove: (id: string) =>
    http.del<void>(`/team/members/${id}`),
}
