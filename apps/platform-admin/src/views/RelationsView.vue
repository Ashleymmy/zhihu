<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '../stores/auth'
import { ActionDialog, AnimatedNumber, notify } from '@zhihu-koc/shared-components'
const router = useRouter()

/** 成员关系图：左侧逐层加载的成员树（按团队 / 按邀请），右侧是选中成员的三种关系与变更时间线 */
interface TreeNode { id: string; name: string; role: string; active: boolean; children: number }
interface Person { id: string; name: string }
interface Detail {
  user: { id: string; name: string; role: string; active: boolean }
  referral: { inviter: Person | null; channel: string; registeredAt: string } | null
  team: { leader: Person | null; since: string } | null
  counts: { direct: number; indirect: number }
  teamSize: number
  timeline: { at: string; kind: 'team' | 'role'; title: string; detail: string; operator: string | null }[]
  page: number
  hasMore: boolean
}
interface TreePage { list: TreeNode[]; page: number; hasMore: boolean }
interface Nominee {
  user: { id: string; name: string }
  nominable: boolean
  openPromotionId: string | null
  metrics: { activeDays: number; records: number; quantities: { label: string; unit: string; quantity: string }[] }
  members: { id: string; defaultAction: 'follow' | 'stay' }[]
}

const ROLE_TEXT: Record<string, string> = { creator: '达人', leader: '团长', platform: '平台', admin: '管理员', operator: '运营', developer: '开发者' }
const mode = ref<'team' | 'invite'>('team')
const children = reactive(new Map<string, TreeNode[]>())
const pages = reactive(new Map<string, { page: number; hasMore: boolean }>())
const expanded = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const treeError = ref('')
const selected = ref<string | null>(null)
const detail = ref<Detail | null>(null)
const detailBusy = ref(false)
const detailError = ref('')
const nominee = ref<Nominee | null>(null)
const nominateOpen = ref(false)
const nominateNote = ref('')
const nominateBusy = ref(false)
const nominateError = ref('')
/* 调整团队 / 移交成员 / 降级：同一个对话框，按类型切换文案 */
type MoveKind = 'transfer' | 'handover' | 'demote'
const settings = ref<{ leaderSeesIndirectNames: boolean; canEdit: boolean } | null>(null)
const move = ref<MoveKind | null>(null)
const moveLeader = ref('')
const moveReason = ref('')
const moveBusy = ref(false)
const moveError = ref('')
const leaders = ref<TreeNode[]>([])
const MOVE_TEXT: Record<MoveKind, { title: string; submit: string; hint: string }> = {
  transfer: { title: '调整团队', submit: '确认调整', hint: '调整后这位达人的团队收益归新团长；邀请关系不变，本人需要重新登录。' },
  handover: { title: '移交全部成员', submit: '确认移交', hint: '名下成员逐个移交；有项目内进行中工作的成员会被跳过，并在结果里列出。' },
  demote: { title: '降级为达人', submit: '确认降级', hint: '降级后成为平台直管的达人，本人需要重新登录。名下还有成员时不能降级。' },
}
async function openMove(kind: MoveKind) {
  move.value = kind
  moveReason.value = ''
  moveError.value = ''
  moveLeader.value = ''
  if (kind !== 'demote') {
    try {
      const all: TreeNode[] = []
      for (let page = 1, hasMore = true; hasMore && page <= 10; page++) {
        const r = await http.get<TreePage>('/relations/tree', { mode: 'team', page, pageSize: 100 })
        all.push(...r.list)
        hasMore = r.hasMore
      }
      leaders.value = all.filter(n => n.role === 'leader' && n.active && n.id !== detail.value?.user.id)
    } catch { leaders.value = [] }
  }
}
async function submitMove() {
  if (!detail.value || !move.value) return
  const userId = detail.value.user.id
  moveBusy.value = true
  moveError.value = ''
  try {
    const body = move.value === 'demote' ? { reason: moveReason.value.trim() } : { leaderId: moveLeader.value || null, reason: moveReason.value.trim() }
    const result = await http.post<{ moved?: number; failed?: { name: string; message: string }[] }>(`/relations/members/${userId}/${move.value}`, body)
    if (result.failed?.length) notify(`已移交 ${result.moved} 人；${result.failed.map(f => f.name + '：' + f.message).join('；')}`, 'error')
    else notify(move.value === 'handover' ? `已移交 ${result.moved} 位成员` : move.value === 'demote' ? '已降级为达人' : '已调整团队')
    move.value = null
    children.clear()
    pages.clear()
    expanded.clear()
    await Promise.all([loadChildren(''), reloadDetail(userId)])
  } catch (e) {
    moveError.value = (e instanceof Error && e.message) || '操作没有完成，请重试'
  } finally {
    moveBusy.value = false
  }
}
async function reloadDetail(id: string) {
  try {
    detail.value = await http.get<Detail>(`/relations/members/${id}`)
    nominee.value = null
    if (detail.value.user.role === 'creator') void loadNominee(id)
  } catch { /* 保留原来的内容 */ }
}
async function loadSettings() {
  try { settings.value = await http.get('/relations/settings') } catch { settings.value = null }
}
async function toggleIndirectNames(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  try {
    settings.value = await http.put('/relations/settings', { leaderSeesIndirectNames: checked })
    notify(checked ? '团长现在可以看到第二层及以下成员的昵称（脱敏）' : '团长现在只能看到第二层及以下的人数')
  } catch (e) {
    ;(event.target as HTMLInputElement).checked = !checked
    notify((e instanceof Error && e.message) || '设置没有保存', 'error')
  }
}
const followCount = computed(() => nominee.value?.members.filter(m => m.defaultAction === 'follow').length ?? 0)

