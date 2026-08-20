// ─── 项目排行 ────────────────────────────────────────────────
export interface RankProject {
  rank: number
  id: string
  name: string
  category: string
  bgColor: string
  shortName: string
  earnings7d: string
  change: 'up' | 'down' | 'new' | 'same'
  changeVal?: number
}

// ─── 赛道 / 分类 ─────────────────────────────────────────────
export interface TrackCategory {
  id: string
  name: string
  count: number
  icon: string
  color: string
}

// ─── 推广项目 ─────────────────────────────────────────────────
export interface Project {
  id: string
  name: string
  platform: string
  category: string
  commissionRate: string
  commissionDesc: string
  desc: string
  tags: string[]
  bgColor: string
  shortName: string
  coverUrl?: string
  hot: boolean
  status: 'active' | 'new' | 'paused'
  joinCount: number
}

// ─── 工具 ─────────────────────────────────────────────────────
export interface Tool {
  id: string
  name: string
  category: string
  rating: number
  heatLevel: number
  brief: string
  desc: string
  freeTrials: number
  bgColor: string
  icon: string
  price: string
}

// ─── 推广链接 ─────────────────────────────────────────────────
export interface PromotionLink {
  id: string
  projectName: string
  projectId: string
  channel: string
  url: string
  clicks: number
  installs: number
  conversionRate: number
  earnings: string
  createdAt: string
  status: 'active' | 'expired'
}

// ─── 收益记录 ─────────────────────────────────────────────────
export interface EarningsRecord {
  id: string
  date: string
  projectName: string
  type: string
  amount: string
  status: 'settled' | 'pending' | 'locked'
}

// ─── 数据图表点 ───────────────────────────────────────────────
export interface ChartPoint {
  date: string
  value: number
  label?: string
}

// ─── 用户 ─────────────────────────────────────────────────────
export interface UserProfile {
  id: string
  nickname: string
  avatar: string
  role: 'affiliate' | 'operator' | 'admin'
  level: string
  walletBalance: string
  pendingEarnings: string
  totalEarnings: string
  isLoggedIn: boolean
}

// ─── 统计卡 ───────────────────────────────────────────────────
export interface StatCard {
  title: string
  value: string
  unit?: string
  change?: string
  changeType?: 'up' | 'down'
  icon: string
  color: string
}

// ─── 推广计划 ─────────────────────────────────────────────────
export interface Campaign {
  id: string
  name: string
  status: 'active' | 'paused' | 'ended' | 'draft'
  startDate: string
  endDate: string
  budget: number
  spent: number
  targetApp: string
  keywordCount: number
  impressions: number
  clicks: number
  conversions: number
  ctr: number
  cvr: number
  createdAt: string
}

// ─── 词条 ─────────────────────────────────────────────────────
export interface KeywordEntry {
  id: string
  keyword: string
  campaignId: string
  campaignName: string
  bindStatus: 'bound' | 'pending' | 'failed' | 'unbound'
  contentUrl: string
  impressions: number
  clicks: number
  conversions: number
  ctr: number
  cvr: number
  cpc: number
  cost: number
  updatedAt: string
}

// ─── 回传配置 ─────────────────────────────────────────────────
export interface CallbackConfig {
  id: string
  campaignId: string
  campaignName: string
  callbackUrl: string
  events: string[]
  signKey: string
  status: 'active' | 'inactive'
  lastPingAt: string
  successRate: number
  totalCalls: number
}

// ─── 回传日志 ─────────────────────────────────────────────────
export interface CallbackLog {
  id: string
  timestamp: string
  event: string
  keyword: string
  status: 'success' | 'failed' | 'retry'
  responseCode: number
  latency: number
  errorMsg?: string
}
