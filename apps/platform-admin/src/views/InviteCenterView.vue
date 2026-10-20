<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { http, useAuthStore } from '../stores/auth'
import { AnimatedNumber } from '@zhihu-koc/shared-components'

/** 邀请中心（达人、团长）：谁邀请了我、我在哪个团队、我直接邀请的人；第二层及以下默认只给人数 */
interface Invitee { name: string; registeredAt: string; channel: string; active: boolean }
interface Mine {
  inviter: { name: string } | null
  registeredAt: string | null
  channel: string | null
  team: { leaderName: string | null; since: string } | null
  counts: { direct: number; indirect: number }
  directList: Invitee[]
  indirectList?: { name: string; depth: number; registeredAt: string; active: boolean }[]
}
const auth = useAuthStore()
const data = ref<Mine | null>(null)
const error = ref('')
const isLeader = computed(() => auth.user?.role === 'leader')
const activeCount = computed(() => data.value?.directList.filter(p => p.active).length ?? 0)
const day = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }) : '—'

async function load() {
  error.value = ''
  try { data.value = await http.get<Mine>('/relations/mine') } catch (e) { error.value = (e instanceof Error && e.message) || '暂时没加载出来，请重试' }
}
onMounted(load)
</script>

<template>
  <section class="page-stack invite-center" :aria-busy="!data && !error">
    <header class="page-header">
      <div>
        <h1>邀请中心</h1>
        <p>邀请关系在注册时确定，之后不会改变。这里只显示你直接邀请的人；更远的成员只统计人数。</p>
      </div>
      <router-link v-if="isLeader" to="/invitations" class="primary-action">管理邀请链接</router-link>
    </header>

    <p v-if="error" class="invite-error" role="alert">{{ error }} <button type="button" @click="load">重试</button></p>
    <p v-else-if="!data" role="status" class="bento-note">正在加载…</p>
    <div v-else class="bento">
      <article class="bento-card bento-hero span-4" style="--i:0">
        <small>我直接邀请的人</small>
        <b class="hero-num"><AnimatedNumber :value="data.counts.direct" /><em>人</em></b>
        <span>其中 {{ activeCount }} 人在用</span>
      </article>
      <article class="bento-card span-4" style="--i:1">
        <small class="card-label">第二层及以下</small>
        <b class="big-num"><AnimatedNumber :value="data.counts.indirect" /><em>人</em></b>
        <span class="card-sub">只做统计，不产生任何收益</span>
      </article>
      <article class="bento-card span-4" style="--i:2">
        <small class="card-label">我的来源</small>
        <p class="source-line"><b>{{ data.inviter?.name ?? data.channel ?? '自行注册' }}</b>{{ data.inviter && data.channel ? ' · ' + data.channel : '' }}</p>
        <p class="source-line">{{ data.team?.leaderName ? data.team.leaderName + ' 的团队' : '平台直管' }}<span v-if="data.team"> · 自 {{ day(data.team.since) }}</span></p>
        <span class="card-sub">注册于 {{ day(data.registeredAt) }}</span>
      </article>

      <section class="bento-card span-8" style="--i:3" aria-labelledby="direct-title">
        <div class="bento-head"><h2 id="direct-title">我直接邀请的人</h2><span class="sub">昵称已脱敏，不显示手机号</span></div>
        <div v-if="!data.directList.length" class="bento-empty">
          <b>还没有邀请过人</b>
          <p v-if="isLeader">在「管理邀请链接」里生成链接发给对方，对方注册后会出现在这里。</p>
          <p v-else>在小程序的「邀请」里生成邀请卡片发给对方，对方注册后会出现在这里。</p>
        </div>
        <ul v-else class="invitee-list">
          <li v-for="(p, i) in data.directList" :key="i" :class="{ off: !p.active }">
            <span class="invitee-av">{{ p.name.slice(0, 1) }}</span>
            <div><b>{{ p.name }}</b><small>{{ p.channel }}</small></div>
            <span class="invitee-day">{{ day(p.registeredAt) }}</span>
            <span v-if="!p.active" class="chip soft">已注销</span>
          </li>
        </ul>
      </section>

      <section class="bento-card span-4" style="--i:4" aria-labelledby="rules-title">
        <div class="bento-head"><h2 id="rules-title">规则说明</h2></div>
        <ul class="rules">
          <li>谁邀请了谁在注册时记录，之后调整团队、晋升都不会改变它。</li>
          <li>你只能看到直接邀请的人的昵称（脱敏），看不到对方的手机号和收益。</li>
          <li>第二层及以下只统计人数<template v-if="data.indirectList">；平台已允许团长查看他们的脱敏昵称</template>，不会因此产生任何收益。</li>
          <li>邀请不设注册奖励，也不需要缴纳任何费用。</li>
        </ul>
        <template v-if="data.indirectList?.length">
          <h3 class="rules-sub">第二层及以下</h3>
          <p class="indirect-names">{{ data.indirectList.map(p => p.name).join('、') }}</p>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.invite-center .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.hero-num { display: block; margin: 8px 0 4px; font-family: var(--font-display); font-size: 48px; font-weight: 600; line-height: 1.1; }
.hero-num em, .big-num em { margin-left: 4px; font-size: 15px; font-style: normal; opacity: 0.7; }
.big-num { display: block; margin: 8px 0 4px; font-family: var(--font-display); font-size: 36px; font-weight: 600; }
.card-label { color: var(--muted); font-size: 12.5px; }
.card-sub { color: var(--muted); font-size: 12.5px; }
.source-line { margin: 8px 0 0; font-size: 14px; }
.source-line b { font-family: var(--font-display); font-size: 18px; }
.invitee-list { display: grid; margin: 0; padding: 0; list-style: none; }
.invitee-list li { display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--line-soft); }
.invitee-list li:last-child { border-bottom: 0; }
.invitee-list li.off { opacity: 0.6; }
.invitee-list li > div { display: grid; flex: 1; min-width: 0; }
.invitee-list small, .invitee-day { color: var(--muted); font-size: 12.5px; }
.invitee-av { display: grid; width: 32px; height: 32px; flex: none; place-items: center; border-radius: 50%; background: var(--chart-2); color: #fff; font-weight: 600; }
.rules { display: grid; gap: 8px; margin: 0; padding-left: 18px; color: var(--ink-soft); font-size: 13.5px; line-height: 1.6; }
.rules-sub { margin: 16px 0 6px; font-size: 13px; }
.indirect-names { margin: 0; color: var(--ink-soft); font-size: 13px; line-height: 1.7; }
.invite-error { color: var(--danger); }
.invite-error button { margin-left: 8px; }
@media (max-width: 700px) {
  .invite-center .page-header { flex-direction: column; align-items: flex-start; }
}
</style>
