// ─── Display helpers — align with BFF data conventions ────────
// Amounts are in 分 (fen), rates are 0-1 decimals
// Backend serializes snake_case → camelCase via serialize.ts

/** 分 → "¥1,234.56" */
export const fmtFen = (fen: number): string => {
  const yuan = fen / 100
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** 元 (float) → "¥1,234.56" */
export const fmtYuan = (yuan: number): string =>
  `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 0.1234 → "12.34%" */
export const fmtPct = (ratio: number): string =>
  `${(ratio * 100).toFixed(2)}%`

/** integer → locale-formatted string: 1234567 → "1,234,567" */
export const fmtNum = (n: number): string =>
  Math.round(n).toLocaleString('zh-CN')

/** YYYY-MM-DD → "MM-DD" for chart x-axis labels */
export const fmtDate = (iso: string): string => iso.slice(5)

/** role key → Chinese label */
export const roleLabel = (role: string): string =>
  ({ boss: 'Admin 管理员', leader: '团长 / 运营', member: 'KOC 达人' })[role] ?? role

/** plan status → Chinese label (backend: pending/active/paused/rejected/ended) */
export const planStatusLabel = (s: string): string =>
  ({ pending: '待审核', active: '投放中', paused: '暂停', rejected: '已拒绝', ended: '已结束' })[s] ?? s

/** plan status → badge class */
export const planStatusClass = (s: string): string =>
  ({ active: 'badge-success', paused: 'badge-warning', pending: 'badge-info', rejected: 'badge-error', ended: 'badge-default' })[s] ?? 'badge-default'

/** sync status → Chinese label */
export const syncStatusLabel = (s: string): string =>
  ({ local: '本地', synced: '已同步', failed: '同步失败' })[s] ?? s

/** sync status → badge class */
export const syncStatusClass = (s: string): string =>
  ({ synced: 'badge-success', failed: 'badge-error', local: 'badge-warning' })[s] ?? 'badge-default'

/** composition status → Chinese label */
export const compStatusLabel = (s: string): string =>
  ({
    pending: '待接受', accepted: '已接受', submitted: '已提交',
    approved: '已通过', rejected: '已拒绝',
  })[s] ?? s

/** earnings status → Chinese label (backend: pending/confirmed/paid) */
export const earningsStatusLabel = (s: string): string =>
  ({ pending: '待确认', confirmed: '已确认', paid: '已结算' })[s] ?? s

/** earnings status → badge class */
export const earningsStatusClass = (s: string): string =>
  ({ paid: 'badge-success', confirmed: 'badge-info', pending: 'badge-warning' })[s] ?? 'badge-default'

/** withdrawal status → Chinese label */
export const withdrawalStatusLabel = (s: string): string =>
  ({ pending: '审核中', approved: '已通过', rejected: '已拒绝' })[s] ?? s

/** nickname/displayName initials for avatars (first 2 chars) */
export const initials = (name: string): string =>
  (name || '?').slice(0, 2).toUpperCase()
