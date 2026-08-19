/**
 * BFF DTO 类型（server 序列化后的 camelCase 形态）。
 * 约定：所有 ID 为 string；金额单位为分；比率为 0–1 小数。
 */

import type { GlobalRole, Permission, ProjectMemberRole } from './roles'

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

export interface AddProjectMemberReq {
  userId: string
  memberRole?: ProjectMemberRole
}

export interface AddProjectCourseReq {
  courseName: string
  courseUrl?: string
  displayOrder?: number
}
