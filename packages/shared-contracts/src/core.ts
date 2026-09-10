import type { GlobalRole, Permission, ProjectMemberRole } from './roles'
export * from './roles'
export * from './envelope'
export interface PageReq {
  page?: number
  pageSize?: number
}

export interface PageResp<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

export interface LoginReq {
  username: string
  password: string
}

export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: GlobalRole
  parentId: string | null
  phone: string | null
  mustChangePwd?: boolean
  permissions?: Permission[]
}

export interface LoginResp {
  token: string
  user: AuthUser
  mustChangePwd: boolean
}

export type MeResp = AuthUser & { permissions: Permission[] }

export interface RefreshResp {
  token: string
  user: AuthUser
}

export interface ChangePasswordReq {
  oldPassword: string
  newPassword: string
}

export interface McnAccount {
  id: string
  accountKey: string
  accountName: string
  ownerUserId: string
  status: 'active' | 'suspended' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface ProjectMember {
  projectId: string
  userId: string
  memberRole: ProjectMemberRole
  joinedAt: string
  username: string | null
  displayName: string | null
}

export interface ProjectCourse {
  id: string
  projectId: string
  courseName: string
  courseUrl: string | null
  displayOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: string
  name: string
  slug: string
  isEnabled: boolean
  createdAt: string
  /** 非 admin 视角下自己的项目内角色；admin 全量列表为 null。 */
  memberRole: ProjectMemberRole | null
}

export interface TeamMember {
  id: string
  username: string
  role: GlobalRole
  parentId: string | null
  displayName: string
  phone: string | null
  isActive: boolean
  mustChangePwd: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type TeamApplicationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface TeamApplication {
  id: string
  creatorId: string
  creatorName: string
  creatorUsername: string
  leaderId: string
  leaderName: string
  message: string | null
  status: TeamApplicationStatus
  createdAt: string
  handledAt: string | null
}

export interface ApplyTeamReq {
  leaderUsername: string
  message?: string
}

export interface LeaderOption {
  id: string
  username: string
  displayName: string
  memberCount: number
}

export interface MyTeamResp {
  leaderId: string
  leaderUsername: string
  leaderName: string
  leaderActive: boolean
  memberCount: number
}

export interface AuditLogItem {
  id: string
  action: string
  resourceType: string
  resourceId: string | null
  detailJson: Record<string, unknown> | null
  ip: string | null
  createdAt: string
  operatorUsername: string | null
  operatorName: string | null
}

export interface AccountMonitorItem {
  id: string
  username: string
  displayName: string
  role: string
  isActive: boolean
  lastLoginAt: string | null
  actionCount7d: number | null
  lastAction: string | null
  lastActionAt: string | null
}

export interface Announcement {
  id: string
  title: string
  content: string
  status: 'published' | 'offline'
  createdAt: string
  updatedAt?: string
  createdByName?: string | null
}

export interface DbTableStat {
  tableName: string
  tableRows: number
  dataMb: number
}

export interface SiteInfo {
  name: string
  node: string
  uptimeSec: number
}

export interface ProjectDetail extends Project {}

export interface CreateProjectReq {
  name: string
  slug: string
}

export interface UpdateProjectReq {
  name?: string
  isEnabled?: boolean
}

export interface AddProjectMemberReq {
  userId: string
  memberRole?: ProjectMemberRole
}

export interface AddProjectCourseReq {
  courseName: string
  courseUrl?: string
  displayOrder?: number
}

export interface CreateMemberReq {
  username: string
  displayName: string
  phone?: string | null
  role?: 'leader' | 'creator'
  parentId?: string | null
}

export interface CreateMemberResp {
  id: string
  username: string
  temporaryPassword: string
}
