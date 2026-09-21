import { createWorkImportApi } from './composition-import'
export type { WorkImportOptions, WorkImportPreview, WorkImportResult, WorkImportRow, WorkImportDraft, WorkImportDraftDetail, WorkImportDraftReceipt } from './composition-import'
import type {
  Appeal,
  AppealKind,
  AppealStatus,
  CallbackRule,
  CallbackSecret,
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
  AccountMonitorItem,
  Announcement,
  AuditLogItem,
  DbTableStat,
  SiteInfo,
  ChangePasswordReq,
  Composition,
  CreateMemberReq,
  CreateMemberResp,
  CreateProjectReq,
  CreateWithdrawalReq,
  DataImportBatch,
  DataImportBatchDetail,
  DataImportConfirmResult,
  DataImportPreview,
  DataImportSourceType,
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
  WithdrawalStatement,
  WithdrawalStatus,
  ZhihuTask,
} from '@zhihu-koc/shared-contracts/zhihu'
import type { HttpClient } from './http'
import { normalizeMetricsOverview, normalizeMetricsTrend, normalizeEarningsSummary } from './zhihu-data'
import type { MetricsOverviewResponse, MetricsTrendResponse } from './zhihu-data'
import { fetchAllPages } from './pagination'
export function createFinanceApi(http: HttpClient) {
  return {
    listRules: () => http.get<PricingRule[]>('/finance/rules'),
    createRule: (data: CreatePricingRuleReq) => http.post<{ id: string }>('/finance/rules', data),
    disableRule: (id: string) => http.post<void>(`/finance/rules/${id}/disable`),
    listBatches: () => http.get<SettlementBatch[]>('/finance/batches'),
    getBatch: (id: string) => http.get<SettlementBatchDetail>(`/finance/batches/${id}`),
    createBatch: (data: CreateSettlementBatchReq) => http.post<{ id: string }>('/finance/batches', data),
    importBatch: (file: File, meta: { title: string; periodStart: string; periodEnd: string }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('title', meta.title)
      form.append('periodStart', meta.periodStart)
      form.append('periodEnd', meta.periodEnd)
      return http.postForm<{ id: string; imported: number }>('/finance/batches/import', form)
    },
    approveBatch: (id: string) => http.post<void>(`/finance/batches/${id}/approve`),
    cancelBatch: (id: string) => http.post<void>(`/finance/batches/${id}/cancel`),
  }
}

export function createDataImportApi(http: HttpClient) {
  return {
    parse: (file: File, sourceType: DataImportSourceType = 'email_attachment') => {
      const form = new FormData()
      form.append('file', file)
      form.append('sourceType', sourceType)
      return http.postForm<DataImportPreview>('/data-import/parse', form)
    },
    confirm: (id: string) => http.post<DataImportConfirmResult>('/data-import/confirm', { tempFileId: id }),
    reject: (id: string, reason?: string) =>
      http.post<DataImportBatch>(`/data-import/${id}/reject`, reason ? { reason } : {}),
    listBatches: () => fetchAllPages(params => http.get<PageResp<DataImportBatch>>('/data-import/batches', params)),
    getBatch: (id: string, params: { page?: number; pageSize?: number } = {}) =>
      http.get<DataImportBatchDetail>(`/data-import/${id}`, params),
  }
}

export function createPlansApi(http: HttpClient) {
  return {
    list: (params: PlanListReq = {}) => http.get<PageResp<Plan>>('/plans', params),
    get: (id: string) => http.get<Plan>(`/plans/${id}`),
    create: (data: {
      taskId: string
      channelId: string
      secondChannelId?: string | null
      keyword: string
      landingUrl: string
      popularizeType: number
      name?: string | null
      dailyBudget?: number | null
      startDate?: string | null
      endDate?: string | null
      ownerId?: string
    }) => http.post<Plan>('/plans', data),
    checkKeyword: (channelId: string, keyword: string) =>
      http.post<{ available: boolean }>('/plans/check-keyword', { channelId, keyword }),
    update: (id: string, data: UpdatePlanReq) => http.patch<Plan>(`/plans/${id}`, data),
    remove: (id: string) => http.del<void>(`/plans/${id}`),
    retry: (id: string) => http.post<Plan>(`/plans/${id}/retry-sync`),
  }
}

