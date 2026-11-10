<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '../stores/auth'
import { ActionDialog, DetailDrawer, notify } from '@zhihu-koc/shared-components'

/** 晋升工作台：由办理人核对并确认，逐人决定直接邀请成员跟随还是留下。 */
interface Person { id: string; name: string }
interface Metrics { from: string; to: string; activeDays: number; records: number; quantities: { label: string; unit: string; quantity: string }[]; memberDays: number }
interface Promotion {
  id: string
  status: 'candidate' | 'proposed' | 'approved' | 'rejected' | 'cancelled'
  user: Person & { role: string }
  fromLeader: Person | null
  metrics: Metrics
  note: string
  proposer: Person | null
  proposedAt: string
  reviewer: Person | null
  decidedAt: string | null
  reviewNote: string | null
  followed: number | null
  canReview: boolean
}
interface Member { id: string; name: string; active: boolean; leaderId: string | null; leaderName: string | null; defaultAction: 'follow' | 'stay' }
type Detail = Promotion & { members: Member[] }

const STATUS: Record<Promotion['status'], { text: string; tone: string }> = {
  candidate: { text: '系统候选', tone: 'soft' },
  proposed: { text: '待确认', tone: 'clay' },
  approved: { text: '已晋升', tone: 'up' },
  rejected: { text: '未晋升', tone: 'down' },
  cancelled: { text: '已取消', tone: 'soft' },
}
const route = useRoute()
const router = useRouter()
const view = ref<'open' | 'done'>('open')
const lists = reactive<{ open: Promotion[] | null; done: Promotion[] | null }>({ open: null, done: null })
const listError = ref('')
const detail = ref<Detail | null>(null)
const detailError = ref('')
const follow = reactive(new Set<string>())
const approveNote = ref('')
const busy = ref(false)
const decline = ref<null | 'reject' | 'cancel'>(null)
const declineReason = ref('')
const declineError = ref('')

const items = computed(() => lists[view.value])
const message = (e: unknown) => (e instanceof Error && e.message) || String((e as { message?: string })?.message || '操作没有完成，请重试')

async function load(which: 'open' | 'done' = view.value) {
  listError.value = ''
  try {
    lists[which] = await http.get<Promotion[]>('/promotions', { view: which })
  } catch (e) {
    listError.value = message(e)
  }
}
async function open(id: string) {
  detailError.value = ''
  if (route.query.id !== id) void router.replace({ query: { ...route.query, id } })
  try {
    const data = await http.get<Detail>(`/promotions/${id}`)
    detail.value = data
    follow.clear()
    for (const m of data.members) if (m.defaultAction === 'follow') follow.add(m.id)
    approveNote.value = ''
  } catch (e) {
    detail.value = null
    detailError.value = message(e)
  }
}
function close() {
  detail.value = null
  detailError.value = ''
  const { id: _id, ...rest } = route.query
  void router.replace({ query: rest })
}
const isOpen = computed(() => !!detail.value && ['candidate', 'proposed'].includes(detail.value.status))

/* 确认晋升后的变化预览：按原团队分组统计跟随人数 */
const preview = computed(() => {
  const d = detail.value
  if (!d) return null
  const moving = d.members.filter(m => follow.has(m.id))
  const fromTeams = new Map<string, number>()
  for (const m of moving) {
    const key = m.leaderName ? `${m.leaderName} 的团队` : '平台直管'
    fromTeams.set(key, (fromTeams.get(key) ?? 0) + 1)
  }
  return { moving: moving.length, staying: d.members.length - moving.length, fromTeams: [...fromTeams] }
})
function teamText(m: Member) {
  if (!m.active) return '账号已停用'
  return m.leaderName ? `在 ${m.leaderName} 的团队` : '平台直管'
}