async function loadChildren(parent: string, more = false) {
  if (loading.has(parent)) return
  loading.add(parent)
  treeError.value = ''
  try {
    const page = more ? (pages.get(parent)?.page ?? 1) + 1 : 1
    const r = await http.get<TreePage>('/relations/tree', { mode: mode.value, page, ...(parent ? { parent } : {}) })
    children.set(parent, more ? [...(children.get(parent) ?? []), ...r.list] : r.list)
    pages.set(parent, { page: r.page, hasMore: r.hasMore })
  } catch {
    treeError.value = '成员树暂时没加载出来，请重试。'
  } finally {
    loading.delete(parent)
  }
}
function switchMode(next: 'team' | 'invite') {
  if (mode.value === next) return
  mode.value = next
  children.clear()
  pages.clear()
  expanded.clear()
  void loadChildren('')
}
async function toggle(node: TreeNode) {
  if (expanded.has(node.id)) { expanded.delete(node.id); return }
  expanded.add(node.id)
  if (!children.has(node.id)) await loadChildren(node.id)
}
async function select(node: TreeNode) {
  if (node.id === 'platform') { await toggle(node); return }
  selected.value = node.id
  detailBusy.value = true
  detailError.value = ''
  nominee.value = null
  try {
    detail.value = await http.get<Detail>(`/relations/members/${node.id}`)
    if (detail.value.user.role === 'creator') void loadNominee(node.id)
  } catch {
    detail.value = null
    detailError.value = '这位成员的关系暂时没加载出来，请重试。'
  } finally {
    detailBusy.value = false
  }
}

/* 提名晋升：只对在用的达人开放；已有审核中的提名时改为跳到晋升工作台 */
async function loadNominee(id: string) {
  try {
    const data = await http.get<Nominee>(`/promotions/nominee/${id}`)
    if (selected.value === id) nominee.value = data
  } catch { /* 没有提名入口不影响查看关系 */ }
}
function openNominate() {
  nominateNote.value = ''
  nominateError.value = ''
  nominateOpen.value = true
}
async function submitNominate() {
  if (!nominee.value) return
  nominateBusy.value = true
  nominateError.value = ''
  try {
    const result = await http.post<{ id: string }>('/promotions', { userId: nominee.value.user.id, note: nominateNote.value.trim() })
    nominateOpen.value = false
    await router.push({ path: '/team/promotions', query: { id: result.id } })
  } catch (e) {
    nominateError.value = (e instanceof Error && e.message) || '晋升办理没有打开，请重试'
  } finally {
    nominateBusy.value = false
  }
}