export function createMetricsApi(http: HttpClient) {
  return {
    overview: async () => normalizeMetricsOverview(await http.get<MetricsOverviewResponse>('/metrics/overview')),
    trend: async (params: { from?: string; to?: string } = {}) => normalizeMetricsTrend(await http.get<MetricsTrendResponse>('/metrics/trend', params)),
    sync: () => http.post<{ jobId: string; status: string }>('/metrics/sync'),
  }
}

export function createChannelsApi(http: HttpClient) {
  return {
    list: (params: { page?: number; pageSize?: number } = {}) =>
      http.get<PageResp<Record<string, unknown>>>('/channels', params),
    sync: () => http.post<{ jobId: string; status: string }>('/channels/sync'),
  }
}

export function createEarningsApi(http: HttpClient) {
  return {
    list: async (params: { page?: number; pageSize?: number; status?: EarningsStatus } = {}) => {
      const data = await http.get<PageResp<EarningRecord & { settleDate?: string; userId?: string }>>('/earnings', params)
      return { ...data, list: data.list.map(row => ({ ...row, date: (row.date ?? row.settleDate ?? '').slice(0, 10), ownerId: row.ownerId ?? row.userId ?? '' })) }
    },
    summary: async () => normalizeEarningsSummary(await http.get<Omit<EarningsSummary, 'total'> & { total?: number }>('/earnings/summary')),
  }
}

export function createWithdrawalsApi(http: HttpClient) {
  return {
    list: (params: { page?: number; pageSize?: number; status?: WithdrawalStatus } = {}) =>
      http.get<PageResp<Withdrawal>>('/withdrawals', params),
    /** 财务链未开放时服务端以 50310 拒绝（failedGates 透传到 ApiError）。 */
    apply: (
      data: CreateWithdrawalReq & {
        settleType?: 'personal' | 'corporate'
        companyName?: string
        bankName?: string
        bankAccount?: string
        taxId?: string
      },
    ) => http.post<{ id: string; status: WithdrawalStatus; riskFlags: string[] }>('/withdrawals', data),
    /** 上传发票（对公申请） */
    uploadInvoice: (id: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      return http.postForm<{ name: string }>(`/withdrawals/${id}/invoice`, form)
    },
    /** 结算单数据 */
    statement: (id: string) => http.get<WithdrawalStatement>(`/withdrawals/${id}/statement`),
    downloadInvoice: (id: string) => http.getBlob(`/withdrawals/${id}/invoice`),
    /** 成员撤销（初审前） */
    cancel: (id: string) => http.post<void>(`/withdrawals/${id}/cancel`),
    /** 团长初审 */
    review: (id: string, action: 'approve' | 'reject', remark?: string) =>
      http.post<void>(`/withdrawals/${id}/review`, { action, remark }),
    /** 管理员终审 */
    decide: (id: string, action: 'approve' | 'reject', remark?: string) =>
      http.post<void>(`/withdrawals/${id}/decide`, { action, remark }),
  }
}

export function createAppealsApi(http: HttpClient) {
  return {
    list: (params: { page?: number; pageSize?: number; status?: AppealStatus } = {}) =>
      http.get<PageResp<Appeal>>('/appeals', params),
    submit: (data: { kind: AppealKind; title: string; content: string; evidence?: string | null }) =>
      http.post<{ id: string }>('/appeals', data),
    cancel: (id: string) => http.post<void>(`/appeals/${id}/cancel`),
    review: (id: string, action: 'approve' | 'reject', remark?: string) =>
      http.post<void>(`/appeals/${id}/review`, { action, remark }),
    decide: (id: string, action: 'approve' | 'reject', remark?: string, adjustAmount?: number | null) =>
      http.post<void>(`/appeals/${id}/decide`, { action, remark, adjustAmount }),
  }
}

