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

/** 达人可申请的团长选项 */
export interface LeaderOption {
  id: string
  username: string
  displayName: string
  memberCount: number
}

/** 达人当前所属团队；未入团为 null */
export interface MyTeamResp {
  leaderId: string
  leaderUsername: string
  leaderName: string
  leaderActive: boolean
  memberCount: number
}

/* ===== 财务中继：定价规则与结算批次 ===== */

export interface PricingRule {
  id: string
  targetUserId: string | null
  targetUsername: string | null
  targetName: string | null
  targetRole: 'leader' | 'creator'
  method: 'fixed' | 'percentage'
  unitPrice: string | null
  percentage: string | null
  status: 'active' | 'disabled'
  priority: number
  effectiveFrom: string
  createdAt: string
}

export interface CreatePricingRuleReq {
  targetUserId?: string | null
  targetRole: 'leader' | 'creator'
  method: 'fixed' | 'percentage'
  unitPrice?: string | null
  percentage?: string | null
  priority?: number
}

export interface SettlementBatch {
  id: string
  title: string
  periodStart: string
  periodEnd: string
  status: 'draft' | 'approved' | 'cancelled'
  totalSource: string
  totalRelay: string
  approvedAt: string | null
  createdAt: string
}

export interface SettlementItem {
  id: string
  creatorId: string
  creatorUsername: string
  creatorName: string
  sourceAmount: string
  note: string | null
}

export interface RelayLog {
  id: string
  itemId: string
  earningId: string | null
  userId: string
  receiverName: string
  receiverUsername: string
  role: 'leader' | 'creator'
  ruleId: string | null
  method: string
  unitPrice: string | null
  percentage: string | null
  sourceAmount: string
  relayAmount: string
  createdAt: string
}

export interface SettlementBatchDetail extends SettlementBatch {
  items: SettlementItem[]
  logs: RelayLog[]
}

export interface CreateSettlementBatchReq {
  title: string
  periodStart: string
  periodEnd: string
  items: Array<{ creatorId: string; sourceAmount: string; note?: string | null }>
}

/* ===== 系统工具 ===== */

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
  node: string
  uptimeSec: number
  zhihuApiBase: string
  zhihuCredentialMode: 'real' | 'mock'
  sync: { channels: string | null; tasks: string | null; metrics: string | null }
}

/* ===== 知乎故事子模块 ===== */

/** 推广作品（compositions 表）；mediaType 为 KOC视频号/KOC抖音 等媒体枚举字符串 */
export interface Composition {
  id: string
  planId: string
  ownerId: string
  mediaType: string
  mediaAccount: string
  compositionType: number
  compositionSubType: number
  title: string | null
  promoUrl: string
  releaseTime: string | null
  status: 'pending' | 'active' | 'rejected' | 'ended'
  rejectReason: string | null
  syncStatus: 'local' | 'syncing' | 'synced' | 'failed'
  keyword?: string
  channelName?: string
  createdAt: string
}

/** 推广任务（tasks 表，知乎侧同步） */
export interface ZhihuTask {
  id: string
  projectId: string
  zhihuTaskId: string
  name: string
  popularizeType: number | null
  settleType: string | null
  unitPrice: number | null
  startTime: string | null
  endTime: string | null
  status: string | null
  syncedAt: string
}

export type StoryItemType = 'salt_pick' | 'comment_watch' | 'risk_report' | 'media' | 'tag' | 'product' | 'asset'

export interface StoryItem {
  id: string
  type: StoryItemType
  title: string
  url: string | null
  note: string | null
  status: 'active' | 'archived'
  ownerId: string
  ownerName?: string
  createdAt: string
}

export interface ProjectDetail extends Project {
  apiBaseUrl: string
  signMethod: 'hmac_sha256' | 'oauth2'
  configJson: Record<string, unknown> | null
}

export interface CreateProjectReq {
  name: string
  slug: string
  apiBaseUrl: string
  signMethod?: 'hmac_sha256' | 'oauth2'
  configJson?: Record<string, unknown>
}

export interface UpdateProjectReq {
  name?: string
  apiBaseUrl?: string
  signMethod?: 'hmac_sha256' | 'oauth2'
  isEnabled?: boolean
  configJson?: Record<string, unknown> | null
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

export type PlanStatus = 'pending' | 'active' | 'paused' | 'rejected' | 'ended'
export type SyncStatus = 'local' | 'syncing' | 'synced' | 'failed'

export interface Plan {
  id: string
  taskId: string
  channelId: string
  channelName: string
  secondChannelId: string | null
  keyword: string
  landingUrl: string
  popularizeType: number
  name: string | null
  /** 分 */
  dailyBudget: number | null
  startDate: string | null
  endDate: string | null
  ownerId: string
  ownerName: string
  status: PlanStatus
  syncStatus: SyncStatus
  syncError: string | null
  zhihuPlanId: string | null
  createdAt: string
  updatedAt: string
}

export interface PlanListReq extends PageReq {
  taskId?: string
  channelId?: string
  keyword?: string
  status?: PlanStatus
}

export interface UpdatePlanReq {
  keyword?: string
  landingUrl?: string
  name?: string | null
  dailyBudget?: number | null
}

export interface MetricsOverview {
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  /** 分 */
  totalSpend: number
  /** 分 */
  totalEarnings: number
  /** 0–1 */
  ctr: number
  /** 0–1 */
  cvr: number
  /** 分 */
  cpc: number
}

export interface TrendPoint {
  date: string
  impressions: number
  clicks: number
  conversions: number
  /** 分 */
  spend: number
  /** 分 */
  earnings: number
}

export type EarningsStatus = 'pending' | 'confirmed' | 'paid'

export interface EarningRecord {
  id: string
  date: string
  planId: string
  keyword: string
  channelId: string
  channelName: string
  ownerId: string
  ownerName: string
  /** 分 */
  amount: number
  status: EarningsStatus
}

export interface EarningsSummary {
  /** 分 */
  pending: number
  /** 分 */
  confirmed: number
  /** 分 */
  paid: number
  /** 分 */
  total: number
}

/* ===== 回传配置 ===== */

export interface CallbackRule {
  id: string
  planId: string | null
  planName: string | null
  callbackUrl: string
  eventsJson: string[]
  status: 'active' | 'inactive'
  createdAt: string
}

export interface CallbackSecret {
  lastFour: string
  rotatedAt: string
}

export type WithdrawalStatus = 'pending' | 'approved' | 'rejected'

export interface Withdrawal {
  id: string
  /** 分 */
  amount: number
  payMethod: 'alipay' | 'wechat'
  payAccount: string
  status: WithdrawalStatus
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateWithdrawalReq {
  /** 分 */
  amount: number
  payMethod: 'alipay' | 'wechat'
  payAccount: string
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
