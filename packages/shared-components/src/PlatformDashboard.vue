<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import type { CoreWorkspace } from './core-workspace'
import OperationGuide from './OperationGuide.vue'
import AnimatedNumber from './AnimatedNumber.vue'
import TrendChart, { type TrendSeries } from './TrendChart.vue'
import ShareBar, { type ShareItem } from './ShareBar.vue'
import RingProgress from './RingProgress.vue'
const w = inject<CoreWorkspace>('opc')!

interface Todo { kind: string; count: number; label: string; actor: string; actionLabel: string; path: string }
interface Metric { key: string; label: string; value: string | null; unit: string; path: string }
interface Service { moduleId: string; accountId: string; status: string; todos: Todo[]; metrics: Metric[] }
interface Overview { period: { from: string; to: string }; projects: { id: string; name: string }[]; groups: { id: string; name: string; services: Service[] }[]; todos?: Todo[] }
interface MineGroup { projectId: string; projectName?: string; metricType: string; metricLabel: string; amount: string; quantity?: string; quantityUnit?: string }
interface MineLine { id: string; taskName: string | null; businessDate: string; metricLabel: string; quantity: string; amount: string; confirmedAt: string | null }
interface Mine { summary: { amount: string; confirmedAmount: string; pendingAmount: string }; groups: MineGroup[]; list?: MineLine[] }
interface Daily { from: string; to: string; days: { date: string; group: 'self' | 'team'; amount: string }[] }
interface Periods { total: string; today: string; yesterday: string }
interface GrowthMetrics { activeDays: number; records: number; memberDays: number; quantities: { label: string; unit: string; quantity: string }[] }
interface MemberSummary { direct: Periods; team: null | { memberCount: number; reward: Periods }; metrics?: GrowthMetrics }
interface RelationMine { inviter: { name: string } | null; channel: string | null; team: { leaderName: string | null } | null; counts: { direct: number; indirect: number }; directList: { name: string; active: boolean }[]; indirectList?: { name: string; depth: number; active: boolean }[] }

