// ─────────────────────────────────────────────────────────────
//  BFF API types — aligned with server/src after serialize()
//  Rules:
//    • All IDs are strings
//    • Amounts in 分 (fen)
//    • Rates are 0-1 decimals
//    • DB snake_case is serialized to camelCase by server/src/utils/serialize.ts
//    • Pagination: { list: T[], total, page, pageSize }
// ─────────────────────────────────────────────────────────────

// ─── Pagination ───────────────────────────────────────────────
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

// ─── Auth ─────────────────────────────────────────────────────
export interface LoginReq {
  username: string
  password: string
}

export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: 'boss' | 'leader' | 'member'
  parentId: string | null
  phone: string | null
  mustChangePwd?: boolean
  permissions?: string[]
}

export interface LoginResp {
  token: string
  user: AuthUser
  mustChangePwd: boolean
}

export type MeResp = AuthUser & { permissions: string[] }

export interface ChangePasswordReq {
  oldPassword: string
  newPassword: string
}

// ─── Meta / Enums ─────────────────────────────────────────────
export interface EnumItem {
  value: string | number
  label: string
  parent?: string | number
}

export interface EnumsResp {
  mediaType:          EnumItem[]
  compositionType:    EnumItem[]
  compositionSubType: EnumItem[]
  popularizeType:     EnumItem[]
  planStatus:         EnumItem[]
}

// ─── Channels ─────────────────────────────────────────────────
export interface Channel {
  id: string
  zhihuChannelId: string
  name: string
  generation: number
  ownerId: string | null
  ownerName: string | null
  createdAt: string
}

export interface Task {
  id:             string
  zhihuTaskId:    string
  name:           string
  popularizeType: number | null
  settleType:     string | null
  unitPrice:      number | null
  startTime:      string | null
  endTime:        string | null
  status:         string | null
  rawJson:        Record<string, unknown> | null
  syncedAt:       string
}

// ─── Plans (推广计划) ──────────────────────────────────────────
export type PlanStatus = 'pending' | 'active' | 'paused' | 'rejected' | 'ended'
export type SyncStatus = 'local' | 'synced' | 'failed'

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
  dailyBudget: number | null   // 分
  startDate: string | null
  endDate: string | null
  ownerId: string
  ownerName: string
  status: PlanStatus
  syncStatus: SyncStatus
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

export type PlanListResp = PageResp<Plan>

export interface CreatePlanReq {
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
}

export interface UpdatePlanReq {
  landingUrl?: string
  name?: string | null
  dailyBudget?: number | null
}

export interface CheckKeywordReq { channelId: string; keyword: string }
export interface CheckKeywordResp { available: boolean; reason?: string }

// ─── Metrics (数据指标) ────────────────────────────────────────
export interface OverviewResp {
  totalImpressions: number
  totalClicks:      number
  totalConversions: number
  totalSpend:       number   // 分
  totalEarnings:    number   // 分
  ctr: number                // 0-1
  cvr: number                // 0-1
  cpc: number                // 分
}

export interface TrendPoint {
  date:        string
  impressions: number
  clicks:      number
  conversions: number
  spend:       number   // 分
  earnings:    number   // 分
}

export interface TrendReq {
  from?:        string   // YYYY-MM-DD
  to?:          string
  granularity?: 'day'
}

export type TrendResp = TrendPoint[]

export interface KeywordMetric {
  keyword:     string
  channelName: string
  impressions: number
  clicks:      number
  conversions: number
  spend:       number   // 分
  earnings:    number   // 分
  ctr:         number
  cvr:         number
}

export interface KeywordMetricsReq extends PageReq {
  from?: string
  to?:   string
  sort?: string
  order?: 'asc' | 'desc'
}

export type KeywordMetricsResp = PageResp<KeywordMetric>

// ─── Team (团队成员) ───────────────────────────────────────────
export type MemberRole = 'leader' | 'member'

export interface TeamMember {
  id:            string
  username:      string
  displayName:   string
  role:          MemberRole
  parentId:      string | null
  phone:         string | null
  planCount:     number
  totalEarnings: number   // 分
  createdAt:     string
}

export interface CreateMemberReq {
  username:    string
  displayName: string
  phone?:      string
  role?:       MemberRole
  parentId?:   string
}

export interface CreateMemberResp {
  id:                string
  username:          string
  temporaryPassword: string
  mustChangePwd:     boolean
}

export interface ResetMemberPasswordResp {
  temporaryPassword: string
  mustChangePwd:     boolean
}

export interface UpdateMemberReq {
  displayName?: string
  phone?:       string | null
}

// ─── Compositions (推广作品) ───────────────────────────────────
export type CompositionStatus = 'pending' | 'accepted' | 'submitted' | 'approved' | 'rejected'

export interface Composition {
  id:                  string
  planId:              string
  ownerId:             string
  assigneeName?:       string
  channelId:           string
  channelName:         string
  keyword:             string
  mediaType:           string
  mediaAccount:        string
  compositionType:     number
  compositionSubType:  number
  title:               string | null
  promoUrl:            string
  releaseTime:         string | null
  status:              CompositionStatus
  rejectReason:        string | null
  syncStatus:          string
  zhihuTaskId:         string | null
  callbackAt:          string | null
  createdAt:           string
  updatedAt:           string
}

export interface CompositionListReq extends PageReq {
  planId?:  string
  status?:  CompositionStatus
}

export type CompositionListResp = PageResp<Composition>

export interface CreateCompositionReq {
  planId:             string
  mediaType:          string
  mediaAccount:       string
  compositionType:    number
  compositionSubType: number
  title?:             string
  promoUrl:           string
  releaseTime?:       string
}

export interface UpdateCompositionReq {
  mediaType?:          string
  mediaAccount?:       string
  compositionType?:    number
  compositionSubType?: number
  title?:              string | null
  promoUrl?:           string
  releaseTime?:        string | null
}

// ─── Earnings (收益) ───────────────────────────────────────────
export type EarningsStatus = 'pending' | 'confirmed' | 'paid'

export interface EarningRecord {
  id:          string
  date:        string
  planId:      string
  keyword:     string
  channelId:   string
  channelName: string
  ownerId:     string
  ownerName:   string
  amount:      number   // 分
  status:      EarningsStatus
}

export interface EarningsListReq extends PageReq {
  status?: EarningsStatus
}

export type EarningsListResp = PageResp<EarningRecord>

export interface EarningsSummaryResp {
  pending:   number   // 分
  confirmed: number   // 分
  paid:      number   // 分
  total:     number   // 分
}

// ─── Withdrawals (提现) ────────────────────────────────────────
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected'

export interface Withdrawal {
  id:         string
  amount:     number   // 分
  payMethod:  'alipay' | 'wechat'
  payAccount: string
  status:     WithdrawalStatus
  remark:     string | null
  createdAt:  string
  updatedAt:  string
}

export interface CreateWithdrawalReq {
  amount:     number
  payMethod:  'alipay' | 'wechat'
  payAccount: string
}

// ─── Callbacks ────────────────────────────────────────────────
export interface CallbackRule {
  id:          string
  planId:      string
  keyword:     string
  callbackUrl: string
  events:      string[]
  status:      'active' | 'inactive'
  successRate: number
  totalCalls:  number
  lastPingAt:  string | null
  createdAt:   string
}

export interface CallbackLog {
  id:           string
  ruleId:       string
  event:        string
  keyword:      string
  status:       'success' | 'failed' | 'retry'
  responseCode: number | null
  latency:      number | null
  createdAt:    string
}
