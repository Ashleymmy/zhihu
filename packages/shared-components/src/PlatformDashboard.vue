<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import type { CoreWorkspace } from './core-workspace'
import type { AccountMonitorItem, MiniMonitor } from '@zhihu-koc/shared-contracts/core'
import OperationGuide from './OperationGuide.vue'
import AnimatedNumber from './AnimatedNumber.vue'
import TrendChart, { type TrendSeries } from './TrendChart.vue'
import ShareBar, { type ShareItem } from './ShareBar.vue'
import BarChart from './BarChart.vue'
const w = inject<CoreWorkspace>('opc')!

interface Todo { kind: string; count: number; label: string; actor: string; actionLabel: string; path: string }
interface Metric { key: string; label: string; value: string | null; unit: string; path: string }
interface Service { moduleId: string; accountId: string; status: string; todos: Todo[]; metrics: Metric[] }
interface Overview { period: { from: string; to: string }; projects: { id: string; name: string }[]; groups: { id: string; name: string; services: Service[] }[]; todos?: Todo[] }
interface MineGroup { projectId: string; projectName?: string; metricType: string; metricLabel: string; amount: string; quantity?: string; quantityUnit?: string }
interface MineLine { id: string; taskName: string | null; businessDate: string; metricLabel: string; quantity: string; amount: string; confirmedAt: string | null; performerName?: string | null }
interface Mine { summary: { amount: string; confirmedAmount: string; pendingAmount: string }; groups: MineGroup[]; list?: MineLine[] }
interface Daily { from: string; to: string; days: { date: string; group: 'self' | 'team'; amount: string }[] }
interface Periods { total: string; today: string; yesterday: string }
interface GrowthMetrics { activeDays: number; records: number; memberDays: number; quantities: { label: string; unit: string; quantity: string }[] }
interface MemberSummary { direct: Periods; team: null | { memberCount: number; reward: Periods }; metrics?: GrowthMetrics }
interface RelationMine { inviter: { name: string } | null; channel: string | null; team: { leaderName: string | null } | null; counts: { direct: number; indirect: number }; directList: { name: string; active: boolean }[]; indirectList?: { name: string; depth: number; active: boolean }[] }

const data = ref<Overview | null>(null), projectId = ref(''), loading = ref(false), error = ref('')
const mine = ref<Mine | null>(null), daily = ref<Daily | null>(null), summary = ref<MemberSummary | null>(null), relation = ref<RelationMine | null>(null), recent = ref<MineLine[]>([]), teamLines = ref<MineLine[]>([])
const selfMine = ref<Mine | null>(null), teamSummary = ref<Mine | null>(null), availableTasks = ref<{ projectId: string; total: number | null }[]>([])
/* 公告（员工右栏）：有效公告 */
interface Announcement { id: string; title: string; content: string; createdAt: string }
const announcements = ref<Announcement[]>([])

/* ===== 员工首页可视化数据（demo mock 契约；正式账源上线后同路径替换） ===== */
interface InsightsSummary { upstream?: string; memberPayout?: string; retention?: string; activeMembers: number; upstreamChange?: string; payoutRatio?: string; retentionRate?: string; taskCount?: number; activeTeams?: number; newMembers?: number }
interface InsightsDaily { labels: string[]; series: { key: string; label: string; unit: string; values: string[] }[] }
interface TeamTop { list: { name: string; quantity: number; amount?: string }[] }
interface Retention { rate?: number; parts?: { label: string; amount: string }[]; teamCount?: number; newTeams?: number; soloCreators?: number }
interface TodayPayouts { count: number; list: { name: string; amount: string; method: string; status: string }[] }
interface ReconcileProgress { rate: number; checkedDays: number; totalDays: number; byProject: { name: string; checked: number; total: number }[] }
interface PendingWithdrawals { totalAmount: string; count: number; earliest: string; todayPaid: string; monthPaid: string; failedCount: number }
const insightsSummary = ref<InsightsSummary | null>(null), insightsDaily = ref<InsightsDaily | null>(null), teamTop = ref<TeamTop | null>(null),
  retention = ref<Retention | null>(null), todayPayouts = ref<TodayPayouts | null>(null), reconcile = ref<ReconcileProgress | null>(null),
  pendingWithdrawals = ref<PendingWithdrawals | null>(null)
/** 员工（非成员）才需要总览可视化；运营收窄到非金额字段由接口按岗位控制 */
const isStaff = computed(() => !isMember.value)
const canSeeAmount = computed(() => w.role.value === 'developer' || (w.role.value === 'admin' && (w.duty?.value ?? 'all') !== 'operations'))
/* 入团申请（团长）：待审批列表与审批动作 */
interface TeamApplication { id: string; creatorId: string; creatorName: string; creatorUsername: string; message: string | null; status: string; createdAt: string }
const applications = ref<TeamApplication[]>([]), applicationBusy = ref('')
const pendingApplications = computed(() => applications.value.filter(a => a.status === 'pending'))
async function reviewApplication(id: string, action: 'approve' | 'reject') {
  if (applicationBusy.value) return
  applicationBusy.value = id
  try {
    await w.http.post(`/team/applications/${id}/review`, { action })
    applications.value = applications.value.filter(a => a.id !== id)
  } catch { /* 失败时保留申请项，用户可重试 */ }
  finally { applicationBusy.value = '' }
}
const isMember = computed(() => ['creator', 'leader'].includes(w.role.value))
/* 员工角色工作台入口（空待办时主卡按钮的落点） */
const staffWorkbenchPath = computed(() => {
  if (w.role.value === 'admin' && w.duty?.value === 'finance') return '/finance'
  return '/team'
})

/* ===== 员工首页可视化（数据来自 demo mock 契约，接口未上线时各卡自动隐藏） ===== */
const isFinanceStaff = computed(() => isStaff.value && canSeeAmount.value && w.role.value !== 'operator')
const isOperator = computed(() => w.role.value === 'operator' || (w.role.value === 'admin' && w.duty?.value === 'operations'))
/** 趋势图：财务/管理员是上游收入 vs 成员支出；运营是各项目业务量 */
const staffTrend = computed(() => {
  if (!insightsDaily.value) return null
  const palette = ['#d46b45', '#8e6cc9', '#5b8fe0', '#4e9a4a']
  const series: TrendSeries[] = insightsDaily.value.series.map((s, i) => ({
    label: s.label, color: palette[i % palette.length]!, points: s.values.map(Number), area: i === 0,
  }))
  return { labels: insightsDaily.value.labels, series, unit: insightsDaily.value.series[0]?.unit ?? '元' }
})
const staffTrendFormat = computed(() => staffTrend.value?.unit === '元' ? money : (v: number) => v.toLocaleString('zh-CN'))
const staffTrendTotal = (points: number[]) => points.reduce((sum, v) => sum + v, 0)
/** 团队排行条形图（按量或按金额归一） */
const teamTopBars = computed(() => {
  const list = teamTop.value?.list ?? []
  const max = Math.max(1, ...list.map(t => Number(t.amount ?? t.quantity)))
  return list.map(t => ({ ...t, pct: Math.round(Number(t.amount ?? t.quantity) / max * 100) }))
})
const TEAM_PALETTE = ['#d46b45', '#5b8fe0', '#8e6cc9', '#4e9a4a', '#c9a23f', '#b3557a']

/* ===== 开发者首页可视化（系统视角：处理量/队列/Worker/巡检，无金额） ===== */
interface DevSummary { processedToday: number; queueBacklog: number; syncTasks: number; patrols: number; failures24h: number; lastFailure: string | null; weekImports: number; weekPatrols: number; weekFixes: number }
interface DevDaily { labels: string[]; values: string[] }
interface DevWorkers { list: { name: string; note: string; ok: boolean }[] }
interface DevActivity { list: { title: string; detail: string; tone: string }[] }
const devSummary = ref<DevSummary | null>(null), devDaily = ref<DevDaily | null>(null),
  devWorkers = ref<DevWorkers | null>(null), devActivity = ref<DevActivity | null>(null)
const isDeveloper = computed(() => w.role.value === 'developer')
const DEV_TONES: Record<string, string> = { ok: '#4e9a4a', info: '#3b7dd8', clay: '#d46b45', muted: '#b0aea5' }
const devTrend = computed(() => devDaily.value ? {
  labels: devDaily.value.labels,
  series: [{ label: '处理量', color: '#3b7dd8', points: devDaily.value.values.map(Number), area: true }] as TrendSeries[],
} : null)
/* 运维监控真实数据（/admin-tools/monitor、/mini-monitor）：读失败时对应卡不显示 */
const accountMonitor = ref<AccountMonitorItem[] | null>(null), miniMonitor = ref<MiniMonitor | null>(null)
const monitorTop = computed(() => (accountMonitor.value ?? [])
  .filter(a => (a.actionCount7d ?? 0) > 0)
  .sort((a, b) => (b.actionCount7d ?? 0) - (a.actionCount7d ?? 0))
  .slice(0, 8)
  .map(a => ({ label: a.displayName || a.username, value: a.actionCount7d ?? 0 })))
