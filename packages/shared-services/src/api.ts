import type {
  AddProjectCourseReq,
  AddProjectMemberReq,
  ApplyTeamReq,
  SettlementItem,
  SettlementBatchDetail,
  RelayLog,
  CreateSettlementBatchReq,
  CreatePricingRuleReq,
  PricingRule,
  SettlementBatch,
  ChangePasswordReq,
  Composition,
  CreateMemberReq,
  CreateMemberResp,
  CreateProjectReq,
  CreateWithdrawalReq,
  EarningRecord,
  EarningsStatus,
  EarningsSummary,
  LoginReq,
  LoginResp,
  LeaderOption,
  McnAccount,
  MeResp,
  MetricsOverview,
  MyTeamResp,
  PageResp,
  Plan,
  PlanListReq,
  Project,
  ProjectCourse,
  ProjectDetail,
  ProjectMember,
  RefreshResp,
  StoryItem,
  StoryItemType,
  TeamMember,
  TeamApplication,
  TrendPoint,
  UpdatePlanReq,
  UpdateProjectReq,
  Withdrawal,
  WithdrawalStatus,
  ZhihuTask,
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
    create: (data: CreateProjectReq) => http.post<ProjectDetail>('/projects', data),
    update: (projectId: string, data: UpdateProjectReq) =>
      http.patch<ProjectDetail>(`/projects/${projectId}`, data),
    disable: (projectId: string) => http.del<void>(`/projects/${projectId}`),

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

export function createFinanceApi(http: HttpClient) {
  return {
    listRules: () => http.get<PricingRule[]>('/finance/rules'),
    createRule: (data: CreatePricingRuleReq) => http.post<{ id: string }>('/finance/rules', data),
    disableRule: (id: string) => http.post<void>(`/finance/rules/${id}/disable`),
    listBatches: () => http.get<SettlementBatch[]>('/finance/batches'),
    getBatch: (id: string) => http.get<SettlementBatchDetail>(`/finance/batches/${id}`),
    createBatch: (data: CreateSettlementBatchReq) => http.post<{ id: string }>('/finance/batches', data),
    approveBatch: (id: string) => http.post<void>(`/finance/batches/${id}/approve`),
    cancelBatch: (id: string) => http.post<void>(`/finance/batches/${id}/cancel`),
  }
}

export function createTeamApi(http: HttpClient) {
  return {
    listMembers: () => http.get<TeamMember[]>('/team/members'),
    createMember: (data: CreateMemberReq) => http.post<CreateMemberResp>('/team/members', data),
    updateMember: (id: string, data: { displayName?: string; phone?: string | null }) =>
      http.patch<void>(`/team/members/${id}`, data),
    resetPassword: (id: string, password?: string) =>
      http.post<{ temporaryPassword: string | null; mustChangePwd: boolean }>(`/team/members/${id}/reset-password`, { password }),
    disableMember: (id: string) => http.post<void>(`/team/members/${id}/disable`),
    deleteMember: (id: string) => http.del<void>(`/team/members/${id}`),
    applyToTeam: (data: ApplyTeamReq) => http.post<{ id: string }>('/team/applications', data),
    listLeaders: () => http.get<LeaderOption[]>('/team/leaders'),
    myTeam: () => http.get<MyTeamResp | null>('/team/my'),
    myApplications: () => http.get<TeamApplication[]>('/team/applications/mine'),
    listApplications: () => http.get<TeamApplication[]>('/team/applications'),
    reviewApplication: (id: string, action: 'approve' | 'reject') =>
      http.post<void>(`/team/applications/${id}/review`, { action }),
    cancelApplication: (id: string) => http.post<void>(`/team/applications/${id}/cancel`),
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

export function createZhihuStoryApi(http: HttpClient) {
  return {
    /** 作品管理（compositions） */
    listWorks: (params: { page?: number; pageSize?: number; planId?: string; status?: string } = {}) =>
      http.get<PageResp<Composition>>('/compositions', params),
    createWork: (data: {
      planId: string
      mediaType: string
      mediaAccount: string
      compositionType: number
      compositionSubType: number
      title?: string | null
      promoUrl: string
      releaseTime: string
    }) => http.post<Composition>('/compositions', data),
    /** 任务列表（tasks，知乎同步） */
    listTasks: (params: { page?: number; pageSize?: number; status?: string; keyword?: string } = {}) =>
      http.get<PageResp<ZhihuTask>>('/tasks', params),
    /** 触发从知乎同步推广任务（admin） */
    syncTasks: (channelId?: string) =>
      http.post<{ jobId: string; status: string }>(`/tasks/sync${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`),
    /** 通用内容资产（盐选/截流/举报/有声书漫画/标签/产品/素材） */
    listItems: (type: StoryItemType) => http.get<StoryItem[]>('/story-items', { type }),
    createItem: (data: { type: StoryItemType; title: string; url?: string | null; note?: string | null }) =>
      http.post<{ id: string }>('/story-items', data),
    updateItem: (id: string, data: { title?: string; url?: string | null; note?: string | null; status?: 'active' | 'archived' }) =>
      http.patch<void>(`/story-items/${id}`, data),
    deleteItem: (id: string) => http.del<void>(`/story-items/${id}`),
    /* ===== 知乎真实接口数据（薄代理，不落库）===== */
    /** 盐选榜单列表 */
    saltBoards: () => http.get<any>('/zhihu-content/salt/boards'),
    /** 榜单内容 */
    saltBoardContents: (ruleId: string, params: { offset?: number; limit?: number } = {}) =>
      http.get<any>(`/zhihu-content/salt/boards/${ruleId}/contents`, params),
    /** 有声书内容 */
    audioContents: (params: { offset?: number; limit?: number } = {}) =>
      http.get<any>('/zhihu-content/audio/contents', params),
    /** 漫剧剧目 */
    comicDramas: (params: { offset?: number; limit?: number; title?: string } = {}) =>
      http.get<any>('/zhihu-content/comic-dramas', params),
    /** 评论截流词 */
    interceptWords: (params: { type?: number; keyword?: string; status?: number; offset?: number; limit?: number } = {}) =>
      http.get<any>('/zhihu-content/intercept-words', params),
    /** 风险词 */
    riskWords: (params: { type?: number; keyword?: string; risk_type?: number; status?: number; offset?: number; limit?: number } = {}) =>
      http.get<any>('/zhihu-content/risk-words', params),
    /** 内容标签查询 */
    contentTag: (url: string, tags = '1,2,3') => http.get<any>('/zhihu-content/content-tag', { url, tags }),
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
  story: ReturnType<typeof createZhihuStoryApi>
  finance: ReturnType<typeof createFinanceApi>
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
    story: createZhihuStoryApi(http),
    finance: createFinanceApi(http),
  }
}
