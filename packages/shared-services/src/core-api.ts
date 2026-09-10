import type {
  AuthUser,
  Project,
  PageResp,
  PageReq,
  LoginReq,
  LoginResp,
  MeResp,
  RefreshResp,
  ChangePasswordReq,
  McnAccount,
  ProjectMember,
  ProjectCourse,
  TeamMember,
  TeamApplication,
  ApplyTeamReq,
  LeaderOption,
  MyTeamResp,
  AuditLogItem,
  AccountMonitorItem,
  Announcement,
  DbTableStat,
  SiteInfo,
  ProjectDetail,
  CreateProjectReq,
  UpdateProjectReq,
  AddProjectMemberReq,
  AddProjectCourseReq,
  CreateMemberReq,
  CreateMemberResp,
  TeamApplicationStatus,
} from '@zhihu-koc/shared-contracts/core'
import type { HttpClient } from './http'
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

export function createTeamApi(http: HttpClient) {
  return {
    listMembers: () => http.get<TeamMember[]>('/team/members'),
    createMember: (data: CreateMemberReq) => http.post<CreateMemberResp>('/team/members', data),
    updateMember: (id: string, data: { displayName?: string; phone?: string | null }) =>
      http.patch<void>(`/team/members/${id}`, data),
    resetPassword: (id: string, password?: string) =>
      http.post<{ temporaryPassword: string | null; mustChangePwd: boolean }>(
        `/team/members/${id}/reset-password`,
        { password },
      ),
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

export function createAdminToolsApi(http: HttpClient) {
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

export function createAnnouncementsApi(http: HttpClient) {
  return {
    list: () => http.get<Announcement[]>('/announcements'),
    active: () =>
      http.get<Array<Pick<Announcement, 'id' | 'title' | 'content' | 'createdAt'>>>('/announcements/active'),
    create: (data: { title: string; content: string }) => http.post<{ id: string }>('/announcements', data),
    setStatus: (id: string, status: 'published' | 'offline') =>
      http.post<void>(`/announcements/${id}/status`, { status }),
  }
}
export function createCoreApis(http: HttpClient) {
  return {
    auth: createAuthApi(http),
    mcn: createMcnApi(http),
    projects: createProjectsApi(http),
    team: createTeamApi(http),
    adminTools: createAdminToolsApi(http),
    announcements: createAnnouncementsApi(http),
  }
}
