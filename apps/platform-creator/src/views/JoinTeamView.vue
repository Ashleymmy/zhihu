<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { LeaderOption, MyTeamResp, TeamApplication } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const applications = ref<TeamApplication[]>([])
const leaders = ref<LeaderOption[]>([])
const team = ref<MyTeamResp | null>(null)
const loading = ref(true)
const error = ref('')

const form = ref({ leaderUsername: '', message: '' })
const submitting = ref(false)
const submitMessage = ref('')
const withdrawing = ref(false)

/** 系统提示对话框 */
const notice = ref<{ title: string; body: string; withdrawId?: string } | null>(null)

/** 团长搜索 */
const leaderQuery = ref('')
const pickerOpen = ref(false)
const filteredLeaders = computed(() => {
  const q = leaderQuery.value.trim().toLowerCase()
  if (!q) return leaders.value
  return leaders.value.filter((l) => `${l.displayName}${l.username}`.toLowerCase().includes(q))
})

function pickLeader(leader: LeaderOption) {
  form.value.leaderUsername = leader.username
  leaderQuery.value = `${leader.displayName}（${leader.username}）`
  pickerOpen.value = false
}

function onPickerBlur() {
  // 延迟收起，让点击选项先生效
  setTimeout(() => { pickerOpen.value = false }, 150)
}

const pendingApplication = computed(() => applications.value.find((a) => a.status === 'pending'))

const statusLabels: Record<TeamApplication['status'], string> = { pending: '待审批', approved: '已通过', rejected: '已驳回', cancelled: '已撤回' }
const statusClass: Record<TeamApplication['status'], string> = { pending: 'paused', approved: 'active', rejected: 'rejected', cancelled: 'ended' }