const apiHealth = computed(() => {
  const t = miniMonitor.value?.technical
  if (!t) return null
  return {
    failurePct: t.failureRate === null ? null : (t.failureRate * 100).toFixed(1),
    requests: t.requests, serverErrors: t.serverErrors, rejected: t.rejected, averageMs: t.averageMs,
    lastRequestAt: t.lastRequestAt, failures24h: t.failures.length,
  }
})
const accessSplit = computed(() => {
  const b = miniMonitor.value?.business
  return b ? { bound: b.boundAccounts, unbound: b.unboundAccounts, sessions: b.validMiniSessions } : null
})
let revision = 0

/* 金额只做整数运算：字符串 → 万分之一元的整数，展示时四舍五入到分 */
const UNIT = 10000n
function units(value: string | null | undefined): bigint {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim())
  if (!m) return 0n
  const n = BigInt(m[2] ?? '0') * UNIT + BigInt((m[3] ?? '').padEnd(4, '0').slice(0, 4))
  return m[1] ? -n : n
}
function yuan(u: bigint): string {
  const neg = u < 0n, cents = ((neg ? -u : u) + 50n) / 100n
  return (neg ? '-' : '') + (cents / 100n).toLocaleString('zh-CN') + '.' + String(cents % 100n).padStart(2, '0')
}
const toNumber = (u: bigint) => Number(u) / 10000
const money = (v: number) => '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: v >= 1000 ? 0 : 2 })

function shanghaiToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) }

async function load() {
  const version = ++revision
  loading.value = true; error.value = ''
  void loadMoney(version)
  void loadAnnouncements(version)
  void loadStaffInsights(version)
  void loadDevInsights(version)
  try {
    const result = await w.http.get<Overview>('/dashboard', projectId.value ? { projectId: projectId.value } : {})
    if (version === revision) data.value = result
  } catch { if (version === revision) error.value = '首页数据暂时没加载出来，请重试。' }
  finally { if (version === revision) loading.value = false }
}
/* 收益类卡片各自读取，读不到就不显示那张卡片（不放假数据） */
async function loadMoney(version: number) {
  if (!isMember.value) return
  const today = shanghaiToday(), scope = projectId.value ? { projectId: projectId.value } : {}
  const [m, d, s, r, feed, self, avail] = await Promise.allSettled([
    w.http.get<Mine>('/earnings/mine', { ...scope, from: today.slice(0, 8) + '01', to: today, pageSize: 1 }),
    w.http.get<Daily>('/earnings/mine/daily', scope),
    w.http.get<MemberSummary>('/member-summary'),
    w.http.get<RelationMine>('/relations/mine', { pageSize: 6 }),
    w.http.get<Mine>('/earnings/mine', { ...scope, from: '2020-01-01', to: today, pageSize: 6 }),
    // M-H03：任务收益卡只看本人执行的业绩（group=self），团队分成不得混入
    w.http.get<Mine>('/earnings/mine', { ...scope, from: today.slice(0, 8) + '01', to: today, group: 'self', pageSize: 1 }),
    // M-H10：项目卡可领任务数取 tasks available，不用业绩数量冒充
    w.http.get<{ groups: { projectId: string; total: number | null }[] }>('/tasks', { view: 'available' }),
  ])
  if (version !== revision) return
  mine.value = m.status === 'fulfilled' ? m.value : null
  daily.value = d.status === 'fulfilled' ? d.value : null
  summary.value = s.status === 'fulfilled' ? s.value : null
  relation.value = r.status === 'fulfilled' ? r.value : null
  recent.value = feed.status === 'fulfilled' ? (feed.value.list ?? []) : []
  selfMine.value = self.status === 'fulfilled' ? self.value : null
  availableTasks.value = avail.status === 'fulfilled' ? (avail.value.groups ?? []) : []
  /* 团长加取近 30 天团队业绩明细：成员贡献按业绩人聚合 */
  if (w.role.value === 'leader') {
    try {
      const from = new Date(Date.parse(today) - 29 * 86400000).toISOString().slice(0, 10)
      const team = await w.http.get<Mine>('/earnings/mine', { ...scope, from, to: today, group: 'team', pageSize: 100 })
      if (version === revision) { teamLines.value = team.list ?? []; teamSummary.value = team }
      // 入团申请列表（M-L04：团长首页接回申请审批）
      try {
        const apps = await w.http.get<TeamApplication[]>('/team/applications')
        if (version === revision) applications.value = apps ?? []
      } catch { /* 申请列表读不到时卡不显示 */ }
    } catch { /* 团队明细读不到时成员贡献卡给空态 */ }
  }
}
/* 公告读取（右栏卡片用） */
async function loadAnnouncements(version: number) {
  try {
    const list = await w.http.get<Announcement[]>('/announcements/active')
    if (version === revision) announcements.value = list ?? []
  } catch { /* 公告读不到时卡不显示 */ }
}
/* 员工首页可视化（demo mock 契约，接口 404/失败时对应卡不显示） */
async function loadStaffInsights(version: number) {
  if (!isStaff.value || isDeveloper.value) return
  const get = async <T,>(path: string) => (await w.http.get<{ code: number; data: T } | T>(path)) as { code?: number; data?: T } & T
  const unwrap = <T,>(r: PromiseSettledResult<{ code?: number; data?: T } & T>): T | null =>
    r.status === 'fulfilled' ? (('data' in r.value && r.value.data !== undefined ? r.value.data : r.value) as T) : null
  const [sum, daily, top, ret, payouts, rec, pending] = await Promise.allSettled([
    get<InsightsSummary>('/insights/summary'),
    get<InsightsDaily>('/insights/daily'),
    get<TeamTop>('/insights/team-top'),
    get<Retention>('/insights/retention'),
    get<TodayPayouts>('/finance/today-payouts'),
    get<ReconcileProgress>('/finance/reconcile-progress'),
    get<PendingWithdrawals>('/finance/withdrawals/pending'),
  ])
  if (version !== revision) return
  insightsSummary.value = unwrap(sum)
  insightsDaily.value = unwrap(daily)
  teamTop.value = unwrap(top)
  retention.value = unwrap(ret)
  todayPayouts.value = unwrap(payouts)
  reconcile.value = unwrap(rec)
  pendingWithdrawals.value = unwrap(pending)
}
/* 开发者首页可视化（系统视角，demo mock 契约） */
async function loadDevInsights(version: number) {
  if (!isDeveloper.value) return
  const get = async <T,>(path: string) => (await w.http.get<{ code: number; data: T } | T>(path)) as { code?: number; data?: T } & T
  const unwrap = <T,>(r: PromiseSettledResult<{ code?: number; data?: T } & T>): T | null =>
    r.status === 'fulfilled' ? (('data' in r.value && r.value.data !== undefined ? r.value.data : r.value) as T) : null
  const [sum, daily, workers, activity, monitor, mini] = await Promise.allSettled([
    get<DevSummary>('/insights/dev-summary'),
    get<DevDaily>('/insights/dev-daily'),
    get<DevWorkers>('/insights/dev-workers'),
    get<DevActivity>('/insights/dev-activity'),
    get<AccountMonitorItem[]>('/admin-tools/monitor'),
    get<MiniMonitor>('/mini-monitor'),
  ])
  if (version !== revision) return
  devSummary.value = unwrap(sum)
  devDaily.value = unwrap(daily)
  devWorkers.value = unwrap(workers)
  devActivity.value = unwrap(activity)
  accountMonitor.value = unwrap(monitor)
  miniMonitor.value = unwrap(mini)
}
onMounted(load)

const todos = computed(() => data.value?.groups.flatMap(project => project.services.flatMap(service =>
  service.todos.map(todo => ({ ...todo, projectName: project.name, key: project.id + ':' + service.accountId + ':' + todo.kind }))))
  .concat((data.value?.todos ?? []).map(todo => ({ ...todo, projectName: '平台', key: 'platform:' + todo.kind }))) ?? [])
const todoTotal = computed(() => todos.value.reduce((sum, todo) => sum + todo.count, 0))
const todoByActor = computed(() => {
  const map = new Map<string, number>()
  for (const todo of todos.value) map.set(todo.actor, (map.get(todo.actor) ?? 0) + todo.count)
  return [...map.entries()].map(([actor, count]) => ({ actor, count })).sort((a, b) => b.count - a.count)
})
const unavailable = computed(() => data.value?.groups.some(project => project.services.some(service => service.status === 'unavailable')))
const noActivity = computed(() => !!data.value?.groups.length && data.value.groups.every(project => project.services.every(service =>
  service.status === 'ready' && service.metrics.every(metric => /^0(\.0+)?$/.test(metric.value ?? '0')))))