/* 变更记录按页追加；团队归属和角色历史各自分页，合并后按时间重排 */
const timelineBusy = ref(false)
async function loadMoreTimeline() {
  if (!detail.value || timelineBusy.value) return
  timelineBusy.value = true
  const id = detail.value.user.id
  try {
    const next = await http.get<Detail>(`/relations/members/${id}`, { page: detail.value.page + 1 })
    if (detail.value?.user.id !== id) return
    detail.value = {
      ...next,
      timeline: [...detail.value.timeline, ...next.timeline].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    }
  } catch {
    notify('更多记录暂时没加载出来，请重试', 'error')
  } finally {
    timelineBusy.value = false
  }
}

/* 把展开的节点拍平成带缩进的行，渲染一个列表即可；某一层还有更多成员时在末尾加一行「加载更多」 */
type Row = { key: string; depth: number; node: TreeNode; more?: undefined } | { key: string; depth: number; node?: undefined; more: string }
const rows = computed(() => {
  const out: Row[] = []
  const walk = (parent: string, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      out.push({ key: node.id, depth, node })
      if (expanded.has(node.id)) walk(node.id, depth + 1)
    }
    if (pages.get(parent)?.hasMore) out.push({ key: 'more:' + parent, depth, more: parent })
  }
  walk('', 0)
  return out
})
const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
onMounted(() => { void loadChildren(''); void loadSettings() })
</script>