export function createCallbacksApi(http: HttpClient) {
  return {
    listRules: (params: { page?: number; pageSize?: number } = {}) =>
      http.get<PageResp<CallbackRule>>('/callbacks/rules', params),
    createRule: (data: { planId: string; callbackUrl: string; events: string[] }) =>
      http.post<CallbackRule>('/callbacks/rules', data),
    deleteRule: (id: string) => http.del<void>(`/callbacks/rules/${id}`),
    getSecret: () => http.get<CallbackSecret>('/callbacks/secret'),
    rotateSecret: () => http.post<CallbackSecret>('/callbacks/secret/rotate'),
  }
}

export function createZhihuStoryApi(http: HttpClient) {
  return {
    ...createWorkImportApi(http),
    /** 作品管理（compositions） */
    listWorks: (params: { page?: number; pageSize?: number; planId?: string; status?: string; keyword?: string } = {}) =>
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
      http.post<{ jobId: string; status: string }>(
        `/tasks/sync${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`,
      ),
    /** 通用内容资产（盐选/截流/举报/有声书漫画/标签/产品/素材） */
    listItems: (type: StoryItemType) => fetchAllPages(params => http.get<PageResp<StoryItem>>('/story-items', { type, ...params })),
    createItem: (data: { type: StoryItemType; title: string; url?: string | null; note?: string | null }) =>
      http.post<{ id: string }>('/story-items', data),
    updateItem: (
      id: string,
      data: { title?: string; url?: string | null; note?: string | null; status?: 'active' | 'archived' },
    ) => http.patch<void>(`/story-items/${id}`, data),
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
    interceptWords: (
      params: { type?: number; keyword?: string; status?: number; offset?: number; limit?: number } = {},
    ) => http.get<any>('/zhihu-content/intercept-words', params),
    /** 风险词 */
    riskWords: (
      params: {
        type?: number
        keyword?: string
        risk_type?: number
        status?: number
        offset?: number
        limit?: number
      } = {},
    ) => http.get<any>('/zhihu-content/risk-words', params),
    /** 内容标签查询 */
    contentTag: (url: string, tags = '1,2,3') => http.get<any>('/zhihu-content/content-tag', { url, tags }),
  }
}
export function createZhihuApis(http: HttpClient) {
  return {
    projects: createLegacyProjectsApi(http),
    adminTools: createLegacyAdminToolsApi(http),
    finance: createFinanceApi(http),
    dataImport: createDataImportApi(http),
    plans: createPlansApi(http),
    metrics: createMetricsApi(http),
    channels: createChannelsApi(http),
    earnings: createEarningsApi(http),
    withdrawals: createWithdrawalsApi(http),
    appeals: createAppealsApi(http),
    callbacks: createCallbacksApi(http),
    story: createZhihuStoryApi(http),
  }
}

export function createLegacyProjectsApi(http: HttpClient) {
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

export function createLegacyAdminToolsApi(http: HttpClient) {
  return {
    /** 操作日志 */
    auditLogs: (
      params: {
        page?: number
        pageSize?: number
        action?: string
        username?: string
        from?: string
        to?: string
      } = {},
    ) => http.get<PageResp<AuditLogItem>>('/audit-logs', params),
    auditActions: () => http.get<Array<{ action: string }>>('/audit-logs/actions'),
    /** 子账号行为监控 */
    monitor: () => http.get<AccountMonitorItem[]>('/admin-tools/monitor'),
    /** 数据库表统计 */
    dbStats: () => http.get<DbTableStat[]>('/admin-tools/db-stats'),
    auditCleanup: (days: number) => http.post<{ deleted: number }>('/admin-tools/audit-cleanup', { days }),
    siteInfo: () => http.get<SiteInfo>('/admin-tools/site-info'),
  }
}
