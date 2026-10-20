<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { http } from '../stores/auth'
import { AnimatedNumber } from '@zhihu-koc/shared-components'

/** 成员关系图：左侧逐层加载的成员树（按团队 / 按邀请），右侧是选中成员的三种关系与变更时间线 */
interface TreeNode { id: string; name: string; role: string; active: boolean; children: number }
interface Person { id: string; name: string }
interface Detail {
  user: { id: string; name: string; role: string; active: boolean }
  referral: { inviter: Person | null; channel: string; registeredAt: string } | null
  team: { leader: Person | null; since: string } | null
  counts: { direct: number; indirect: number }
  timeline: { at: string; kind: 'team' | 'role'; title: string; detail: string; operator: string | null }[]
}

const ROLE_TEXT: Record<string, string> = { creator: '达人', leader: '团长', platform: '平台', admin: '管理员', operator: '运营', developer: '开发者' }
const mode = ref<'team' | 'invite'>('team')
const children = reactive(new Map<string, TreeNode[]>())
const expanded = reactive(new Set<string>())
const loading = reactive(new Set<string>())
const treeError = ref('')
const selected = ref<string | null>(null)
const detail = ref<Detail | null>(null)
const detailBusy = ref(false)
const detailError = ref('')

async function loadChildren(parent: string) {
  if (loading.has(parent)) return
  loading.add(parent)
  treeError.value = ''
  try {
    const list = await http.get<TreeNode[]>('/relations/tree', parent ? { mode: mode.value, parent } : { mode: mode.value })
    children.set(parent, list)
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
  try {
    detail.value = await http.get<Detail>(`/relations/members/${node.id}`)
  } catch {
    detail.value = null
    detailError.value = '这位成员的关系暂时没加载出来，请重试。'
  } finally {
    detailBusy.value = false
  }
}

/* 把展开的节点拍平成带缩进的行，渲染一个列表即可 */
const rows = computed(() => {
  const out: { node: TreeNode; depth: number }[] = []
  const walk = (parent: string, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      out.push({ node, depth })
      if (expanded.has(node.id)) walk(node.id, depth + 1)
    }
  }
  walk('', 0)
  return out
})
const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
onMounted(() => loadChildren(''))
</script>

<template>
  <section class="page-stack relations-page">
    <header class="page-header">
      <div>
        <router-link to="/team" class="back-link">← 团队与成员</router-link>
        <h1>成员关系图</h1>
        <p>邀请关系在注册时写入、永不改变；团队归属每次变化都会留下记录，按业绩当天的归属计算收益。</p>
      </div>
    </header>

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
          <li v-for="{ node, depth } in rows" :key="mode + node.id" role="treeitem" :aria-expanded="node.children ? expanded.has(node.id) : undefined" :aria-selected="selected === node.id">
            <div class="tree-row" :class="{ on: selected === node.id, muted: !node.active }" :style="{ paddingLeft: 8 + depth * 22 + 'px' }">
              <button v-if="node.children" type="button" class="tree-toggle" :class="{ open: expanded.has(node.id) }" :aria-label="(expanded.has(node.id) ? '收起 ' : '展开 ') + node.name" @click="toggle(node)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </button>
              <span v-else class="tree-toggle" aria-hidden="true" />
              <button type="button" class="tree-name" @click="select(node)">
                <span class="tree-av" :class="node.role">{{ node.name.slice(0, 1) }}</span>
                <span class="tree-label">{{ node.name }}</span>
                <span v-if="node.role === 'leader'" class="chip clay">团长</span>
                <span v-if="!node.active" class="chip soft">已停用</span>
                <span v-if="node.children" class="tree-count">{{ node.children }}</span>
              </button>
            </div>
          </li>
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
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.relations-grid { display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); gap: 18px; align-items: start; }
.seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--paper-deep); }
.seg button { min-height: 30px; padding: 0 12px; border: 0; border-radius: 8px; color: var(--ink-soft); background: transparent; font-size: 13px; }
.seg button[aria-pressed='true'] { color: var(--ink); background: var(--white); box-shadow: 0 1px 3px rgba(20, 20, 19, 0.1); font-weight: 600; }
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
.tree-av { display: grid; width: 26px; height: 26px; flex: none; place-items: center; border-radius: 50%; color: #fff; background: #3b7dd8; font-size: 12px; font-weight: 700; }
.tree-av.leader { background: var(--ink); }
.tree-av.platform { background: var(--muted); }
.tree-av.big { width: 52px; height: 52px; font-size: 20px; }
.person { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
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
.relations-error button { margin-left: 8px; }
@media (max-width: 960px) {
  .relations-grid { grid-template-columns: minmax(0, 1fr); }
  .tree { max-height: 60vh; min-height: 0; }
}
</style>