const display = (metric: Metric) => metric.value === null ? '待核对' : metric.unit === '元'
  ? Number(metric.value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : metric.value
const metricNumber = (metric: Metric) => Number(metric.value ?? 0)

/* 悬浮主卡：可提现（各项目合计）+ 本月收益 */
const wallet = computed(() => {
  const metrics = data.value?.groups.flatMap(project => project.services.flatMap(service => service.metrics.filter(metric => metric.key === 'wallet.available'))) ?? []
  return metrics.length ? { units: metrics.reduce((sum, metric) => sum + units(metric.value), 0n), path: metrics[0]?.path ?? '/income' } : null
})
const month = computed(() => mine.value ? {
  amount: units(mine.value.summary.amount), pending: units(mine.value.summary.pendingAmount), confirmed: units(mine.value.summary.confirmedAmount),
} : null)
const heroUnits = computed(() => month.value?.amount ?? wallet.value?.units ?? 0n)
/* 主卡底部的 30 天迷你走势（本人任务 + 团队分成）：取整段趋势，避免近 14 天全零时画一条平线 */
const spark = computed(() => {
  const t = trend.value
  if (!t || !t.hasData) return ''
  const n = t.labels.length
  const values = Array.from({ length: n }, (_, k) => t.series.reduce((sum, s) => sum + (s.points[k] ?? 0), 0))
  const max = Math.max(...values, 0.01), W = 240, H = 48
  return values.map((v, i) => `${i ? 'L' : 'M'}${(i * W / Math.max(1, values.length - 1)).toFixed(1)} ${(H - 4 - v / max * (H - 8)).toFixed(1)}`).join('')
})

/* 趋势：近 30 天，本人任务与团队分成两条线 */
const trend = computed(() => {
  if (!daily.value) return null
  const labels: string[] = [], dates: string[] = []
  for (let t = Date.parse(daily.value.from); t <= Date.parse(daily.value.to); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10)
    dates.push(d); labels.push(d.slice(5))
  }
  const index = new Map(dates.map((d, i) => [d, i]))
  const self = dates.map(() => 0n), team = dates.map(() => 0n)
  for (const day of daily.value.days) {
    const i = index.get(day.date)
    if (i === undefined) continue
    const target = day.group === 'team' ? team : self
    target[i] = (target[i] ?? 0n) + units(day.amount)
  }
  const sum = (list: bigint[]) => list.reduce((a, b) => a + b, 0n)
  const series: (TrendSeries & { total: bigint })[] = [{ label: '本人任务', color: '#d46b45', points: self.map(toNumber), area: true, total: sum(self) }]
  if (w.role.value === 'leader' || sum(team) > 0n) series.push({ label: '团队管理收益', color: '#3b7dd8', points: team.map(toNumber), total: sum(team) })
  return { labels, series, hasData: series.some(s => s.total !== 0n) }
})

/* 构成：本月按业绩类型；团长再看累计已确认的本人与团队分成 */
// 业绩类型用绿、紫，和「本人任务 / 团队分成」的橙、蓝区分开（同一张卡里颜色不重复含义）
const TYPE_COLORS = ['var(--chart-3)', 'var(--chart-4)', 'var(--chart-2)', 'var(--chart-1)']
const composition = computed<ShareItem[]>(() => {
  if (!mine.value) return []
  const byType = new Map<string, { label: string; units: bigint }>()
  for (const group of mine.value.groups) {
    const entry = byType.get(group.metricType) ?? { label: group.metricLabel, units: 0n }
    entry.units += units(group.amount)
    byType.set(group.metricType, entry)
  }
  return [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v.units > 0n)
    .map(([, v], i) => ({ label: v.label, value: toNumber(v.units), text: '¥' + yuan(v.units), color: TYPE_COLORS[i % TYPE_COLORS.length] ?? 'var(--chart-1)' }))
})
const teamShare = computed<ShareItem[]>(() => {
  const s = summary.value
  if (!s?.team) return []
  const own = units(s.direct.total), team = units(s.team.reward.total)
  if (own + team === 0n) return []
  return [
    { label: '本人任务', value: toNumber(own), text: '¥' + yuan(own), color: 'var(--chart-1)' },
    { label: '团队管理收益', value: toNumber(team), text: '¥' + yuan(team), color: 'var(--chart-2)' },
  ]
})
const showShareCard = computed(() => isMember.value && (composition.value.length > 0 || teamShare.value.length > 0 || !!summary.value?.team))

/* ===== v2 成员视图 ===== */
/* 成长参考：展示真实统计，不生成达标结论（M-H07：晋升阈值未正式确认，只列运营提名时的参考指标） */
const growth = computed(() => {
  const activeDays = summary.value?.metrics?.activeDays ?? null
  const direct = relation.value?.counts.direct ?? null
  const monthAmount = selfTaskUnits.value !== null ? toNumber(selfTaskUnits.value) : null
  const stats = [
    { label: '近 30 天活跃', text: activeDays === null ? '' : `${activeDays} 天` },
    { label: '直接邀请', text: direct === null ? '' : `${direct} 人` },
    { label: '本月任务收益', text: monthAmount === null ? '' : `¥${money(monthAmount).slice(1)}` },
  ]
  return { stats, hasData: stats.some(s => s.text) }
})
/* 任务收益小卡的拆分说明：知乎 110 单 · 红果 347 次（仅本人执行的业绩，拉新/拉活各自带单位） */
const taskSplit = computed(() => {
  if (!selfMine.value) return ''
  return selfMine.value.groups
    .filter(group => Number(group.quantity ?? 0) > 0)
    .map(group => `${group.projectName ?? ''} ${Number(group.quantity).toLocaleString('zh-CN')} ${group.quantityUnit ?? group.metricLabel}`.trim())
    .join(' · ')
})
/* 任务收益小卡金额：本人执行的业绩（M-H03：group=self，不含收到的团队分成） */
const selfTaskUnits = computed(() => selfMine.value ? units(selfMine.value.summary.amount) : null)
/* 近 30 天团队收益（M-L02：与成员贡献同口径，不再用累计冒充本月） */
const teamMonthUnits = computed(() => teamSummary.value ? units(teamSummary.value.summary.amount) : null)
/* 最近收益 feed：最近 6 笔（不限月份） */
const recentLines = computed(() => recent.value.slice(0, 6))
/* 项目广场：已开通项目 + 抽象插画（按项目名取色与形状） */
const PROJECT_PALETTES: [string, string][] = [['#d46b45', '#f6e5dc'], ['#3b7dd8', '#e3ecf8'], ['#4e9a4a', '#e5f0e3'], ['#8e6cc9', '#efe9f8']]
function art(projectName: string) {
  const seed = [...projectName].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 7
  const [c1, c2] = PROJECT_PALETTES[seed % PROJECT_PALETTES.length]!
  const s = seed % 4
  return { c1, c2, seed: s }
}
const projectCards = computed(() => (data.value?.groups ?? []).map(project => {
  const groups = mine.value?.groups.filter(group => group.projectId === project.id) ?? []
  const amount = groups.reduce((sum, group) => sum + units(group.amount), 0n)
  const available = availableTasks.value.find(group => group.projectId === project.id)?.total ?? null
  return { id: project.id, name: project.name, art: art(project.name), available, amount }
}))

/* 团长专属：成员贡献（本月团队业绩按业绩人聚合，取前 8） */
const isLeader = computed(() => w.role.value === 'leader')
const contributors = computed(() => {
  const byName = new Map<string, bigint>()
  for (const line of teamLines.value) {
    const name = line.performerName ?? '成员'
    byName.set(name, (byName.get(name) ?? 0n) + units(line.amount))
  }
  const list = [...byName.entries()].map(([name, amount]) => ({ name, amount, value: toNumber(amount) }))
    .sort((a, b) => b.value - a.value).slice(0, 8)
  const max = Math.max(1, ...list.map(item => item.value))
  return { list, max, total: list.reduce((sum, item) => sum + item.amount, 0n) }
})

