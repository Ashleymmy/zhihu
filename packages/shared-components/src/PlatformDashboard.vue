<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import type { CoreWorkspace } from './core-workspace'
import OperationGuide from './OperationGuide.vue'
import AnimatedNumber from './AnimatedNumber.vue'
import TrendChart, { type TrendSeries } from './TrendChart.vue'
import ShareBar, { type ShareItem } from './ShareBar.vue'
const w = inject<CoreWorkspace>('opc')!

interface Todo { kind: string; count: number; label: string; actor: string; actionLabel: string; path: string }
interface Metric { key: string; label: string; value: string | null; unit: string; path: string }
interface Service { moduleId: string; accountId: string; status: string; todos: Todo[]; metrics: Metric[] }
interface Overview { period: { from: string; to: string }; projects: { id: string; name: string }[]; groups: { id: string; name: string; services: Service[] }[] }
interface MineGroup { projectId: string; metricType: string; metricLabel: string; amount: string }
interface Mine { summary: { amount: string; confirmedAmount: string; pendingAmount: string }; groups: MineGroup[] }
interface Daily { from: string; to: string; days: { date: string; group: 'self' | 'team'; amount: string }[] }
interface Periods { total: string; today: string; yesterday: string }
interface MemberSummary { direct: Periods; team: null | { memberCount: number; reward: Periods } }

const data = ref<Overview | null>(null), projectId = ref(''), loading = ref(false), error = ref('')
const mine = ref<Mine | null>(null), daily = ref<Daily | null>(null), summary = ref<MemberSummary | null>(null)
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
  const [m, d, s] = await Promise.allSettled([
    w.http.get<Mine>('/earnings/mine', { ...scope, from: today.slice(0, 8) + '01', to: today, pageSize: 1 }),
    w.http.get<Daily>('/earnings/mine/daily', scope),
    w.http.get<MemberSummary>('/member-summary'),
  ])
  if (version !== revision) return
  mine.value = m.status === 'fulfilled' ? m.value : null
  daily.value = d.status === 'fulfilled' ? d.value : null
  summary.value = s.status === 'fulfilled' ? s.value : null
}
onMounted(load)

const todos = computed(() => data.value?.groups.flatMap(project => project.services.flatMap(service =>
  service.todos.map(todo => ({ ...todo, projectName: project.name, key: project.id + ':' + service.accountId + ':' + todo.kind })))) ?? [])
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
  if (w.role.value === 'leader' || sum(team) > 0n) series.push({ label: '团队分成', color: '#3b7dd8', points: team.map(toNumber), total: sum(team) })
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
    { label: '团队分成', value: toNumber(team), text: '¥' + yuan(team), color: 'var(--chart-2)' },
  ]
})
const showShareCard = computed(() => isMember.value && (composition.value.length > 0 || teamShare.value.length > 0 || !!summary.value?.team))

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
    <header class="page-header"><div><h1>首页</h1><p>{{ data ? `${data.period.from} 至 ${data.period.to}` : '先处理待办，再看看这个月的进展。' }}</p></div>
      <div class="home-controls"><label>项目<select v-model="projectId" @change="load"><option value="">全部项目</option><option v-for="project in data?.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label><button class="ghost-aurora" @click="load" :disabled="loading">{{ loading ? '刷新中…' : '刷新' }}</button></div>
    </header>
    <div v-if="error || unavailable" class="home-error" role="alert"><p>{{ error || '部分项目暂时没加载出来，已加载的待办仍可处理。' }}</p><button class="ghost-aurora" @click="load" :disabled="loading">重新加载</button></div>

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
          <div class="bento-head" style="margin-top:18px"><h3>本人与团队分成</h3><span class="sub">累计已确认</span></div>
          <ShareBar :items="teamShare" />
        </template>
      </article>
      <article v-else-if="!isMember" class="bento-card lift span-4" style="--i:3">
        <div class="bento-head"><h2>待办合计</h2></div>
        <div class="bento-figure"><AnimatedNumber :value="todoTotal" /><small style="margin-left:4px">项</small></div>
        <ul v-if="todoByActor.length" class="home-actors"><li v-for="item in todoByActor" :key="item.actor"><span>{{ item.actor }}</span><b>{{ item.count }}</b></li></ul>
        <p v-else class="bento-note">新的待办会实时出现在这里和顶栏铃铛里。</p>
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
    <OperationGuide v-if="noActivity && w.operationGuide?.value" :guide="w.operationGuide.value" />
  </section>
</template>
<style scoped>
.home-page { min-width: 0; }
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