<template>
  <section class="page-stack relations-page">
    <header class="page-header">
      <div>
        <router-link to="/team" class="back-link">← 团队与成员</router-link>
        <h1>成员关系图</h1>
        <p>邀请关系在注册时写入、永不改变；团队归属每次变化都会留下记录，按业绩当天的归属计算收益。</p>
      </div>
      <router-link to="/team/promotions" class="ghost-aurora">晋升工作台</router-link>
    </header>
    <label v-if="settings" class="setting-line">
      <input type="checkbox" :checked="settings.leaderSeesIndirectNames" :disabled="!settings.canEdit" @change="toggleIndirectNames" />
      <span>团长可以看到第二层及以下成员的昵称（脱敏）<small>{{ settings.canEdit ? '默认关闭，团长只看人数' : '只有完整管理员可以修改' }}</small></span>
    </label>

    <div class="relations-grid">
      <section class="bento-card tree-card" aria-label="成员树">
        <div class="bento-head">
          <h2>{{ mode === 'team' ? '按团队' : '按邀请' }}</h2>
          <div class="seg end" role="group" aria-label="查看方式">
            <button type="button" :aria-pressed="mode === 'team'" @click="switchMode('team')">按团队</button>
            <button type="button" :aria-pressed="mode === 'invite'" @click="switchMode('invite')">按邀请</button>
          </div>
        </div>
        <p v-if="treeError" class="relations-error" role="alert">{{ treeError }} <button type="button" @click="loadChildren('')">重试</button></p>
        <p v-else-if="loading.has('') && !rows.length" role="status" class="bento-note">正在加载成员…</p>
        <div v-else-if="!rows.length" class="bento-empty"><b>还没有成员</b><p>成员注册或被邀请后会出现在这里。</p></div>
        <ul class="tree" role="tree">
          <template v-for="row in rows" :key="mode + row.key">
            <li v-if="row.more !== undefined" role="none" class="tree-more" :style="{ paddingLeft: 32 + row.depth * 22 + 'px' }">
              <button type="button" :disabled="loading.has(row.more)" @click="loadChildren(row.more, true)">{{ loading.has(row.more) ? '正在加载…' : '加载更多成员' }}</button>
            </li>
            <li v-else role="treeitem" :aria-expanded="row.node.children ? expanded.has(row.node.id) : undefined" :aria-selected="selected === row.node.id">
              <div class="tree-row" :class="{ on: selected === row.node.id, muted: !row.node.active }" :style="{ paddingLeft: 8 + row.depth * 22 + 'px' }">
                <button v-if="row.node.children" type="button" class="tree-toggle" :class="{ open: expanded.has(row.node.id) }" :aria-label="(expanded.has(row.node.id) ? '收起 ' : '展开 ') + row.node.name" @click="toggle(row.node)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                </button>
                <span v-else class="tree-toggle" aria-hidden="true" />
                <button type="button" class="tree-name" @click="select(row.node)">
                  <span class="tree-av" :class="row.node.role">{{ row.node.name.slice(0, 1) }}</span>
                  <span class="tree-label">{{ row.node.name }}</span>
                  <span v-if="row.node.role === 'leader'" class="chip clay">团长</span>
                  <span v-if="!row.node.active" class="chip soft">已停用</span>
                  <span v-if="row.node.children" class="tree-count">{{ row.node.children }}</span>
                </button>
              </div>
            </li>
          </template>
        </ul>
      </section>

      <section class="bento-card detail-card" aria-live="polite">
        <div v-if="!selected" class="bento-empty"><b>选择一位成员</b><p>在左侧点击成员，查看邀请关系、团队归属和变更记录。</p></div>
        <p v-else-if="detailBusy && !detail" role="status" class="bento-note">正在加载…</p>
        <p v-else-if="detailError" class="relations-error" role="alert">{{ detailError }}</p>
        <template v-else-if="detail">
          <div class="person">
            <span class="tree-av big" :class="detail.user.role">{{ detail.user.name.slice(0, 1) }}</span>
            <div>
              <h2 class="serif-title">{{ detail.user.name }}</h2>
              <span class="chip soft">{{ ROLE_TEXT[detail.user.role] ?? detail.user.role }}</span>
              <span v-if="!detail.user.active" class="chip down" style="margin-left:6px">已停用</span>
            </div>
            <div v-if="nominee" class="person-actions">
              <router-link v-if="nominee.openPromotionId" :to="`/team/promotions?id=${nominee.openPromotionId}`" class="chip clay">继续办理晋升 →</router-link>
              <button v-else-if="nominee.nominable" type="button" class="ghost-aurora" @click="openNominate">办理晋升</button>
            </div>
            <div v-if="detail.user.active" class="person-actions" :class="{ solo: !nominee }">
              <button v-if="detail.user.role === 'creator'" type="button" class="ghost-aurora" @click="openMove('transfer')">调整团队</button>
              <template v-if="detail.user.role === 'leader'">
                <button v-if="detail.teamSize" type="button" class="ghost-aurora" @click="openMove('handover')">移交成员</button>
                <button v-if="settings?.canEdit" type="button" class="ghost-aurora danger-text" :disabled="detail.teamSize > 0" :title="detail.teamSize ? '名下还有成员，先移交' : ''" @click="openMove('demote')">降级</button>
              </template>
            </div>
          </div>
          <div class="layer-grid">
            <div class="layer"><small>直接邀请</small><b><AnimatedNumber :value="detail.counts.direct" /></b><span>人</span></div>
            <div class="layer"><small>第二层及以下</small><b><AnimatedNumber :value="detail.counts.indirect" /></b><span>人 · 只记录，不产生收益</span></div>
          </div>
          <div class="relation">
            <h3><i class="dot invite" />邀请关系<span>注册时写入，永不改变</span></h3>
            <p v-if="detail.referral?.inviter">由 <b>{{ detail.referral.inviter.name }}</b> 邀请 · {{ detail.referral.channel }} · {{ when(detail.referral.registeredAt) }}</p>
            <p v-else>{{ detail.referral?.channel || '没有邀请人' }}{{ detail.referral ? ' · ' + when(detail.referral.registeredAt) : '' }}</p>
          </div>
          <div class="relation">
            <h3><i class="dot team" />团队归属<span>当前</span></h3>
            <p v-if="detail.team">{{ detail.team.leader ? detail.team.leader.name + ' 的团队' : '平台直管' }} · 自 {{ when(detail.team.since) }}</p>
            <p v-else>当前没有团队归属（账号已注销）</p>
          </div>
          <h3 class="timeline-title">变更记录</h3>
          <ol class="timeline">
            <li v-for="(item, i) in detail.timeline" :key="i" :class="item.kind">
              <b>{{ item.title }}</b>
              <small>{{ when(item.at) }}{{ item.detail ? ' · ' + item.detail : '' }}{{ item.operator ? ' · 操作人 ' + item.operator : '' }}</small>
            </li>
          </ol>
          <button v-if="detail.hasMore" type="button" class="ghost-aurora timeline-more" :disabled="timelineBusy" @click="loadMoreTimeline">{{ timelineBusy ? '正在加载…' : '加载更早的记录' }}</button>
        </template>
      </section>
    </div>

    <ActionDialog :open="!!move" :title="move ? MOVE_TEXT[move].title + (detail ? ' · ' + detail.user.name : '') : ''" :busy="moveBusy" @close="move = null">
      <form v-if="move && detail" @submit.prevent="submitMove">
        <p v-if="moveError" role="alert" class="relations-error">{{ moveError }}</p>
        <label v-if="move !== 'demote'">{{ move === 'handover' ? `把 ${detail.teamSize} 位成员移交给` : '调整到' }}
          <select v-model="moveLeader">
            <option value="">平台直管{{ move === 'transfer' ? '（移出团队）' : '' }}</option>
            <option v-for="l in leaders" :key="l.id" :value="l.id">{{ l.name }} 的团队</option>
          </select>
        </label>
        <label>原因<textarea v-model="moveReason" rows="3" minlength="2" maxlength="500" required placeholder="会写进成员的变更记录" /></label>
        <p class="nominee-note">{{ MOVE_TEXT[move].hint }}</p>
        <div class="dialog-actions"><button type="button" @click="move = null">取消</button><button class="primary" :disabled="moveBusy">{{ MOVE_TEXT[move].submit }}</button></div>
      </form>
    </ActionDialog>

    <ActionDialog :open="nominateOpen" :title="`办理 ${nominee?.user.name ?? ''} 晋升团长`" :busy="nominateBusy" @close="nominateOpen = false">
      <form v-if="nominee" @submit.prevent="submitNominate">
        <p v-if="nominateError" role="alert" class="relations-error">{{ nominateError }}</p>
        <div class="nominee-stats">
          <div><small>近 30 天有业绩</small><b>{{ nominee.metrics.activeDays }}</b><em>天</em></div>
          <div><small>业绩条数</small><b>{{ nominee.metrics.records }}</b></div>
          <div v-for="q in nominee.metrics.quantities" :key="q.label"><small>{{ q.label }}</small><b>{{ Number(q.quantity).toLocaleString('zh-CN') }}</b><em>{{ q.unit }}</em></div>
        </div>
        <p class="nominee-note">
          <template v-if="nominee.members.length">{{ nominee.user.name }} 直接邀请的 {{ nominee.members.length }} 位在用达人中，{{ followCount }} 位和 {{ nominee.user.name }} 同在一个团队，默认跟随；下一步可逐人调整。</template>
          <template v-else>{{ nominee.user.name }} 还没有直接邀请的在用达人。</template>
        </p>
        <label>晋升说明<textarea v-model="nominateNote" rows="3" minlength="2" maxlength="500" required placeholder="例如：近一个月稳定产出" /></label>
        <p class="nominee-note">下一步核对成员去向，由你确认后生效。</p>
        <div class="dialog-actions"><button type="button" @click="nominateOpen = false">取消</button><button class="primary" :disabled="nominateBusy">下一步</button></div>
      </form>
    </ActionDialog>
  </section>