/* 主卡倾斜：只是视觉反馈 */
function tilt(event: PointerEvent) {
  const el = event.currentTarget as HTMLElement, box = el.getBoundingClientRect()
  const px = (event.clientX - box.left) / box.width, py = (event.clientY - box.top) / box.height
  el.style.setProperty('--rx', `${((0.5 - py) * 6).toFixed(2)}deg`); el.style.setProperty('--ry', `${((px - 0.5) * 8).toFixed(2)}deg`)
  el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`); el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`)
}
function untilt(event: PointerEvent) {
  const el = event.currentTarget as HTMLElement
  el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg')
}
</script>
<template>
  <section class="page-stack home-page" :aria-busy="loading">
    <div v-if="error || unavailable" class="home-error" role="alert"><p>{{ error || '部分项目暂时没加载出来，已加载的待办仍可处理。' }}</p><button class="ghost-aurora" @click="load" :disabled="loading">重新加载</button></div>

    <!-- ===== 成员视图：v2 三栏（钱包+趋势+小卡矩阵+项目广场 | 右栏） ===== -->
    <template v-if="isMember">
      <div class="home-toolbar">
        <label>项目 <select v-model="projectId" @change="load"><option value="">全部项目</option><option v-for="project in data?.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
        <button class="btn" @click="load" :disabled="loading">{{ loading ? '刷新中…' : '刷新' }}</button>
      </div>
      <div class="home-v2">
        <div class="bento enter">
          <!-- 钱包卡 -->
          <article v-if="wallet || month" class="card wallet float lift" style="--s:5;--i:0" @pointermove="tilt" @pointerleave="untilt">
            <svg v-if="spark" class="spark" width="110" height="22" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true"><path :d="spark" pathLength="1" fill="none" stroke="#f0b49b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <div class="lbl">{{ month ? '本月收益' : '可提现余额' }}</div>
            <div class="big num"><small>¥</small><AnimatedNumber :value="toNumber(heroUnits)" :decimals="2" :text="yuan(heroUnits)" /></div>
            <div v-if="month" class="meta">
              <div v-if="wallet"><b>¥{{ yuan(wallet.units) }}</b>可提现</div>
              <div><b>¥{{ yuan(month.confirmed) }}</b>已确认</div>
              <div><b>¥{{ yuan(month.pending) }}</b>待确认</div>
            </div>
            <div class="acts">
              <router-link class="btn white" :to="wallet?.path ?? '/income'">{{ wallet ? '申请提现' : '查看收益' }}</router-link>
              <router-link class="btn light" to="/income">收益明细 →</router-link>
            </div>
          </article>

          <!-- 收益趋势 -->
          <article v-if="trend" class="card lift" style="--s:7;--i:1">
            <div class="card-h"><h3>收益趋势</h3><span class="muted" style="font-size:12.5px">近 30 天 · 含待确认</span></div>
            <template v-if="trend.hasData">
              <div class="legend" style="margin-bottom:10px"><span v-for="s in trend.series" :key="s.label"><i :style="{ background: s.color }" />{{ s.label }}<b>¥{{ yuan(s.total) }}</b></span></div>
              <TrendChart :labels="trend.labels" :series="trend.series" :height="210" :format="money" caption="近 30 天每日收益" />
            </template>
            <div v-else class="bento-empty"><b>最近 30 天还没有收益</b><p>完成任务、报表核对后，每天的收益会画在这里。</p><router-link class="btn ink" to="/task-hall" style="margin-top:10px">去任务大厅</router-link></div>
          </article>

          <!-- 团长专属：直邀成员 -->
          <article v-if="isLeader && relation" class="card lift" style="--s:4;--i:2">
            <div class="card-h"><span class="ic" style="background:var(--clay-soft);color:var(--clay-deep)">◉</span><h3>直邀成员</h3><span class="chip soft r">显性</span></div>
            <div class="big num"><AnimatedNumber :value="relation.counts.direct" :decimals="0" /><small style="margin-left:4px">人</small></div>
            <div v-if="relation.directList.length" class="avs" style="margin-top:10px">
              <span v-for="(p, i) in relation.directList.slice(0, 5)" :key="i" :style="{ background: PROJECT_PALETTES[i % 4]![0], '--k': i }" :title="p.name">{{ p.name.slice(0, 1) }}</span>
              <span v-if="relation.counts.direct > 5" style="background:var(--hover);color:var(--ink-3)">+{{ relation.counts.direct - 5 }}</span>
            </div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">直接邀请的成员，业绩与名单都可查</p>
          </article>

          <!-- 团长专属：团队下级（隐性，只显示人数） -->
          <article v-if="isLeader && relation" class="card lift" style="--s:4;--i:3">
            <div class="card-h"><span class="ic" style="background:var(--hover)">🔒</span><h3>团队下级</h3><span class="chip soft r">隐性</span></div>
            <div class="big num"><AnimatedNumber :value="relation.counts.indirect" :decimals="0" /><small style="margin-left:4px">人</small></div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">由你的成员邀请加入，属于你的团队，只显示人数<template v-if="relation.indirectList?.length">：{{ relation.indirectList.slice(0, 6).map(p => p.name).join('、') }}{{ relation.indirectList.length > 6 ? ' 等' : '' }}</template></p>
          </article>

          <!-- 团长专属：近 30 天团队收益（M-L02：与贡献图同口径，不再用累计冒充本月） -->
          <article v-if="isLeader && teamMonthUnits !== null" class="card lift" style="--s:4;--i:4">
            <div class="card-h"><h3>近 30 天团队收益</h3><span class="chip soft r">团队 {{ summary?.team?.memberCount ?? 0 }} 人</span></div>
            <div class="big num"><small>¥</small><AnimatedNumber :value="toNumber(teamMonthUnits)" :decimals="2" :text="yuan(teamMonthUnits)" /></div>
            <p class="muted" style="font-size:12.5px;margin-top:4px">成员业绩 × 团长单价，按业绩当天归属计算</p>
          </article>

          <!-- 任务收益（本人执行的业绩） -->
          <article v-if="selfTaskUnits !== null" class="card lift" style="--s:4;--i:2">
            <div class="card-h"><span class="ic" style="background:var(--clay-soft);color:var(--clay-deep)">☰</span><h3>任务收益</h3><span class="chip soft r">本月</span></div>
            <div class="big num"><small>¥</small><AnimatedNumber :value="toNumber(selfTaskUnits)" :decimals="2" :text="yuan(selfTaskUnits)" /></div>
            <p class="muted" style="font-size:12.5px;margin-top:4px">{{ taskSplit || '本月还没有任务收益记录' }}</p>
          </article>

          <!-- 近 30 天活跃（M-H04：邀请分成规则未确认，不再用本人收益冒充邀请收益） -->
          <article v-if="summary?.metrics" class="card lift" style="--s:4;--i:3">
            <div class="card-h"><span class="ic" style="background:#efe9f8;color:var(--c4)">◷</span><h3>近 30 天活跃</h3><span class="chip clay r">{{ summary.metrics.records }} 条记录</span></div>
            <div class="big num"><AnimatedNumber :value="summary.metrics.activeDays" :decimals="0" /><small style="margin-left:4px">天</small></div>
            <p class="muted" style="font-size:12.5px;margin-top:4px">活跃天数是晋升团长的参考之一</p>
          </article>

          <!-- 成长参考：展示真实统计，不出达标结论（团长已晋升不显示） -->
          <article v-if="growth.hasData && !isLeader" class="card lift" style="--s:4;--i:5">
            <div class="card-h"><h3>成长参考</h3><span class="muted r" style="font-size:12.5px">晋升由运营提名</span></div>
            <div class="growth-rules">
              <div v-for="stat in growth.stats" :key="stat.label"><b style="color:var(--ink)">{{ stat.text }}</b><span class="muted" style="margin-left:6px">{{ stat.label }}</span></div>
            </div>
            <p class="muted" style="font-size:12px;margin-top:12px">这些是运营提名晋升时的参考指标，不是自动达标线。</p>
          </article>

          <!-- 收益构成 -->
          <article class="card lift" style="--s:4;--i:6">
            <div class="card-h"><h3>收益构成</h3><span class="muted r" style="font-size:12.5px">本月</span></div>
            <ShareBar v-if="composition.length" :items="composition" />
            <p v-else class="muted" style="font-size:12.5px">本月还没有收益记录，完成任务后这里会按业绩类型拆开。</p>
            <template v-if="teamShare.length">
              <div class="card-h" style="margin-top:16px"><h3>任务与团队管理收益</h3><span class="muted r" style="font-size:12px">累计已确认</span></div>
              <ShareBar :items="teamShare" />
            </template>
          </article>

          <!-- 邀请好友 -->
          <article class="card lift" style="--s:4;--i:7">
            <div class="card-h"><h3>邀请好友</h3><span class="chip clay r">注册即建立关系</span></div>
            <div v-if="relation?.directList.length" class="avs" style="margin:4px 0 10px">
              <span v-for="(p, i) in relation.directList.slice(0, 5)" :key="i" :style="{ background: PROJECT_PALETTES[i % 4]![0], '--k': i }">{{ p.name.slice(0, 1) }}</span>
            </div>
            <p class="muted" style="font-size:12.5px">好友注册 180 天内的业绩，你都有邀请收益</p>
            <router-link class="btn ink" to="/invite-center" style="margin-top:14px">去邀请好友</router-link>
          </article>

          <!-- 团长专属：成员贡献（近 30 天团队业绩按业绩人，前 8） -->
          <article v-if="isLeader" class="card lift" style="--s:12;--i:8">
            <div class="card-h"><h3>成员贡献</h3><span class="muted" style="font-size:12.5px">近 30 天带来的团队收益</span><span v-if="contributors.list.length" class="chip soft r">前 8 名</span></div>
            <svg v-if="contributors.list.length" class="chart contrib-chart" viewBox="0 0 720 190" preserveAspectRatio="none" role="img" aria-label="成员贡献柱状图">
              <g v-for="(item, i) in contributors.list" :key="item.name">
                <rect class="bar" :style="{ '--i': i }" :x="20 + i * 86" :y="150 - (item.value / contributors.max) * 120" width="44" :height="Math.max(3, (item.value / contributors.max) * 120)" rx="8" fill="var(--c1)" :opacity="0.45 + 0.55 * (item.value / contributors.max)" />
                <text class="ax" :x="42 + i * 86" y="170" text-anchor="middle">{{ item.name }}</text>
                <text class="ax" :x="42 + i * 86" :y="140 - (item.value / contributors.max) * 120" text-anchor="middle" style="font-weight:650;fill:var(--ink)">¥{{ Math.round(item.value) }}</text>
              </g>
            </svg>
            <p v-else class="muted" style="font-size:12.5px">近 30 天还没有团队业绩，成员完成任务后这里会按人拆开。</p>
          </article>

          <!-- 团长专属：入团申请（待审批才显示） -->
          <article v-if="isLeader && pendingApplications.length" class="card lift" style="--s:4;--i:8">
            <div class="card-h"><h3>入团申请</h3><span class="chip clay r">{{ pendingApplications.length }}</span></div>
            <div v-for="app in pendingApplications.slice(0, 3)" :key="app.id" class="row">
              <span class="av" style="background:var(--c3)">{{ app.creatorName.slice(0, 1) }}</span>
              <div class="t"><b>{{ app.creatorName }}</b><small>{{ app.message || '申请加入你的团队' }}</small></div>
              <div style="display:flex;gap:6px;flex:none">
                <button class="btn ink" style="height:30px;padding:0 12px" :disabled="applicationBusy === app.id" @click="reviewApplication(app.id, 'approve')">同意</button>
                <button class="btn" style="height:30px;padding:0 12px" :disabled="applicationBusy === app.id" @click="reviewApplication(app.id, 'reject')">拒绝</button>
              </div>
            </div>
            <p class="muted" style="font-size:12px;margin-top:10px">同意后从今天起计入团队，历史业绩不受影响。</p>
          </article>

          <!-- 现在要做（有待办才显示） -->
          <section v-if="todos.length" class="card" style="--s:12;--i:8" aria-labelledby="home-todos">
            <div class="card-h"><h3 id="home-todos">现在要做</h3><span class="chip clay r">{{ todos.length }} 项</span></div>
            <div class="home-todos"><router-link v-for="todo in todos" :key="todo.key" :to="todo.path" class="home-todo"><span class="home-todo-count">{{ todo.count }}</span><div><h3>{{ todo.label }}</h3><p>{{ todo.projectName }} · {{ todo.actor }}</p></div><span class="home-todo-action">{{ todo.actionLabel }} →</span></router-link></div>
          </section>

          <!-- 项目广场 -->
          <article v-if="projectCards.length" class="card" style="--s:12;--i:9">
            <div class="card-h"><h3>项目广场</h3><span class="muted" style="font-size:12.5px">我们承接的项目，统一在这里领取</span><router-link class="btn r" to="/task-hall" style="height:32px">全部任务 →</router-link></div>
            <div class="projects">
              <router-link v-for="project in projectCards" :key="project.id" class="proj" :to="{ path: '/task-hall', query: project.id ? { projectId: project.id } : {} }">
                <svg class="art" viewBox="0 0 200 92" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="200" height="92" :fill="project.art.c2" /><circle :cx="150 - project.art.seed * 10" :cy="30 + project.art.seed * 6" :r="34 + project.art.seed * 4" :fill="project.art.c1" opacity=".9" /><circle :cx="60 + project.art.seed * 14" cy="78" :r="26 - project.art.seed * 3" fill="#fff" opacity=".55" /><rect :x="20 + project.art.seed * 8" y="22" width="56" height="10" rx="5" fill="#fff" opacity=".8" /><rect :x="20 + project.art.seed * 8" y="38" width="34" height="8" rx="4" fill="#fff" opacity=".6" /></svg>
                <span v-if="project.available" class="chip up tg">{{ project.available }} 个任务可领取</span>
                <b>{{ project.name }}</b>
                <small>按业绩计酬 · 本月 ¥{{ yuan(project.amount) }}</small>
              </router-link>
              <div class="proj add"><div style="font-size:26px;line-height:1">＋</div><b style="color:var(--ink-3);margin-top:6px">更多项目接入中</b><small>聚合平台 · 即插即用</small></div>
            </div>
          </article>
        </div>

        <!-- 右栏 -->
        <aside class="home-aside">
          <div class="card profile">
            <div class="big-av">{{ (w.userName?.value ?? '我').slice(0, 1) }}</div>
            <h4>{{ w.userName?.value ?? '我' }}</h4>
            <p class="muted" style="font-size:12.5px">{{ w.role.value === 'leader' ? '团长' : '达人' }} · {{ relation?.team?.leaderName ? relation.team.leaderName + ' 的团队' : '平台直管' }}</p>
            <div class="profile-stats">
              <div><b class="serif">{{ relation?.counts.direct ?? 0 }}</b><span>直邀</span></div>
              <div><b class="serif">{{ summary?.metrics?.activeDays ?? 0 }}</b><span>活跃天</span></div>
              <div><b class="serif">{{ summary?.metrics?.memberDays ?? 0 }}</b><span>注册天</span></div>
            </div>
          </div>
          <div v-if="relation" class="card">
            <div class="card-h"><h3>我的关系</h3><span class="muted r" style="font-size:12px">永久记录</span></div>
            <div class="row"><span class="av" style="background:var(--c2)">{{ (relation.inviter?.name ?? '自').slice(0, 1) }}</span><div class="t"><b>{{ relation.inviter ? relation.inviter.name + ' 邀请了你' : '自行注册' }}</b><small>{{ relation.inviter ? (relation.channel ?? '邀请加入') : '直接加入平台，没有邀请人' }}</small></div></div>
            <div class="row"><span class="av" style="background:var(--c2)">{{ (relation.team?.leaderName ?? '平').slice(0, 1) }}</span><div class="t"><b>{{ relation.team?.leaderName ? `你在 ${relation.team.leaderName} 的团队` : '平台直管' }}</b><small>团队收益按业绩当天的归属计算</small></div></div>
            <router-link class="row" to="/invite-center" style="text-decoration:none;color:inherit"><span class="av" style="background:var(--c3)">{{ relation.counts.direct }}</span><div class="t"><b>你直接邀请了 {{ relation.counts.direct }} 位好友</b><small>好友注册 180 天内的业绩都有邀请收益</small></div></router-link>
          </div>
          <div class="card feed">
            <div class="card-h"><h3>最近收益</h3><router-link class="muted r" to="/income" style="font-size:12px;text-decoration:none">收益明细 →</router-link></div>
            <template v-if="recentLines.length">
              <div v-for="line in recentLines" :key="line.id" class="it">
                <span class="ic2" style="background:var(--clay-soft);color:var(--clay-deep)">¥</span>
                <div class="t" style="flex:1;min-width:0"><b style="font-size:13px">{{ line.taskName ?? line.metricLabel }}</b><div class="muted" style="font-size:12px">{{ line.businessDate.slice(5) }} · {{ line.confirmedAt ? '已确认' : '待确认' }}</div></div>
                <b class="amt">+¥{{ yuan(units(line.amount)) }}</b>
              </div>
            </template>
            <p v-else class="muted" style="font-size:12.5px">本月还没有收益记录，完成任务后收益会出现在这里。</p>
          </div>
        </aside>
      </div>
    </template>

    <!-- ===== 开发者视图：系统运行视角（处理量/队列/Worker/巡检，不看业务金额） ===== -->
    <template v-else-if="isDeveloper">
    <div class="home-v2">
      <div class="bento enter">
        <!-- 今日处理主卡 -->
        <article v-if="devSummary" class="card wallet float lift" style="--s:5;--i:0">
          <div class="lbl">今日处理业绩</div>
          <div class="big num"><AnimatedNumber :value="devSummary.processedToday" :decimals="0" :text="devSummary.processedToday.toLocaleString('zh-CN')" /><small style="font-size:16px;margin-left:4px">条</small></div>
          <div class="pill">{{ devSummary.queueBacklog ? `队列 ${devSummary.queueBacklog} 条积压` : '队列无积压' }} · {{ devSummary.failures24h ? `近 24 小时 ${devSummary.failures24h} 条失败` : '全部按时完成' }}</div>
          <div class="meta">
            <div><b>{{ devSummary.syncTasks }}</b>同步任务</div>
            <div><b>{{ devSummary.patrols }}</b>定时巡检</div>
            <div><b>{{ devSummary.failures24h }}</b>失败</div>
          </div>
          <div class="acts">
            <router-link class="btn white" to="/system/monitor">查看监控</router-link>
            <router-link class="btn light" to="/audit-log">审计日志 →</router-link>
          </div>
        </article>

        <!-- 待办列表（与员工一致） -->
        <section class="card" :style="{ '--s': devSummary ? 7 : 12, '--i': 1 }" aria-labelledby="home-todos-dev">
          <div class="card-h"><h3 id="home-todos-dev">待办</h3><span v-if="todos.length" class="chip clay r">{{ todos.length }} 项</span></div>
          <template v-if="todos.length">
            <router-link v-for="todo in todos" :key="todo.key" :to="todo.path" class="row" style="text-decoration:none;color:inherit">
              <span class="home-todo-count">{{ todo.count }}</span>
              <div class="t"><b>{{ todo.label }}</b><small>{{ todo.projectName }} · {{ todo.actor }}</small></div>
              <span class="home-todo-action">{{ todo.actionLabel }} →</span>
            </router-link>
          </template>
          <div v-else-if="!loading && !error" class="bento-empty home-empty"><b>都处理完了</b><p>系统任务和业务待办会出现在这里和顶栏铃铛里。</p></div>
          <p v-else-if="loading && !data" role="status">正在整理待办…</p>
        </section>

        <!-- 处理量趋势 -->
        <article v-if="devTrend" class="card lift" style="--s:7;--i:2">
          <div class="card-h"><h3>处理量趋势</h3><span class="muted" style="font-size:12.5px">业绩条数 · 近 30 天 · 演示数据</span></div>
          <TrendChart :labels="devTrend.labels" :series="devTrend.series" :height="210" :format="(v: number) => v.toLocaleString('zh-CN')" caption="近 30 天每日处理量" />
        </article>

        <!-- Worker 状态 -->
        <article v-if="devWorkers" class="card lift" style="--s:5;--i:3">
          <div class="card-h"><h3>Worker 状态</h3><span class="r" style="display:flex;align-items:center;gap:6px;color:var(--ok,#4e9a4a);font-size:12.5px"><span style="width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block"></span>{{ devWorkers.list.every(x => x.ok) ? '全部正常' : '有异常' }}</span></div>
          <div v-for="x in devWorkers.list" :key="x.name" style="display:flex;font-size:13px;padding:6px 0">
            <span class="muted">{{ x.name }}</span><b style="margin-left:auto;font-weight:600" :style="{ color: x.ok ? 'inherit' : 'var(--clay-deep)' }">{{ x.note }}</b>
          </div>
          <p class="muted" style="font-size:12px;margin-top:8px">同步、队列与巡检的实时明细在运维监控页。</p>
        </article>

        <!-- 队列 -->
        <article v-if="devSummary" class="card lift" style="--s:4;--i:4">
          <div class="card-h"><h3>队列</h3><span class="chip r" :class="devSummary.queueBacklog ? 'clay' : 'soft'">{{ devSummary.queueBacklog ? '有积压' : '无积压' }}</span></div>
          <div class="big num" style="font-size:30px">{{ devSummary.queueBacklog }}<small>条</small></div>
          <p class="muted" style="font-size:12.5px;margin-top:4px">收益计算 / 回传 / 通知队列</p>
        </article>

        <!-- 近 24 小时失败 -->
        <article v-if="devSummary" class="card lift" style="--s:4;--i:5">
          <div class="card-h"><h3>近 24 小时失败</h3></div>
          <div class="big num" style="font-size:30px">{{ devSummary.failures24h }}<small>条</small></div>
          <p class="muted" style="font-size:12.5px;margin-top:4px">{{ devSummary.lastFailure ? `最近一次失败：${devSummary.lastFailure}` : '没有失败记录' }}</p>
        </article>

        <!-- 接口健康（真实数据：小程序接入监控） -->
        <article v-if="apiHealth" class="card lift" style="--s:4;--i:6">
          <div class="card-h"><h3>接口健康</h3><router-link class="chip soft r" to="/system/monitor" style="text-decoration:none">运维监控 →</router-link></div>
          <div class="big num" style="font-size:30px">{{ apiHealth.failurePct === null ? '暂无观测' : `${100 - Number(apiHealth.failurePct)}` }}<small v-if="apiHealth.failurePct !== null">% 可用</small></div>
          <div class="growth-rules" style="margin-top:8px">
            <div>近 24h 请求 <b>{{ apiHealth.requests.toLocaleString('zh-CN') }}</b> 次</div>
            <div>服务错误 <b>{{ apiHealth.serverErrors }}</b> · 拒绝 <b>{{ apiHealth.rejected }}</b></div>
            <div>平均处理耗时 <b>{{ apiHealth.averageMs === null ? '暂无观测' : `${apiHealth.averageMs} ms` }}</b></div>
          </div>
        </article>

        <!-- 账号接入（真实数据：小程序绑定概况） -->
        <article v-if="accessSplit" class="card lift" style="--s:4;--i:7">
          <div class="card-h"><h3>账号接入</h3><span class="chip soft r">小程序</span></div>
          <div class="big num" style="font-size:30px">{{ accessSplit.bound }}<small>个已绑定微信</small></div>
          <div class="stack" style="margin-top:10px;height:10px">
            <i :style="{ flexGrow: Math.max(accessSplit.bound, 0.001), background: '#4e9a4a' }" title="已绑定" />
            <i :style="{ flexGrow: Math.max(accessSplit.unbound, 0.001), background: 'var(--line-2)' }" title="未绑定" />
          </div>
          <div class="legend" style="margin-top:10px">
            <span><i style="background:#4e9a4a" />已绑定<b>{{ accessSplit.bound }}</b></span>
            <span><i style="background:var(--line-2)" />未绑定<b>{{ accessSplit.unbound }}</b></span>
            <span>有效会话<b>{{ accessSplit.sessions }}</b></span>
          </div>
        </article>

        <!-- 近 7 日账号操作量（真实数据） -->
        <article v-if="monitorTop.length" class="card lift" style="--s:8;--i:8">
          <div class="card-h"><h3>近 7 日操作量</h3><span class="muted" style="font-size:12.5px">按账号 · 前 8 名</span></div>
          <BarChart :items="monitorTop" color="#3b7dd8" />
        </article>
      </div>

      <!-- 右栏：资料 + 任务动态 + 公告 -->
      <aside class="home-aside">
        <div class="card profile">
          <div class="big-av" style="background:linear-gradient(135deg,#3b7dd8,#1d4ed8)">{{ (w.userName?.value ?? '我').slice(0, 1) }}</div>
          <h4>{{ w.userName?.value ?? '我' }}</h4>
          <p class="muted" style="font-size:12.5px">开发者 · 数据与队列</p>
          <div v-if="devSummary" class="profile-stats">
            <div><b>{{ devSummary.weekImports }}</b><span>本周导入</span></div>
            <div><b>{{ devSummary.weekPatrols }}</b><span>本周巡检</span></div>
            <div><b>{{ devSummary.weekFixes }}</b><span>本周修复</span></div>
          </div>
        </div>
        <div v-if="devActivity?.list.length" class="card">
          <div class="card-h"><h3>任务动态</h3><span class="muted r" style="font-size:12px">演示数据</span></div>
          <div v-for="(x, i) in devActivity.list" :key="i" class="row">
            <span :style="{ width: '8px', height: '8px', borderRadius: '50%', background: DEV_TONES[x.tone] ?? '#b0aea5', flex: 'none' }"></span>
            <div class="t"><b>{{ x.title }}</b><small>{{ x.detail }}</small></div>
          </div>
        </div>
        <div v-if="announcements.length" class="card">
          <div class="card-h"><h3>公告</h3><span class="muted r" style="font-size:12px">{{ announcements.length }} 条</span></div>
          <div v-for="a in announcements.slice(0, 4)" :key="a.id" class="row">
            <div class="t"><b>{{ a.title }}</b><small>{{ a.content.slice(0, 48) }}{{ a.content.length > 48 ? '…' : '' }}</small></div>
          </div>
        </div>
      </aside>
    </div>
    </template>

    <!-- ===== 员工视图：v2 三栏（职务主卡用非金额业务量，金额卡等财务账源接入后点亮） ===== -->
    <template v-else>
    <div class="home-toolbar">
      <label>项目 <select v-model="projectId" @change="load"><option value="">全部项目</option><option v-for="project in data?.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
      <button class="btn" @click="load" :disabled="loading">{{ loading ? '刷新中…' : '刷新' }}</button>
    </div>
    <div class="home-v2">
      <div class="bento enter">
        <!-- 职务主卡：待办与业务概览（非金额，金额卡待 BE-08 账源） -->
        <article class="card wallet float lift" style="--s:5;--i:0">
          <div class="lbl">现在要做</div>
          <div class="big num"><AnimatedNumber :value="todoTotal" :decimals="0" /><small style="font-size:16px;margin-left:4px">项待办</small></div>
          <div class="pill">{{ todoByActor.length ? todoByActor.map(a => `${a.actor} ${a.count}`).join(' · ') : '都处理完了' }}</div>
          <div v-if="todoByActor.length" class="stack" style="margin-top:14px;height:10px">
            <i v-for="(a, i) in todoByActor" :key="a.actor" :style="{ flexGrow: a.count, background: ['#f0b49b', '#8e6cc9', '#5b8fe0', '#4e9a4a'][i % 4] }" :title="`${a.actor} ${a.count} 项`"></i>
          </div>
          <div class="acts"><router-link v-if="todos[0]" class="btn white" :to="todos[0].path">{{ todos[0].actionLabel || '去处理' }}</router-link><router-link v-else class="btn light" :to="staffWorkbenchPath">去工作台</router-link></div>
        </article>

        <!-- 财务/管理员：待打款主卡（demo mock 契约） -->
        <article v-if="isFinanceStaff && pendingWithdrawals" class="card wallet float lift" style="--s:5;--i:1">
          <div class="lbl">待打款</div>
          <div class="big num"><small>¥</small><AnimatedNumber :value="toNumber(units(pendingWithdrawals.totalAmount))" :decimals="2" :text="yuan(units(pendingWithdrawals.totalAmount))" /></div>
          <div class="meta">
            <div><b>{{ pendingWithdrawals.count }}</b>笔待审批</div>
            <div><b>¥{{ yuan(units(pendingWithdrawals.todayPaid)) }}</b>今日已发</div>
            <div><b>¥{{ yuan(units(pendingWithdrawals.monthPaid)) }}</b>本月已发</div>
          </div>
          <div class="acts">
            <router-link class="btn white" to="/finance">去审批提现</router-link>
            <span v-if="pendingWithdrawals.failedCount" class="chip clay" style="align-self:center">{{ pendingWithdrawals.failedCount }} 笔发放失败</span>
          </div>
          <p class="muted" style="font-size:12px;margin-top:10px">最早一笔提交于 {{ pendingWithdrawals.earliest }}</p>
        </article>

        <!-- 财务/管理员：总览四数 -->
        <template v-if="isFinanceStaff && insightsSummary">
          <article class="card lift" style="--s:4;--i:2">
            <div class="card-h"><h3>上游收入</h3><span class="chip soft r">近 30 天</span></div>
            <div class="big num"><small>¥</small><AnimatedNumber :value="toNumber(units(insightsSummary.upstream))" :decimals="2" :text="yuan(units(insightsSummary.upstream))" /></div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">环比 {{ insightsSummary.upstreamChange }}</p>
          </article>
          <article class="card lift" style="--s:4;--i:3">
            <div class="card-h"><h3>成员支出</h3><span class="chip soft r">近 30 天</span></div>
            <div class="big num"><small>¥</small><AnimatedNumber :value="toNumber(units(insightsSummary.memberPayout))" :decimals="2" :text="yuan(units(insightsSummary.memberPayout))" /></div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">占上游 {{ insightsSummary.payoutRatio }}</p>
          </article>
          <article class="card lift" style="--s:4;--i:4">
            <div class="card-h"><h3>平台留存</h3><span class="chip clay r">{{ insightsSummary.retentionRate }}</span></div>
            <div class="big num"><small>¥</small><AnimatedNumber :value="toNumber(units(insightsSummary.retention))" :decimals="2" :text="yuan(units(insightsSummary.retention))" /></div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">活跃成员 {{ insightsSummary.activeMembers }} 人</p>
          </article>
        </template>

        <!-- 运营：业务量总览（无金额权限，接口已按岗位收窄） -->
        <template v-if="isOperator && insightsSummary">
          <article class="card lift" style="--s:4;--i:2">
            <div class="card-h"><h3>活跃成员</h3><span class="chip soft r">近 30 天</span></div>
            <div class="big num"><AnimatedNumber :value="insightsSummary.activeMembers" :decimals="0" /><small style="margin-left:4px">人</small></div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">环比 {{ insightsSummary.upstreamChange }}，新增 {{ insightsSummary.newMembers }} 人</p>
          </article>
          <article class="card lift" style="--s:4;--i:3">
            <div class="card-h"><h3>业绩量</h3><span class="chip soft r">近 30 天</span></div>
            <div class="big num"><AnimatedNumber :value="insightsSummary.taskCount ?? 0" :decimals="0" :text="(insightsSummary.taskCount ?? 0).toLocaleString('zh-CN')" /></div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">全部项目合计</p>
          </article>
          <article class="card lift" style="--s:4;--i:4">
            <div class="card-h"><h3>活跃团队</h3><span class="chip soft r">近 30 天</span></div>
            <div class="big num"><AnimatedNumber :value="insightsSummary.activeTeams ?? 0" :decimals="0" /><small style="margin-left:4px">个</small></div>
            <p class="muted" style="font-size:12.5px;margin-top:10px">有业绩产出的团队</p>
          </article>
        </template>

        <!-- 员工共用：趋势图（财务=上游收入 vs 成员支出；运营=分项目业务量） -->
        <article v-if="staffTrend" class="card lift" style="--s:12;--i:5">
          <div class="card-h"><h3>{{ isOperator ? '业务量趋势' : '上游收入 vs 成员支出' }}</h3><span class="muted" style="font-size:12.5px">近 30 天 · 演示数据</span></div>
          <div class="legend" style="margin-bottom:10px"><span v-for="s in staffTrend.series" :key="s.label"><i :style="{ background: s.color }" />{{ s.label }}<b>{{ staffTrendFormat(staffTrendTotal(s.points)) }}</b></span></div>
          <TrendChart :labels="staffTrend.labels" :series="staffTrend.series" :height="210" :format="staffTrendFormat" caption="近 30 天每日走势" />
        </article>

        <!-- 财务/管理员：对账进度环 -->
        <article v-if="isFinanceStaff && reconcile" class="card lift" style="--s:4;--i:6">
          <div class="card-h"><h3>对账进度</h3><span class="chip soft r">{{ reconcile.checkedDays }}/{{ reconcile.totalDays }} 天</span></div>
          <div class="ring-wrap" style="margin-top:6px">
            <svg class="ring" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
              <circle cx="46" cy="46" r="40" fill="none" stroke="var(--card-2)" stroke-width="10" />
              <circle class="v" cx="46" cy="46" r="40" fill="none" stroke="#d46b45" stroke-width="10" stroke-linecap="round"
                :stroke-dasharray="2 * Math.PI * 40" :stroke-dashoffset="2 * Math.PI * 40 * (1 - reconcile.rate)" transform="rotate(-90 46 46)" />
            </svg>
            <div><div class="big num" style="font-size:26px">{{ Math.round(reconcile.rate * 100) }}<small style="font-size:14px">%</small></div><p class="muted" style="font-size:12.5px">已核对</p></div>
          </div>
          <div class="growth-rules" style="margin-top:12px">
            <div v-for="p in reconcile.byProject" :key="p.name"><b>{{ p.name }}</b> · {{ p.checked }}/{{ p.total }} 天</div>
          </div>
        </article>

        <!-- 财务/管理员：平台留存构成 -->
        <article v-if="isFinanceStaff && retention?.parts" class="card lift" style="--s:4;--i:7">
          <div class="card-h"><h3>留存构成</h3><span class="chip clay r">{{ Math.round((retention.rate ?? 0) * 1000) / 10 }}%</span></div>
          <div class="stack" style="margin-top:6px;height:12px">
            <i v-for="(p, i) in retention.parts" :key="p.label" :style="{ flexGrow: Number(p.amount), background: TEAM_PALETTE[i % TEAM_PALETTE.length] }" :title="`${p.label} ¥${p.amount}`"></i>
          </div>
          <div class="legend" style="margin-top:12px"><span v-for="(p, i) in retention.parts" :key="p.label"><i :style="{ background: TEAM_PALETTE[i % TEAM_PALETTE.length] }" />{{ p.label }}<b>¥{{ p.amount }}</b></span></div>
        </article>

        <!-- 员工共用：团队排行 -->
        <article v-if="teamTopBars.length" class="card lift" :style="{ '--s': isFinanceStaff ? 4 : 12, '--i': 8 }">
          <div class="card-h"><h3>团队排行</h3><span class="muted" style="font-size:12.5px">{{ isOperator ? '按业绩量' : '按上游贡献' }} · 演示数据</span></div>
          <div class="growth-rules" style="margin-top:4px;display:grid;gap:10px">
            <div v-for="(t, i) in teamTopBars" :key="t.name" style="display:grid;gap:4px">
              <div style="display:flex;justify-content:space-between;font-size:12.5px"><b>{{ i + 1 }}. {{ t.name }}</b><span class="muted">{{ isOperator ? `${t.quantity.toLocaleString('zh-CN')} 单` : `¥${t.amount}` }}</span></div>
              <div style="height:8px;border-radius:5px;background:var(--card-2);overflow:hidden"><i :style="{ display: 'block', height: '100%', width: t.pct + '%', background: TEAM_PALETTE[i % TEAM_PALETTE.length], borderRadius: '5px' }"></i></div>
            </div>
          </div>
        </article>

        <!-- 运营：团队形态（非金额） -->
        <article v-if="isOperator && retention?.teamCount !== undefined" class="card lift" style="--s:6;--i:9">
          <div class="card-h"><h3>团队形态</h3><span class="chip soft r">当前</span></div>
          <div class="profile-stats" style="margin-top:6px">
            <div><b>{{ retention.teamCount }}</b><span>团队</span></div>
            <div><b>{{ retention.newTeams }}</b><span>本月新建</span></div>
            <div><b>{{ retention.soloCreators }}</b><span>独立达人</span></div>
          </div>
        </article>

        <!-- 待办列表 -->
        <section class="card" style="--s:7;--i:1" aria-labelledby="home-todos">
          <div class="card-h"><h3 id="home-todos">待办</h3><span v-if="todos.length" class="chip clay r">{{ todos.length }} 项</span></div>
          <template v-if="todos.length">
            <router-link v-for="todo in todos" :key="todo.key" :to="todo.path" class="row" style="text-decoration:none;color:inherit">
              <span class="home-todo-count">{{ todo.count }}</span>
              <div class="t"><b>{{ todo.label }}</b><small>{{ todo.projectName }} · {{ todo.actor }}</small></div>
              <span class="home-todo-action">{{ todo.actionLabel }} →</span>
            </router-link>
          </template>
          <div v-else-if="!loading && !error && !unavailable" class="bento-empty home-empty"><b>都处理完了</b><p>新的待办会实时出现在这里和顶栏铃铛里。</p></div>
          <p v-else-if="loading && !data" role="status">正在整理你的待办…</p>
        </section>

        <!-- 项目业务量 -->
        <article v-for="(project, pi) in data?.groups ?? []" :key="project.id" class="card" style="--s:12;--i:2" :style="{ '--i': 2 + pi }">
          <div class="card-h"><h3>{{ project.name }}</h3><span class="muted r" style="font-size:12.5px">{{ data?.period.from }} 至 {{ data?.period.to }}</span></div>
          <div v-for="service in project.services" :key="service.accountId" class="home-metrics">
            <template v-if="service.status === 'ready'">
              <router-link v-for="metric in service.metrics" :key="metric.key" :to="metric.path">
                <span>{{ metric.label }}</span>
                <strong><AnimatedNumber v-if="metric.value !== null" :value="metricNumber(metric)" :decimals="metric.unit === '元' ? 2 : 0" :text="display(metric)" /><template v-else>待核对</template><small>{{ metric.unit }}</small></strong>
                <span class="home-metric-link">查看明细 →</span>
              </router-link>
            </template>
            <p v-else-if="service.status === 'unavailable'">数据暂未加载，点击上方「刷新」。</p>
            <p v-else>项目首页数据暂未开放。</p>
          </div>
          <p v-if="!project.services.length">项目正在准备中。</p>
        </article>
        <article v-if="data && !data.projects.length" class="card" style="--s:12"><div class="bento-empty home-empty"><b>还没有参与的项目</b><router-link class="btn ink" to="/projects" style="margin-top:8px">设置项目 →</router-link></div></article>
      </div>

      <!-- 右栏：职务资料 + 公告 -->
      <aside class="home-aside">
        <div class="card profile">
          <div class="big-av">{{ (w.userName?.value ?? '我').slice(0, 1) }}</div>
          <h4>{{ w.userName?.value ?? '我' }}</h4>
          <p class="muted" style="font-size:12.5px">{{ w.role.value === 'operator' ? '运营管理' : w.role.value === 'developer' ? '开发者' : w.duty?.value === 'finance' ? '财务管理' : '管理员' }}</p>
        </div>
        <div v-if="isFinanceStaff && todayPayouts" class="card">
          <div class="card-h"><h3>今日打款</h3><span class="muted r" style="font-size:12px">{{ todayPayouts.count }} 笔</span></div>
          <div v-for="p in todayPayouts.list" :key="p.name" class="row">
            <div class="t"><b>{{ p.name }} · ¥{{ p.amount }}</b><small>{{ p.method }} · {{ p.status }}</small></div>
          </div>
        </div>
        <div v-if="announcements.length" class="card">
          <div class="card-h"><h3>公告</h3><span class="muted r" style="font-size:12px">{{ announcements.length }} 条</span></div>
          <div v-for="a in announcements.slice(0, 4)" :key="a.id" class="row">
            <div class="t"><b>{{ a.title }}</b><small>{{ a.content.slice(0, 48) }}{{ a.content.length > 48 ? '…' : '' }}</small></div>
          </div>
        </div>
      </aside>
    </div>
    </template>
    <OperationGuide v-if="noActivity && w.operationGuide?.value" :guide="w.operationGuide.value" />
  </section>