const data = ref<Overview | null>(null), projectId = ref(''), loading = ref(false), error = ref('')
const mine = ref<Mine | null>(null), daily = ref<Daily | null>(null), summary = ref<MemberSummary | null>(null), relation = ref<RelationMine | null>(null), recent = ref<MineLine[]>([])
const isMember = computed(() => ['creator', 'leader'].includes(w.role.value))
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
  const [m, d, s, r, feed] = await Promise.allSettled([
    w.http.get<Mine>('/earnings/mine', { ...scope, from: today.slice(0, 8) + '01', to: today, pageSize: 1 }),
    w.http.get<Daily>('/earnings/mine/daily', scope),
    w.http.get<MemberSummary>('/member-summary'),
    w.http.get<RelationMine>('/relations/mine', { pageSize: 6 }),
    w.http.get<Mine>('/earnings/mine', { ...scope, from: '2020-01-01', to: today, pageSize: 6 }),
  ])
  if (version !== revision) return
  mine.value = m.status === 'fulfilled' ? m.value : null
  daily.value = d.status === 'fulfilled' ? d.value : null
  summary.value = s.status === 'fulfilled' ? s.value : null
  relation.value = r.status === 'fulfilled' ? r.value : null
  recent.value = feed.status === 'fulfilled' ? (feed.value.list ?? []) : []
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
/* 主卡底部的 14 天迷你走势（本人任务 + 团队分成） */
const spark = computed(() => {
  const t = trend.value
  if (!t || !t.hasData) return ''
  const n = t.labels.length, from = Math.max(0, n - 14)
  const values = Array.from({ length: n - from }, (_, k) => t.series.reduce((sum, s) => sum + (s.points[from + k] ?? 0), 0))
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
/* 成长进度：活跃 ≥20 天、直邀 ≥2 人、任务收益 ≥¥800（方向稿 3.4 节的晋升标准） */
const growth = computed(() => {
  const activeDays = summary.value?.metrics?.activeDays ?? null
  const direct = relation.value?.counts.direct ?? null
  const monthAmount = month.value ? toNumber(month.value.amount) : null
  const rules = [
    { label: '近 30 天活跃 ≥ 20 天', current: activeDays, target: 20, text: activeDays === null ? '' : `${activeDays} 天`, met: activeDays !== null && activeDays >= 20 },
    { label: '直接邀请 ≥ 2 人', current: direct, target: 2, text: direct === null ? '' : `${direct} 人`, met: direct !== null && direct >= 2 },
    { label: '本月任务收益 ≥ ¥800', current: monthAmount, target: 800, text: monthAmount === null ? '' : `¥${money(monthAmount).slice(1)}`, met: monthAmount !== null && monthAmount >= 800 },
  ]
  const known = rules.filter(rule => rule.current !== null)
  const met = known.filter(rule => rule.met).length
  return { rules, met, total: known.length, ratio: known.length ? met / known.length : 0 }
})
/* 任务收益小卡的拆分说明：知乎 110 单 · 红果 347 次 */
const taskSplit = computed(() => {
  if (!mine.value) return ''
  return mine.value.groups
    .filter(group => Number(group.quantity ?? 0) > 0)
    .map(group => `${group.projectName ?? ''} ${Number(group.quantity).toLocaleString('zh-CN')} ${group.quantityUnit ?? group.metricLabel}`.trim())
    .join(' · ')
})
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
  const quantity = groups.reduce((sum, group) => sum + Number(group.quantity ?? 0), 0)
  const amount = groups.reduce((sum, group) => sum + units(group.amount), 0n)
  return { id: project.id, name: project.name, art: art(project.name), quantity, amount }
}))

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
    <header v-if="!isMember" class="page-header"><div><h1>首页</h1><p>{{ data ? `${data.period.from} 至 ${data.period.to}` : '先处理待办，再看看这个月的进展。' }}</p></div>
      <div class="home-controls"><label>项目<select v-model="projectId" @change="load"><option value="">全部项目</option><option v-for="project in data?.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label><button class="ghost-aurora" @click="load" :disabled="loading">{{ loading ? '刷新中…' : '刷新' }}</button></div>
    </header>
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
            <svg v-if="spark" class="spark" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true"><path :d="spark" pathLength="1" /></svg>
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

          <!-- 任务收益 -->
          <article v-if="month" class="card lift" style="--s:4;--i:2">
            <div class="card-h"><span class="ic" style="background:var(--clay-soft);color:var(--clay-deep)">☰</span><h3>任务收益</h3><span class="chip soft r">本月</span></div>
            <div class="big num"><small>¥</small><AnimatedNumber :value="toNumber(month.amount)" :decimals="2" :text="yuan(month.amount)" /></div>
            <p class="muted" style="font-size:12.5px;margin-top:4px">{{ taskSplit || '本月还没有任务收益记录' }}</p>
          </article>

          <!-- 邀请收益 -->
          <article v-if="summary" class="card lift" style="--s:4;--i:3">
            <div class="card-h"><span class="ic" style="background:#e5f0e3;color:var(--c3)">✚</span><h3>邀请收益</h3><span class="chip soft r">直邀 {{ relation?.counts.direct ?? 0 }} 人</span></div>
            <div class="big num"><small>¥</small><AnimatedNumber :value="Number(summary.direct.total)" :decimals="2" /></div>
            <p class="muted" style="font-size:12.5px;margin-top:4px">好友注册 180 天内的业绩 × 邀请单价</p>
          </article>

          <!-- 近 30 天活跃 -->
          <article v-if="summary?.metrics" class="card lift" style="--s:4;--i:4">
            <div class="card-h"><span class="ic" style="background:#efe9f8;color:var(--c4)">◷</span><h3>近 30 天活跃</h3><span class="chip clay r">{{ summary.metrics.records }} 单</span></div>
            <div class="big num"><AnimatedNumber :value="summary.metrics.activeDays" :decimals="0" /><small style="margin-left:4px">天</small></div>
            <p class="muted" style="font-size:12.5px;margin-top:4px">活跃天数是晋升团长的标准之一</p>
          </article>

          <!-- 成长进度 -->
          <article v-if="growth.total" class="card lift" style="--s:4;--i:5">
            <div class="card-h"><h3>成长进度</h3><span class="muted r" style="font-size:12.5px">晋升团长</span></div>
            <div class="ring-wrap">
              <RingProgress :value="growth.ratio" :size="92" :thickness="8" :label="`${growth.met}/${growth.total}`">{{ growth.met }}/{{ growth.total }}</RingProgress>
              <div class="growth-rules">
                <div v-for="rule in growth.rules" :key="rule.label" :class="{ met: rule.met }">
                  <span class="growth-mark">{{ rule.met ? '✓' : '○' }}</span>{{ rule.label }}<template v-if="!rule.met && rule.text"> · {{ rule.text }}</template>
                </div>
              </div>
            </div>
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

          <!-- 现在要做（有待办才显示） -->
          <section v-if="todos.length" class="card" style="--s:12;--i:8" aria-labelledby="home-todos">
            <div class="card-h"><h3 id="home-todos">现在要做</h3><span class="chip clay r">{{ todos.length }} 项</span></div>
            <div class="home-todos"><router-link v-for="todo in todos" :key="todo.key" :to="todo.path" class="home-todo"><span class="home-todo-count">{{ todo.count }}</span><div><h3>{{ todo.label }}</h3><p>{{ todo.projectName }} · {{ todo.actor }}</p></div><span class="home-todo-action">{{ todo.actionLabel }} →</span></router-link></div>
          </section>

          <!-- 项目广场 -->
          <article v-if="projectCards.length" class="card" style="--s:12;--i:9">
            <div class="card-h"><h3>项目广场</h3><span class="muted" style="font-size:12.5px">我们承接的项目，统一在这里领取</span><router-link class="btn r" to="/task-hall" style="height:32px">全部任务 →</router-link></div>
            <div class="projects">
              <router-link v-for="project in projectCards" :key="project.id" class="proj" to="/task-hall">
                <svg class="art" viewBox="0 0 200 92" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="200" height="92" :fill="project.art.c2" /><circle :cx="150 - project.art.seed * 10" :cy="30 + project.art.seed * 6" :r="34 + project.art.seed * 4" :fill="project.art.c1" opacity=".9" /><circle :cx="60 + project.art.seed * 14" cy="78" :r="26 - project.art.seed * 3" fill="#fff" opacity=".55" /><rect :x="20 + project.art.seed * 8" y="22" width="56" height="10" rx="5" fill="#fff" opacity=".8" /><rect :x="20 + project.art.seed * 8" y="38" width="34" height="8" rx="4" fill="#fff" opacity=".6" /></svg>
                <span v-if="project.quantity" class="chip up tg">本月 {{ project.quantity.toLocaleString('zh-CN') }} 单</span>
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

    <!-- ===== 员工视图：保留现有结构 ===== -->
    <template v-else>
    <div class="bento bento-enter">
      <!-- 悬浮主卡 -->
      <article v-if="isMember && (wallet || month)" class="bento-card bento-hero span-5" style="--i:0" @pointermove="tilt" @pointerleave="untilt">
        <div class="hero-label">{{ month ? '本月收益' : '可提现余额' }}</div>
        <div class="bento-figure"><small>¥</small><AnimatedNumber :value="toNumber(heroUnits)" :decimals="2" :text="yuan(heroUnits)" /></div>
        <div v-if="month" class="hero-meta">
          <div v-if="wallet"><b>¥{{ yuan(wallet.units) }}</b>可提现</div>
          <div><b>¥{{ yuan(month.confirmed) }}</b>已确认</div>
          <div><b>¥{{ yuan(month.pending) }}</b>待确认</div>
        </div>
        <svg v-if="spark" class="hero-spark" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true"><path :d="spark" pathLength="1" /></svg>
        <div class="hero-actions">
          <router-link class="hero-btn solid" :to="wallet?.path ?? '/income'">{{ wallet ? '去提现' : '查看收益' }}</router-link>
          <router-link class="hero-btn glass" to="/income">收益明细 →</router-link>
        </div>
      </article>

      <!-- 收益趋势 -->
      <article v-if="isMember && trend" class="bento-card lift span-7" style="--i:1">
        <div class="bento-head"><h2>收益趋势</h2><span class="sub">近 30 天 · 含待确认</span></div>
        <template v-if="trend.hasData">
          <div class="bento-legend"><span v-for="s in trend.series" :key="s.label"><i :style="{ background: s.color }" />{{ s.label }}<b>¥{{ yuan(s.total) }}</b></span></div>
          <TrendChart :labels="trend.labels" :series="trend.series" :height="210" :format="money" caption="近 30 天每日收益" />
        </template>
        <div v-else class="bento-empty"><b>最近 30 天还没有收益</b><p>完成任务、报表核对后，每天的收益会画在这里。</p><router-link class="ghost-aurora" to="/task-hall">去任务大厅</router-link></div>
      </article>

      <!-- 现在要做 -->
      <section class="bento-card" :class="isMember && !showShareCard ? 'span-12' : 'span-8'" style="--i:2" aria-labelledby="home-todos">
        <div class="bento-head"><h2 id="home-todos">现在要做</h2><span v-if="todos.length" class="chip clay">{{ todos.length }} 项</span></div>
        <div v-if="todos.length" class="home-todos"><router-link v-for="todo in todos" :key="todo.key" :to="todo.path" class="home-todo"><span class="home-todo-count">{{ todo.count }}</span><div><h3>{{ todo.label }}</h3><p>{{ todo.projectName }} · {{ todo.actor }}</p></div><span class="home-todo-action">{{ todo.actionLabel }} →</span></router-link></div>
        <div v-else-if="!loading && !error && !unavailable && data?.groups.some(group=>group.services.length)" class="bento-empty home-empty"><b>都处理完了</b><p>新的任务和需要你处理的事项会显示在这里。</p><router-link v-if="isMember" class="ghost-aurora" to="/task-hall">去任务大厅看看 →</router-link></div>
        <p v-else-if="loading && !data" role="status">正在整理你的待办…</p>
      </section>

      <!-- 右侧：成员看收益构成，后台看待办分布 -->
      <article v-if="showShareCard" class="bento-card lift span-4" style="--i:3">
        <div class="bento-head"><h2>收益构成</h2><span class="sub">本月</span><span v-if="summary?.team" class="chip soft end">团队 {{ summary.team.memberCount }} 人</span></div>
        <ShareBar v-if="composition.length" :items="composition" />
        <p v-else class="bento-note">本月还没有收益记录。</p>
        <template v-if="teamShare.length">
          <div class="bento-head" style="margin-top:18px"><h3>任务与团队管理收益</h3><span class="sub">累计已确认</span></div>
          <ShareBar :items="teamShare" />
        </template>
      </article>
      <article v-else-if="!isMember" class="bento-card lift span-4" style="--i:3">
        <div class="bento-head"><h2>待办合计</h2></div>
        <div class="bento-figure"><AnimatedNumber :value="todoTotal" /><small style="margin-left:4px">项</small></div>
        <ul v-if="todoByActor.length" class="home-actors"><li v-for="item in todoByActor" :key="item.actor"><span>{{ item.actor }}</span><b>{{ item.count }}</b></li></ul>
        <p v-else class="bento-note">新的待办会实时出现在这里和顶栏铃铛里。</p>
      </article>

      <!-- 我的关系：邀请人、所在团队、我邀请的人（第二层及以下只给人数） -->
      <article v-if="isMember && relation" class="bento-card lift span-12 home-relation" style="--i:4">
        <div class="bento-head"><h2>我的关系</h2><span class="sub">注册即建立，永久记录</span><router-link to="/invite-center" class="bento-link">邀请中心 →</router-link></div>
        <div class="relation-cols">
          <div><small>谁邀请了我</small><b>{{ relation.inviter?.name ?? '自行注册' }}</b><span>{{ relation.channel }}</span></div>
          <div><small>我所在的团队</small><b>{{ relation.team?.leaderName ? relation.team.leaderName + ' 的团队' : '平台直管' }}</b><span>团队收益按业绩当天的归属计算</span></div>
          <div>
            <small>我邀请的人</small><b><AnimatedNumber :value="relation.counts.direct" /><em> 人</em></b>
            <span v-if="relation.indirectList">第二层及以下 {{ relation.counts.indirect }} 人<template v-if="relation.indirectList.length">：{{ relation.indirectList.slice(0, 8).map(p => p.name).join('、') }}{{ relation.indirectList.length > 8 ? ' 等' : '' }}</template></span><span v-else>第二层及以下 {{ relation.counts.indirect }} 人，只显示人数</span>
            <div v-if="relation.directList.length" class="relation-avatars"><i v-for="(p, i) in relation.directList.slice(0, 6)" :key="i" :title="p.name">{{ p.name.slice(0, 1) }}</i><em v-if="relation.counts.direct > 6">+{{ relation.counts.direct - 6 }}</em></div>
          </div>
        </div>
      </article>

      <!-- 项目卡片 -->
      <article v-for="(project, pi) in data?.groups ?? []" :key="project.id" class="bento-card span-12 home-project" :style="{ '--i': 4 + pi }">
        <div class="bento-head"><h3>{{ project.name }}</h3><span class="sub">{{ data?.period.from }} 至 {{ data?.period.to }}</span></div>
        <div v-for="service in project.services" :key="service.accountId" class="home-metrics">
          <template v-if="service.status === 'ready'">
            <router-link v-for="metric in service.metrics" :key="metric.key" :to="metric.path">
              <span>{{ metric.label }}</span>
              <strong><AnimatedNumber v-if="metric.value !== null" :value="metricNumber(metric)" :decimals="metric.unit === '元' ? 2 : 0" :text="display(metric)" /><template v-else>待核对</template><small>{{ metric.unit }}</small></strong>
              <span class="home-metric-link">查看明细 →</span>
            </router-link>
          </template>
          <p v-else-if="service.status === 'unavailable'">数据暂未加载，点击上方“重新加载”。</p>
          <p v-else>项目首页数据暂未开放。</p>
        </div>
        <p v-if="!project.services.length">项目正在准备中。</p>
      </article>
      <article v-if="data && !data.projects.length" class="bento-card span-12 home-empty"><h2>还没有参与的项目</h2><router-link :to="isMember ? '/me' : '/projects'">{{ isMember ? '查看我的团队' : '设置项目' }} →</router-link></article>
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
.home-aside { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.home-aside .card { padding: 20px; }
.profile-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 18px; text-align: center; }
.profile-stats > div { padding: 10px 0; border-radius: 14px; background: var(--card-2); }
.profile-stats b { font-size: 18px; }
.profile-stats span { display: block; margin-top: 2px; color: var(--muted); font-size: 11.5px; }
.growth-rules { display: grid; gap: 6px; font-size: 13px; line-height: 1.5; }
.growth-rules > div { color: var(--muted); }
.growth-rules > div.met { color: var(--ink); }
.growth-mark { display: inline-block; width: 18px; color: var(--clay-deep); font-weight: 700; }
.feed .amt { font-weight: 650; white-space: nowrap; }
.feed .it + .it { border-top: 1px solid var(--line-2); }
@media (max-width: 1360px) {
  .home-v2 { grid-template-columns: 1fr; }
  .home-aside { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
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
.hero-spark { width: 100%; height: 48px; margin-top: auto; padding-top: 18px; overflow: visible; }
.hero-spark path { fill: none; stroke: #f0b49b; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; stroke-dasharray: 1; stroke-dashoffset: 1; animation: spark-draw 1.4s var(--ease-out) 0.3s forwards; }
@keyframes spark-draw { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) { .hero-spark path { animation: none; stroke-dashoffset: 0; } }
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