async function approve() {
  if (!detail.value || busy.value) return
  busy.value = true
  try {
    const name = detail.value.user.name
    const result = await http.post<{ followed: number; stayed: number }>(`/promotions/${detail.value.id}/approve`, {
      follow: [...follow],
      ...(approveNote.value.trim() ? { note: approveNote.value.trim() } : {}),
    })
    notify(`${name} 已成为团长，${result.followed} 位成员加入新团队`)
    close()
    await Promise.all([load('open'), load('done')])
  } catch (e) {
    notify(message(e), 'error')
  } finally {
    busy.value = false
  }
}
async function submitDecline() {
  if (!detail.value || !decline.value) return
  if (declineReason.value.trim().length < 2) { declineError.value = '请写明原因'; return }
  busy.value = true
  declineError.value = ''
  try {
    await http.post(`/promotions/${detail.value.id}/${decline.value}`, { reason: declineReason.value.trim() })
    notify(decline.value === 'reject' ? '已记录暂不晋升' : '已取消本次晋升')
    decline.value = null
    declineReason.value = ''
    close()
    await Promise.all([load('open'), load('done')])
  } catch (e) {
    declineError.value = message(e)
  } finally {
    busy.value = false
  }
}

const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
const day = (value: string) => value.slice(5).replace('-', '/')

watch(view, (next) => { if (!lists[next]) void load(next) })
onMounted(async () => {
  await load('open')
  if (typeof route.query.id === 'string' && /^\d+$/.test(route.query.id)) await open(route.query.id)
})
</script>