async function load() {
  loading.value = true
  try {
    const [a, l, t] = await Promise.all([apis.team.myApplications(), apis.team.listLeaders(), apis.team.myTeam()])
    applications.value = a
    leaders.value = l
    team.value = t
  }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function submit() {
  error.value = ''
  submitMessage.value = ''
  if (team.value) {
    notice.value = {
      title: '你已在团队内',
      body: `你当前属于「${team.value.leaderName}」的团队。如需变更团队，请联系管理员调整归属。`,
    }
    return
  }
  if (pendingApplication.value) {
    notice.value = {
      title: '已有待审批的申请',
      body: `你向「${pendingApplication.value.leaderName}」提交的申请还在等待审批。可以撤回后重新选择其他团长。`,
      withdrawId: pendingApplication.value.id,
    }
    return
  }
  if (!form.value.leaderUsername) { error.value = '请从列表中选择一位团长'; return }
  submitting.value = true
  try {
    await apis.team.applyToTeam({
      leaderUsername: form.value.leaderUsername,
      message: form.value.message.trim() || undefined,
    })
    submitMessage.value = '申请已提交，等待团长审批。'
    form.value = { leaderUsername: '', message: '' }
    leaderQuery.value = ''
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { submitting.value = false }
}

async function withdraw(id: string) {
  if (!confirm('确定撤回这条申请？撤回后可以重新申请其他团长。')) return
  withdrawing.value = true
  try {
    await apis.team.cancelApplication(id)
    notice.value = null
    await load()
  }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { withdrawing.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">01 / 申请入团</p>
        <h1>加入一个团队</h1>
        <p>入团后你的推广数据将与团长共享，由团长协助你成长。</p>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>
    <div v-if="submitMessage" style="padding: 12px 16px; border: 1px solid var(--moss); border-radius: var(--radius); background: #e6ebe7; font-size: 11px; color: var(--moss);">{{ submitMessage }}</div>

    <section class="workspace-grid">
      <div class="min-w-0">
        <!-- 我的团队 -->
        <p class="section-index">02 / 我的团队</p>
        <h2 class="workspace-title">当前归属</h2>
        <article v-if="team" class="panel team-card">
          <span class="team-avatar">{{ team.leaderName.slice(0, 1) }}</span>
          <div class="team-meta">
            <strong>{{ team.leaderName }}</strong>
            <small>{{ team.leaderUsername }} · {{ team.memberCount }} 位成员</small>
          </div>
          <span :class="['status-badge', team.leaderActive ? 'active' : 'ended']">{{ team.leaderActive ? '合作中' : '已停用' }}</span>
        </article>
        <div v-else class="empty-panel" style="min-height: 90px;"><span>还没有加入任何团队。</span></div>

        <!-- 申请记录 -->
        <p class="section-index" style="margin-top: 28px;">03 / 申请记录</p>
        <h2 class="workspace-title">我的申请</h2>
        <div v-if="loading" style="padding: 24px 0; color: var(--ink-soft); font-size: 12px;">加载中...</div>
        <div v-else-if="!applications.length" class="empty-panel"><span>还没有提交过入团申请。</span></div>
        <div v-else class="queue-list">
          <div v-for="a in applications" :key="a.id" class="campaign-row">
            <div>
              <strong>{{ a.leaderName }}</strong>
              <small>{{ a.message || '无留言' }}</small>
            </div>
            <div class="budget">
              <small>{{ new Date(a.createdAt).toLocaleDateString('zh-CN') }}</small>
            </div>
            <span :class="['status-badge', statusClass[a.status]]">{{ statusLabels[a.status] }}</span>
            <button v-if="a.status === 'pending'" class="row-action" :disabled="withdrawing" @click="withdraw(a.id)">撤回</button>
          </div>
        </div>
      </div>

      <aside class="workspace-rail">
        <p class="section-index quiet">04 / 新申请</p>
        <h2 class="workspace-title" style="font-size: 22px;">提交入团申请</h2>
        <form class="rail-form" @submit.prevent="submit">
          <label>选择团长</label>
          <div class="leader-picker">
            <input
              v-model="leaderQuery"
              placeholder="搜索团长名字或用户名"
              @focus="pickerOpen = true"
              @blur="onPickerBlur"
              @input="form.leaderUsername = ''"
            />
            <div v-if="pickerOpen" class="leader-options">
              <button
                v-for="l in filteredLeaders.slice(0, 6)"
                :key="l.id"
                type="button"
                class="leader-option"
                @mousedown.prevent="pickLeader(l)"
              >
                <strong>{{ l.displayName }}</strong>
                <span class="leader-meta">{{ l.username }} · {{ l.memberCount }} 位成员</span>
              </button>
              <p v-if="!filteredLeaders.length" class="leader-empty">没有匹配的团长。</p>
            </div>
          </div>
          <label>申请留言（可选）</label>
          <textarea v-model="form.message" rows="3" maxlength="500" placeholder="简单介绍你的推广方向或经验"></textarea>
          <button type="submit" class="primary-action" :disabled="submitting || !form.leaderUsername">{{ submitting ? '提交中...' : '提交申请' }}</button>
        </form>
      </aside>
    </section>

    <!-- 系统提示对话框 -->
    <Teleport to="body">
      <div v-if="notice" class="dialog-overlay" @click.self="notice = null">
        <div class="dialog-card" style="width: min(400px, 90vw);">
          <div class="dialog-header">
            <h3>{{ notice.title }}</h3>
            <button type="button" class="dialog-close" @click="notice = null">×</button>
          </div>
          <div class="dialog-body" style="color: var(--ink-soft); font-size: 13px; line-height: 1.8;">{{ notice.body }}</div>
          <div class="dialog-footer">
            <button v-if="notice.withdrawId" class="row-action danger" :disabled="withdrawing" @click="withdraw(notice.withdrawId)">撤回该申请</button>
            <button class="primary-action" @click="notice = null">知道了</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.campaign-row > div:first-child { display: grid; min-width: 0; flex: 1; }
.campaign-row > div:first-child small { overflow: hidden; color: var(--ink-soft); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }

.team-card { display: flex; align-items: center; gap: 14px; padding: 18px 20px; }
.team-avatar {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 2px;
  color: var(--paper);
  background: var(--ink);
  font-family: var(--font-display);
  font-size: 18px;
}
.team-meta { display: grid; flex: 1; min-width: 0; }
.team-meta strong { font-size: 14px; }
.team-meta small { color: #7b8286; font-family: var(--font-mono); font-size: 10px; }

.rail-form { display: grid; gap: 10px; }
.rail-form label { color: var(--ink-soft); font-size: 11px; font-weight: 600; }
.rail-form textarea { resize: vertical; }

.leader-picker { position: relative; }
.leader-picker input { width: 100%; }

.leader-options {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  border: 1px solid var(--line);
  border-radius: 2px;
  background: var(--white);
  box-shadow: var(--shadow-float);
  overflow: hidden;
}

.leader-option {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--paper-deep);
  background: transparent;
  text-align: left;
  transition: background 0.15s ease;
}

.leader-option:last-child { border-bottom: 0; }
.leader-option:hover { background: var(--paper-deep); }
.leader-option strong { font-size: 12px; font-weight: 500; }
.leader-meta { color: #7b8286; font-family: var(--font-mono); font-size: 10px; }

.leader-empty { margin: 0; padding: 12px; color: var(--ink-soft); font-size: 11px; }
</style>
