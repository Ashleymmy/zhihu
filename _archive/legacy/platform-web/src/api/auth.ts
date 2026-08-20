import { http } from './http'
import type { LoginReq, LoginResp, MeResp, ChangePasswordReq } from '@/types/api'

export const authApi = {
  login: (data: LoginReq) =>
    http.post<LoginResp>('/auth/login', data),

  me: () =>
    http.get<MeResp>('/auth/me'),

  logout: () =>
    http.post<void>('/auth/logout'),

  changePassword: (data: ChangePasswordReq) =>
    http.post<void>('/auth/change-password', data),
}