</template>

<style scoped>
.relations-grid { display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); gap: 18px; align-items: start; }
.tree { max-height: calc(100vh - 260px); min-height: 360px; margin: 0 -6px; padding: 0; overflow-y: auto; list-style: none; }
.tree-row { position: relative; display: flex; align-items: center; gap: 4px; padding-right: 6px; border-radius: 12px; transition: background 0.15s; }
.tree-row:hover { background: var(--hover); }
.tree-row.on { background: var(--clay-soft); }
.tree-row.muted .tree-label { color: var(--muted); }
.tree-toggle { display: grid; width: 24px; height: 24px; flex: none; place-items: center; padding: 0; border: 0; border-radius: 7px; color: var(--muted); background: transparent; transition: transform 0.25s var(--ease-out), background 0.15s; }
button.tree-toggle:hover { background: var(--line); }
.tree-toggle.open { transform: rotate(90deg); }
.tree-name { display: flex; flex: 1; align-items: center; gap: 9px; min-width: 0; min-height: 40px; padding: 0 4px; border: 0; background: transparent; text-align: left; }
.tree-label { overflow: hidden; font-size: 14px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.tree-count { margin-left: auto; color: var(--muted); font-size: 12px; }
.tree-more { padding: 4px 0 8px; }
.tree-more button { padding: 0; border: 0; background: transparent; color: var(--clay); font-size: 13px; }
.tree-more button:disabled { color: var(--muted); }
.timeline-more { margin-top: 4px; }
.tree-av { display: grid; width: 26px; height: 26px; flex: none; place-items: center; border-radius: 50%; color: #fff; background: #3b7dd8; font-size: 12px; font-weight: 700; }
.tree-av.leader { background: var(--ink); }
.tree-av.platform { background: var(--muted); }
.tree-av.big { width: 52px; height: 52px; font-size: 20px; }
.person { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.person-actions { display: flex; gap: 8px; margin-left: auto; }
.person-actions + .person-actions { margin-left: 0; }
.danger-text { color: var(--danger); }
.setting-line { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--white); font-size: 14px; cursor: pointer; }
.setting-line input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--clay); }
.setting-line small { display: block; color: var(--muted); font-size: 12.5px; }
select { min-height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--white); color: var(--ink); font: inherit; }
@media (max-width: 700px) { .person { flex-wrap: wrap; } .person-actions { margin-left: 0; } }
.serif-title { margin: 0 0 4px; font-family: var(--font-display); font-size: 24px; font-weight: 600; }
.layer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
.layer { padding: 14px 16px; border-radius: 16px; background: var(--paper); }
.layer small { display: block; color: var(--muted); font-size: 12.5px; }
.layer b { font-family: var(--font-display); font-size: 28px; font-weight: 600; }
.layer > span { margin-left: 4px; color: var(--muted); font-size: 12.5px; }
.relation { margin-bottom: 10px; padding: 14px 16px; border: 1px solid var(--line-soft); border-radius: 14px; }
.relation h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 14px; font-weight: 650; }
.relation h3 span { color: var(--muted); font-size: 12px; font-weight: 400; }
.relation p { margin: 0; color: var(--ink-soft); font-size: 13.5px; }
.dot { width: 8px; height: 8px; border-radius: 2px; }
.dot.invite { background: var(--chart-3); }
.dot.team { background: var(--chart-2); }
.timeline-title { margin: 20px 0 10px; font-size: 14px; font-weight: 650; }
.timeline { position: relative; margin: 0; padding: 0 0 0 22px; list-style: none; }
.timeline::before { content: ''; position: absolute; left: 6px; top: 6px; bottom: 6px; width: 2px; border-radius: 2px; background: var(--line); }
.timeline li { position: relative; padding-bottom: 14px; }
.timeline li::before { content: ''; position: absolute; left: -21px; top: 5px; width: 10px; height: 10px; border: 2.5px solid var(--chart-2); border-radius: 50%; background: var(--white); }
.timeline li.role::before { border-color: var(--clay); }
.timeline b { display: block; font-size: 14px; font-weight: 600; }
.timeline small { color: var(--muted); font-size: 12.5px; }
.relations-error { color: var(--danger); }
.nominee-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.nominee-stats div { padding: 12px 14px; border-radius: 14px; background: var(--paper); }
.nominee-stats small { display: block; color: var(--muted); font-size: 12px; }
.nominee-stats b { font-family: var(--font-display); font-size: 24px; font-weight: 600; }
.nominee-stats em { margin-left: 3px; color: var(--muted); font-size: 12px; font-style: normal; }
.nominee-note { margin: 0; color: var(--muted); font-size: 13px; }
textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--white); color: var(--ink); font: inherit; resize: vertical; }
textarea:focus-visible { outline: none; border-color: var(--clay); box-shadow: 0 0 0 3px var(--clay-soft); }
.relations-error button { margin-left: 8px; }
@media (max-width: 960px) {
  .relations-grid { grid-template-columns: minmax(0, 1fr); }
  .tree { max-height: 60vh; min-height: 0; }
}
</style>
