import type {
  AddProjectCourseReq,
  AddProjectMemberReq,
  ChangePasswordReq,
  LoginReq,
  LoginResp,
  McnAccount,
  MeResp,
  ProjectCourse,
  ProjectMember,
  RefreshResp,
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

export interface ApiBundle {
  auth: ReturnType<typeof createAuthApi>
  mcn: ReturnType<typeof createMcnApi>
  projects: ReturnType<typeof createProjectsApi>
}

export function createApis(http: HttpClient): ApiBundle {
  return {
    auth: createAuthApi(http),
    mcn: createMcnApi(http),
    projects: createProjectsApi(http),
  }
}