<template>
  <section class="page-stack promotions-page">
    <header class="page-header">
      <div>
        <router-link to="/team/relations" class="back-link">← 成员关系图</router-link>
        <h1>晋升工作台</h1>
        <p>核对成员去向后确认晋升，由当前办理人完成。</p>
      </div>
    </header>

    <div class="seg" role="group" aria-label="查看">
      <button type="button" :aria-pressed="view === 'open'" @click="view = 'open'">待确认<span v-if="lists.open?.length" class="seg-count">{{ lists.open.length }}</span></button>
      <button type="button" :aria-pressed="view === 'done'" @click="view = 'done'">已处理</button>
    </div>

    <p v-if="listError" class="promo-error" role="alert">{{ listError }} <button type="button" @click="load()">重试</button></p>
    <p v-else-if="!items" role="status" class="bento-note">正在加载…</p>
    <div v-else-if="!items.length" class="bento-card bento-empty promo-empty">
      <b>{{ view === 'open' ? '没有待确认的晋升' : '还没有晋升办理记录' }}</b>
      <p>{{ view === 'open' ? '在成员关系图里选中一位达人，点「办理晋升」。' : '已晋升、暂不晋升和取消的记录会留在这里。' }}</p>
      <router-link v-if="view === 'open'" to="/team/relations" class="primary-action">去成员关系图</router-link>
    </div>
    <div v-else class="bento promo-grid">
      <button v-for="(p, i) in items" :key="p.id" type="button" class="bento-card span-4 promo-card" :style="{ '--i': i }" @click="open(p.id)">
        <div class="promo-top">
          <span class="promo-av">{{ p.user.name.slice(0, 1) }}</span>
          <div class="promo-who"><b>{{ p.user.name }}</b><small>{{ p.fromLeader ? p.fromLeader.name + ' 的团队' : '平台直管' }}</small></div>
          <span class="chip" :class="STATUS[p.status].tone">{{ STATUS[p.status].text }}</span>
        </div>
        <div class="promo-metrics">
          <span><b>{{ p.metrics.activeDays }}</b>天有业绩</span>
          <span><b>{{ p.metrics.records }}</b>条业绩</span>
          <span>注册 <b>{{ p.metrics.memberDays }}</b>天</span>
        </div>
        <p class="promo-note">{{ p.note }}</p>
        <small class="promo-meta">
          {{ p.proposer?.name ?? '系统' }} 发起 · {{ when(p.proposedAt) }}
          <template v-if="p.decidedAt"> · {{ p.reviewer?.name }} 办理</template>
          <template v-if="p.status === 'approved' && p.followed !== null"> · {{ p.followed }} 人跟随</template>
        </small>
      </button>
    </div>

    <DetailDrawer :open="!!detail || !!detailError" :title="detail ? `${detail.user.name} 晋升团长` : '晋升办理'" @close="close">
      <p v-if="detailError" class="promo-error" role="alert">{{ detailError }}</p>
      <template v-if="detail">
        <div class="promo-status">
          <span class="chip" :class="STATUS[detail.status].tone">{{ STATUS[detail.status].text }}</span>
          <span>目前在 {{ detail.fromLeader ? detail.fromLeader.name + ' 的团队' : '平台直管' }}</span>
        </div>

        <section class="promo-sec">
          <h3>晋升说明</h3>
          <p class="promo-quote">{{ detail.note }}</p>
          <small>{{ detail.proposer?.name ?? '系统' }} · {{ when(detail.proposedAt) }}</small>
        </section>

        <section class="promo-sec">
          <h3>近 30 天业绩<small>{{ day(detail.metrics.from) }} – {{ day(detail.metrics.to) }}，发起时统计</small></h3>
          <div class="promo-stats">
            <div><small>有业绩的天数</small><b>{{ detail.metrics.activeDays }}</b></div>
            <div><small>业绩条数</small><b>{{ detail.metrics.records }}</b></div>
            <div v-for="q in detail.metrics.quantities" :key="q.label"><small>{{ q.label }}</small><b>{{ Number(q.quantity).toLocaleString('zh-CN') }}</b><em>{{ q.unit }}</em></div>
            <div><small>注册天数</small><b>{{ detail.metrics.memberDays }}</b></div>
          </div>
        </section>

        <section class="promo-sec">
          <h3>直接邀请的成员<small>{{ isOpen ? '逐人选择跟随还是留下' : '办理时的去向' }}</small></h3>
          <p v-if="!detail.members.length" class="promo-muted">没有直接邀请的在用达人。</p>
          <ul v-else class="promo-members">
            <li v-for="m in detail.members" :key="m.id">
              <span class="promo-av sm">{{ m.name.slice(0, 1) }}</span>
              <div><b>{{ m.name }}</b><small v-if="isOpen">{{ teamText(m) }}</small></div>
              <div v-if="isOpen && detail.canReview" class="seg sm" role="group" :aria-label="m.name + ' 的去向'">
                <button type="button" :aria-pressed="follow.has(m.id)" :disabled="!m.active" @click="follow.add(m.id)">跟随</button>
                <button type="button" :aria-pressed="!follow.has(m.id)" @click="follow.delete(m.id)">留下</button>
              </div>
              <span v-else class="chip" :class="m.defaultAction === 'follow' ? 'clay' : 'soft'">{{ m.defaultAction === 'follow' ? (isOpen ? '默认跟随' : '跟随') : (isOpen ? '默认留下' : '留下') }}</span>
            </li>
          </ul>
        </section>

        <template v-if="isOpen && detail.canReview && preview">
          <section class="promo-preview" aria-live="polite">
            <h3>确认晋升后</h3>
            <ul>
              <li><b>{{ detail.user.name }}</b> 成为团长，转为平台直管{{ detail.fromLeader ? `，离开 ${detail.fromLeader.name} 的团队` : '' }}</li>
              <li v-if="preview.moving">{{ preview.moving }} 位成员加入 {{ detail.user.name }} 的团队<template v-if="preview.fromTeams.length">（{{ preview.fromTeams.map(([team, n]) => `${team} ${n} 人`).join('、') }}）</template></li>
              <li v-if="preview.staying">{{ preview.staying }} 位成员留在原来的团队</li>
              <li v-if="detail.fromLeader">{{ detail.fromLeader.name }} 不再从 {{ detail.user.name }} 和跟随成员获得团队收益</li>
              <li>邀请关系保持不变；涉及的账号需要重新登录</li>
            </ul>
          </section>
          <label class="promo-field">办理备注（选填）<textarea v-model="approveNote" rows="2" maxlength="500" placeholder="例如：已核对成员去向" /></label>
          <div class="promo-actions">
            <button type="button" class="primary-action" :disabled="busy" @click="approve">{{ busy ? '正在处理…' : '确认晋升' }}</button>
            <button type="button" class="ghost-aurora" :disabled="busy" @click="decline = 'cancel'; declineReason = ''; declineError = ''">取消办理</button>
          </div>
        </template>
        <section v-else-if="detail.decidedAt" class="promo-sec">
          <h3>处理结果</h3>
          <p>{{ detail.reviewer?.name }} {{ STATUS[detail.status].text }} · {{ when(detail.decidedAt) }}</p>
          <p v-if="detail.reviewNote" class="promo-quote">{{ detail.reviewNote }}</p>
        </section>
      </template>
    </DetailDrawer>

    <ActionDialog :open="!!decline" :title="decline === 'reject' ? '暂不晋升' : '取消本次晋升'" :busy="busy" @close="decline = null">
      <form @submit.prevent="submitDecline">
        <p v-if="declineError" role="alert" class="promo-error">{{ declineError }}</p>
        <label>原因<textarea v-model="declineReason" rows="3" maxlength="500" required placeholder="例如：成员去向需要重新核对" /></label>
        <p class="promo-muted">成员的角色和团队保持原状，之后可以重新办理。</p>
        <div class="dialog-actions"><button type="button" @click="decline = null">返回</button><button class="primary" :disabled="busy">{{ decline === 'reject' ? '确认暂不晋升' : '确认取消' }}</button></div>
      </form>
    </ActionDialog>
  </section>