</template>
<style scoped>
.home-page { min-width: 0; }
/* ===== v2 成员视图布局 ===== */
.home-toolbar { display: flex; align-items: end; justify-content: flex-end; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.home-toolbar label { display: flex; align-items: center; gap: 8px; color: var(--ink-soft); font-size: 13px; }
.home-toolbar select { max-width: 220px; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--white); font-size: 13px; }
.home-v2 { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
/* 右栏吸附顶部独立滚动：主区滚动时右栏不跟着走（v2 原型行为） */
.home-aside { position: sticky; top: 0; max-height: 100vh; overflow-y: auto; scrollbar-width: none; display: flex; flex-direction: column; gap: 18px; min-width: 0; padding-bottom: 8px; }
.home-aside::-webkit-scrollbar { display: none; }
@media (max-width: 1360px) { .home-aside { position: static; max-height: none; overflow: visible; } }
.home-aside .card { padding: 20px; }
.profile-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 18px; text-align: center; }
.profile-stats > div { padding: 10px 0; border-radius: 14px; background: var(--card-2); }
.profile-stats b { font-size: 18px; }
.profile-stats span { display: block; margin-top: 2px; color: var(--muted); font-size: 11.5px; }
.growth-rules { display: grid; gap: 6px; font-size: 13px; line-height: 1.5; }
.growth-rules > div { color: var(--muted); }
.growth-rules > div.met { color: var(--ink); }
.growth-mark { display: inline-block; width: 18px; color: var(--clay-deep); font-weight: 700; }
.contrib-chart { width: 100%; height: 190px; }
.contrib-chart .bar { transform-box: fill-box; transform-origin: bottom; transform: scaleY(0); animation: contrib-grow 0.8s var(--spring) forwards; animation-delay: calc(var(--i) * 45ms + 0.1s); }
@keyframes contrib-grow { to { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .contrib-chart .bar { animation: none; transform: none; } }
.feed .amt { font-weight: 650; white-space: nowrap; }
.feed .it + .it { border-top: 1px solid var(--line-2); }
@media (max-width: 1360px) {
  .home-v2 { grid-template-columns: 1fr; }
  .home-aside { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
}
/* 大屏加密：1900px 以上小卡一行 4 张（内联 --s:4 用 !important 覆盖） */
@media (min-width: 1900px) {
  .home-v2 .bento .card[style*="--s:4"] { grid-column: span 3 !important; }
}
@media (max-width: 720px) {
  .home-aside { grid-template-columns: 1fr; }
  .home-toolbar { justify-content: stretch; }
  .home-toolbar label { flex: 1; }
  .home-toolbar select { flex: 1; max-width: none; }
}
.relation-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.relation-cols > div { display: grid; align-content: start; gap: 4px; min-width: 0; padding: 16px; border-radius: 16px; background: var(--paper); }
.relation-cols small { color: var(--muted); font-size: 12.5px; }
.relation-cols b { font-family: var(--font-display); font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
.relation-cols b em { color: var(--muted); font-family: var(--font-sans); font-size: 13px; font-style: normal; font-weight: 400; }
.relation-cols > div > span { color: var(--muted); font-size: 12.5px; }
.relation-avatars { display: flex; align-items: center; margin-top: 8px; }
.relation-avatars i { display: grid; width: 30px; height: 30px; margin-left: -8px; place-items: center; border: 2px solid var(--paper); border-radius: 50%; color: #fff; background: var(--chart-2); font-size: 12px; font-style: normal; font-weight: 700; }
.relation-avatars i:first-child { margin-left: 0; }
.relation-avatars em { margin-left: 8px; color: var(--muted); font-size: 12px; font-style: normal; }
@media (max-width: 700px) { .relation-cols { grid-template-columns: minmax(0, 1fr); } }
.bento-hero { display: flex; flex-direction: column; }
.wallet .spark path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: spark-draw 1.4s var(--ease-out) 0.3s forwards; }
@keyframes spark-draw { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) { .wallet .spark path { animation: none; stroke-dashoffset: 0; } }
.home-controls { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; }
.home-controls label { display: grid; gap: 6px; color: var(--ink-soft); font-size: 13px; }
.home-controls select { max-width: 260px; }
.home-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 16px; border: 1px solid #ecc9c0; border-radius: 14px; background: var(--danger-bg); }
.home-error p { margin: 0; color: var(--danger); }
.home-todos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 10px; }
.home-todo { display: flex; align-items: center; gap: 14px; min-width: 0; padding: 14px 16px; border-radius: 16px; color: inherit; background: var(--paper); text-decoration: none; transition: background 0.2s, transform 0.36s var(--spring); }
.home-todo:hover { background: var(--hover); }
.home-todo:active { transform: scale(0.98); }
.home-todo-count { display: grid; min-width: 38px; height: 38px; flex: none; place-items: center; border-radius: 12px; color: var(--clay-deep); background: var(--clay-soft); font-family: var(--font-display); font-size: 18px; font-weight: 600; }
.home-todo h3 { margin: 0 0 3px; font-size: 14.5px; font-weight: 600; }
.home-todo p { margin: 0; color: var(--muted); font-size: 12.5px; overflow-wrap: anywhere; }
.home-todo-action { margin-left: auto; color: var(--clay-deep); font-size: 13px; font-weight: 600; white-space: nowrap; }
.home-actors { display: grid; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
.home-actors li { display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--line-soft); font-size: 13.5px; }
.home-actors li span { color: var(--ink-soft); }
.home-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 12px; }
.home-metrics a { display: grid; gap: 6px; min-width: 0; padding: 16px; border-radius: 16px; color: inherit; background: var(--paper); text-decoration: none; transition: background 0.2s, transform 0.45s var(--spring); }
.home-metrics a:hover { background: var(--hover); transform: translateY(-2px); }
.home-metrics a > span { color: var(--ink-soft); font-size: 13px; }
.home-metrics strong { font-family: var(--font-display); font-size: 26px; font-weight: 600; overflow-wrap: anywhere; }
.home-metrics small { margin-left: 5px; color: var(--muted); font-family: var(--font-sans); font-size: 12px; font-weight: 400; }
.home-metrics .home-metric-link { color: var(--clay-deep); font-size: 12.5px; font-weight: 600; }
.home-empty h2 { margin: 0 0 8px; font-size: 18px; }
@media (max-width: 700px) {
  .home-todo { flex-wrap: wrap; padding: 14px; }
  .home-todo-action { width: 100%; margin-left: 52px; }
  .home-controls { width: 100%; }
  .home-controls label { flex: 1; min-width: 0; }
  .home-controls select { width: 100%; max-width: 100%; }
  .home-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .home-metrics strong { font-size: 22px; }
}
</style>
