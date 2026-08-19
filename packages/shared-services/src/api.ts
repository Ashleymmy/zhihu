import type {
  AddProjectCourseReq,
  AddProjectMemberReq,
  ChangePasswordReq,
  CreateMemberReq,
  CreateMemberResp,
  CreateWithdrawalReq,
  EarningRecord,
  EarningsStatus,
  EarningsSummary,
  LoginReq,
  LoginResp,
  McnAccount,
  MeResp,
  MetricsOverview,
  PageResp,
  Plan,
  PlanListReq,
  Project,
  ProjectCourse,
  ProjectMember,
  RefreshResp,
  TeamMember,
  TrendPoint,
  UpdatePlanReq,
  Withdrawal,
  WithdrawalStatus,
} from '@zhihu-koc/shared-contracts'
import type { HttpClient } from './http'

/** 领域 API 只描述端点形状，不含 Router / View / Store 逻辑。 */

export function createAuthApi(http: HttpClient) {
  return {
    login: (data: LoginReq) => http.post<LoginResp>('/auth/login', data),
    refresh: () => http.post<RefreshResp>('/auth/refresh'),
    me: () => http.get<MeResp>('/auth/me'),
    logout: () => http.post<void>('/auth/logout'),
    changePassword: (data: ChangePasswordReq) => http.post<void>('/auth/change-password', data),
  }
}

export function createMcnApi(http: HttpClient) {
  return {
    list: () => http.get<McnAccount[]>('/mcn-accounts'),
    create: (data: { accountKey: string; accountName: string; ownerUserId?: string }) =>
      http.post<McnAccount>('/mcn-accounts', data),
  }
}

export function createProjectsApi(http: HttpClient) {
  return {
    list: () => http.get<Project[]>('/projects'),

    listMembers: (projectId: string) => http.get<ProjectMember[]>(`/projects/${projectId}/members`),
    addMember: (projectId: string, data: AddProjectMemberReq) =>
      http.post<ProjectMember>(`/projects/${projectId}/members`, data),
    removeMember: (projectId: string, userId: string) =>
      http.del<void>(`/projects/${projectId}/members/${userId}`),

    listCourses: (projectId: string) => http.get<ProjectCourse[]>(`/projects/${projectId}/courses`),
    addCourse: (projectId: string, data: AddProjectCourseReq) =>
      http.post<ProjectCourse>(`/projects/${projectId}/courses`, data),
    removeCourse: (projectId: string, courseId: string) =>
      http.del<void>(`/projects/${projectId}/courses/${courseId}`),
  }
}

export function createTeamApi(http: HttpClient) {
  return {
    listMembers: () => http.get<TeamMember[]>('/team/members'),
    createMember: (data: CreateMemberReq) => http.post<CreateMemberResp>('/team/members', data),
    updateMember: (id: string, data: { displayName?: string; phone?: string | null }) =>
      http.patch<void>(`/team/members/${id}`, data),
    resetPassword: (id: string) => http.post<{ temporaryPassword: string }>(`/team/members/${id}/reset-password`),
    disableMember: (id: string) => http.post<void>(`/team/members/${id}/disable`),
  }
}

export function createPlansApi(http: HttpClient) {
  return {
    list: (params: PlanListReq = {}) => http.get<PageResp<Plan>>('/plans', params),
    get: (id: string) => http.get<Plan>(`/plans/${id}`),
    update: (id: string, data: UpdatePlanReq) => http.put<Plan>(`/plans/${id}`, data),
    remove: (id: string) => http.del<void>(`/plans/${id}`),
    retry: (id: string) => http.post<Plan>(`/plans/${id}/retry`),
  }
}

export function createMetricsApi(http: HttpClient) {
  return {
    overview: () => http.get<MetricsOverview>('/metrics/overview'),
    trend: (params: { from?: string; to?: string } = {}) => http.get<TrendPoint[]>('/metrics/trend', params),
  }
}

export function createEarningsApi(http: HttpClient) {
  return {
    list: (params: { page?: number; pageSize?: number; status?: EarningsStatus } = {}) =>
      http.get<PageResp<EarningRecord>>('/earnings', params),
    summary: () => http.get<EarningsSummary>('/earnings/summary'),
  }
}

export function createWithdrawalsApi(http: HttpClient) {
  return {
    list: (params: { page?: number; pageSize?: number; status?: WithdrawalStatus } = {}) =>
      http.get<PageResp<Withdrawal>>('/withdrawals', params),
    /** 财务链未开放时服务端以 50310 拒绝（failedGates 透传到 ApiError）。 */
    apply: (data: CreateWithdrawalReq) => http.post<Withdrawal>('/withdrawals', data),
    approve: (id: string) => http.post<Withdrawal>(`/withdrawals/${id}/approve`),
    reject: (id: string, remark: string) => http.post<Withdrawal>(`/withdrawals/${id}/reject`, { remark }),
  }
}

export interface ApiBundle {
  auth: ReturnType<typeof createAuthApi>
  mcn: ReturnType<typeof createMcnApi>
  projects: ReturnType<typeof createProjectsApi>
  team: ReturnType<typeof createTeamApi>
  plans: ReturnType<typeof createPlansApi>
  metrics: ReturnType<typeof createMetricsApi>
  earnings: ReturnType<typeof createEarningsApi>
  withdrawals: ReturnType<typeof createWithdrawalsApi>
}

export function createApis(http: HttpClient): ApiBundle {
  return {
    auth: createAuthApi(http),
    mcn: createMcnApi(http),
    projects: createProjectsApi(http),
    team: createTeamApi(http),
    plans: createPlansApi(http),
    metrics: createMetricsApi(http),
    earnings: createEarningsApi(http),
    withdrawals: createWithdrawalsApi(http),
  }
}