</template>

<style scoped>
.promotions-page { gap: 20px; }
.seg-count { display: inline-grid; min-width: 18px; height: 18px; margin-left: 6px; padding: 0 5px; place-items: center; border-radius: 9px; background: var(--clay); color: #fff; font-size: 11px; }
.promo-grid { margin: 0; }
.promo-card { display: grid; gap: 12px; align-content: start; text-align: left; font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--line); transition: transform 0.25s var(--spring), box-shadow 0.25s var(--ease-out); }
.promo-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift, 0 12px 32px rgba(20, 20, 19, 0.08)); }
.promo-card:active { transform: scale(0.985); }
.promo-top { display: flex; align-items: center; gap: 10px; }
.promo-who { display: grid; flex: 1; min-width: 0; }
.promo-who b { font-family: var(--font-display); font-size: 17px; }
.promo-who small, .promo-meta, .promo-muted { color: var(--muted); font-size: 12.5px; }
.promo-av { display: grid; width: 36px; height: 36px; flex: none; place-items: center; border-radius: 50%; background: var(--chart-2); color: #fff; font-weight: 600; }
.promo-av.sm { width: 28px; height: 28px; font-size: 13px; }
.promo-metrics { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font-size: 12.5px; }
.promo-metrics b { margin-right: 3px; color: var(--ink); font-family: var(--font-display); font-size: 18px; }
.promo-note { display: -webkit-box; margin: 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.6; }
.promo-error { color: var(--danger, #b4412c); }
.promo-error button { margin-left: 8px; }
.promo-status { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; color: var(--muted); font-size: 13px; }
.promo-sec { margin-bottom: 22px; }
.promo-sec h3, .promo-preview h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 10px; font-size: 14px; }
.promo-sec h3 small { color: var(--muted); font-size: 12px; font-weight: 400; }
.promo-sec > small { color: var(--muted); font-size: 12.5px; }
.promo-quote { margin: 0 0 6px; padding: 10px 14px; border-radius: 12px; background: var(--paper); line-height: 1.6; }
.promo-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
.promo-stats div { padding: 12px 14px; border-radius: 14px; background: var(--paper); }
.promo-stats small { display: block; color: var(--muted); font-size: 12px; }
.promo-stats b { font-family: var(--font-display); font-size: 24px; font-weight: 600; }
.promo-stats em { margin-left: 3px; color: var(--muted); font-size: 12px; font-style: normal; }
.promo-members { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.promo-members li { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--line); }
.promo-members li > div:first-of-type { display: grid; flex: 1; min-width: 0; }
.promo-members small { color: var(--muted); font-size: 12px; }
.seg.sm button { padding: 4px 10px; font-size: 12.5px; }
.promo-preview { margin-bottom: 18px; padding: 14px 16px; border: 1px solid color-mix(in srgb, var(--clay) 30%, transparent); border-radius: 16px; background: var(--clay-soft); }
.promo-preview ul { display: grid; gap: 6px; margin: 0; padding-left: 18px; line-height: 1.6; }
.promo-field { display: grid; gap: 8px; margin-bottom: 16px; font-size: 14px; }
textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--white); color: var(--ink); font: inherit; resize: vertical; }
textarea:focus-visible { outline: none; border-color: var(--clay); box-shadow: 0 0 0 3px var(--clay-soft); }
.promo-actions { display: flex; gap: 10px; }
/* 空态：居中、限宽、正文可换行，避免文字贴边被裁 */
.promo-empty { justify-items: center; padding: 52px 22px; text-align: center; }
.promo-empty b { font-size: 16px; }
.promo-empty p { max-width: 460px; line-height: 1.7; }
.promo-empty .primary-action { margin-top: 12px; }
@media (max-width: 700px) {
  .promo-card { grid-column: span 12; }
}
</style>
