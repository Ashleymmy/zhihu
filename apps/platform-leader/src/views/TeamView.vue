<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { TeamMember, CreateMemberResp, TeamApplication } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const members = ref<TeamMember[]>([])
const applications = ref<TeamApplication[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)
const form = ref({ username: '', displayName: '', role: 'creator' as 'leader' | 'creator' })
const created = ref<CreateMemberResp | null>(null)
const resetResult = ref<{ id: string; temporaryPassword: string | null } | null>(null)
const resetTarget = ref<TeamMember | null>(null)
const resetForm = ref({ password: '' })
const resetting = ref(false)

async function load() {
  loading.value = true
  try {
    const [m, a] = await Promise.all([
      apis.team.listMembers(),
      apis.team.listApplications().catch(() => [] as TeamApplication[]),
    ])
    members.value = m
    applications.value = a
  }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function reviewApplication(id: string, action: 'approve' | 'reject') {
  if (action === 'reject' && !confirm('确定驳回这条入团申请？')) return
  try { await apis.team.reviewApplication(id, action); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

async function createMember() {
  if (!form.value.username.trim() || !form.value.displayName.trim()) return
  try {
    created.value = await apis.team.createMember(form.value)
    showCreate.value = false
    form.value = { username: '', displayName: '', role: 'creator' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

function openReset(m: TeamMember) {
  resetTarget.value = m
  resetForm.value = { password: '' }
}

async function confirmReset() {
  const targetMember = resetTarget.value
  if (!targetMember) return
  const password = resetForm.value.password.trim()
  if (password && password.length < 8) { error.value = '自定义密码至少 8 位'; return }
  resetting.value = true
  try {
    const r = await apis.team.resetPassword(targetMember.id, password || undefined)
    resetResult.value = { id: targetMember.id, temporaryPassword: r.temporaryPassword }
    resetTarget.value = null
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { resetting.value = false }
}

async function disableMember(id: string) {
  if (!confirm('确定禁用此成员？禁用后仍可恢复。')) return
  try { await apis.team.disableMember(id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

/* ===== 删除（物理删除，仅限无业务数据的账号）===== */
const selected = ref<Set<string>>(new Set())
const deleting = ref(false)
const deleteResult = ref('')

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleSelectAll() {
  if (selected.value.size === deletableMembers.value.length) selected.value = new Set()
  else selected.value = new Set(deletableMembers.value.map((m) => m.id))
}

/** admin 账号与当前登录人不可删，不进勾选范围 */
const deletableMembers = computed(() => members.value.filter((m) => m.role !== 'admin' && m.id !== auth.user?.id))

async function deleteMember(id: string, name: string) {
  if (!confirm(`确定永久删除成员「${name}」？此操作不可恢复。\n有业务数据的账号会被拒绝删除，建议改用禁用。`)) return
  deleting.value = true
  deleteResult.value = ''
  try {
    await apis.team.deleteMember(id)
    deleteResult.value = `已删除成员「${name}」。`
    selected.value.delete(id)
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { deleting.value = false }
}

async function batchDelete() {
  const ids = [...selected.value]
  if (!ids.length) return
  if (!confirm(`确定永久删除选中的 ${ids.length} 个成员？此操作不可恢复。\n有业务数据的账号会被跳过（拒绝删除）。`)) return
  deleting.value = true
  deleteResult.value = ''
  error.value = ''
  const failed: string[] = []
  let deleted = 0
  for (const id of ids) {
    const name = members.value.find((m) => m.id === id)?.username ?? id
    try { await apis.team.deleteMember(id); deleted++ }
    catch (e: any) { failed.push(`${name}（${e?.message ?? '失败'}）`) }
  }
  selected.value = new Set()
  deleteResult.value = `已删除 ${deleted} 个成员${failed.length ? `；${failed.length} 个被拒绝：${failed.join('；')}` : ''}`
  await load()
  deleting.value = false
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">TEAM / MEMBERS</p>
        <h1>用户管理</h1>
      </div>
      <button class="primary-action" @click="showCreate = true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        添加成员
      </button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <div v-if="created" style="padding: 12px 16px; border: 1px solid var(--sun); border-radius: var(--radius); background: #f4e8c7; font-size: 11px; font-family: var(--font-mono); color: #59645d;">
      创建成功！临时密码：<strong>{{ created.temporaryPassword }}</strong>（{{ created.username }}）
    </div>
    <div v-if="resetResult" style="padding: 12px 16px; border: 1px solid var(--sun); border-radius: var(--radius); background: #f4e8c7; font-size: 11px; font-family: var(--font-mono); color: #59645d;">
      <template v-if="resetResult.temporaryPassword">已生成临时密码：<strong>{{ resetResult.temporaryPassword }}</strong>（成员下次登录需修改）</template>
      <template v-else>密码已更新为自定义密码。</template>
    </div>

    <article v-if="applications.length" class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">入团申请</span>
        <span class="toolbar-count">{{ applications.filter(a => a.status === 'pending').length }} 待审批</span>
      </div>
      <div class="responsive-table">
        <table>
          <thead><tr><th>申请人</th><th>留言</th><th>申请时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="a in applications" :key="a.id">
              <td><strong>{{ a.creatorName }}</strong> <small style="color: var(--ink-soft); font-family: var(--font-mono); font-size: 10px;">{{ a.creatorUsername }}</small></td>
              <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ a.message || '—' }}</td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ new Date(a.createdAt).toLocaleDateString('zh-CN') }}</td>
              <td><span :class="['status-badge', a.status === 'approved' ? 'active' : a.status === 'rejected' ? 'rejected' : a.status === 'cancelled' ? 'ended' : 'paused']">{{ { pending: '待审批', approved: '已通过', rejected: '已驳回', cancelled: '已撤回' }[a.status] }}</span></td>
              <td>
                <div v-if="a.status === 'pending'" style="display: flex; gap: 6px;">
                  <button class="row-action" @click="reviewApplication(a.id, 'approve')">通过</button>
                  <button class="row-action danger" @click="reviewApplication(a.id, 'reject')">驳回</button>
                </div>
                <span v-else style="color: var(--ink-soft); font-size: 10px;">已处理</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">成员列表</span>
        <span class="toolbar-count">{{ members.length }}</span>
        <button v-if="selected.size" class="row-action danger" :disabled="deleting" @click="batchDelete">
          批量删除（{{ selected.size }}）
        </button>
      </div>
      <div v-if="deleteResult" style="padding: 10px 22px; border-bottom: 1px solid var(--line); color: var(--ink-soft); font-size: 11px;">{{ deleteResult }}</div>
      <div v-if="loading" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!members.length" class="empty-panel"><span>暂无成员。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th style="width: 32px;"><input type="checkbox" :checked="selected.size === deletableMembers.length && deletableMembers.length > 0" @change="toggleSelectAll" /></th><th>用户名</th><th>显示名</th><th>角色</th><th>最后登录</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="m in members" :key="m.id">
              <td>
                <input v-if="m.role !== 'admin' && m.id !== auth.user?.id" type="checkbox" :checked="selected.has(m.id)" @change="toggleSelect(m.id)" />
              </td>
              <td style="font-family: var(--font-mono); font-size: 10px;">{{ m.username }}</td>
              <td><strong>{{ m.displayName }}</strong></td>
              <td><span class="status-badge draft">{{ m.role }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('zh-CN') : '—' }}</td>
              <td><span :class="['status-badge', m.isActive ? 'active' : 'ended']">{{ m.isActive ? '活跃' : '已禁用' }}</span></td>
              <td>
                <div style="display: flex; gap: 6px;">
                  <button class="row-action" @click="openReset(m)">重置密码</button>
                  <button v-if="m.isActive" class="row-action" @click="disableMember(m.id)">禁用</button>
                  <button v-if="m.role !== 'admin' && m.id !== auth.user?.id" class="row-action danger" :disabled="deleting" @click="deleteMember(m.id, m.username)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <Teleport to="body">
      <div v-if="showCreate" style="position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; background: rgba(33, 33, 33, 0.4); backdrop-filter: blur(2px);" @click.self="showCreate = false">
        <div style="width: min(420px, 90vw); padding: 28px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--white); box-shadow: var(--shadow-float);">
          <h2 style="margin: 0 0 20px; font-family: var(--font-display); font-size: 22px;">添加成员</h2>
          <form class="form-grid" @submit.prevent="createMember" style="gap: 16px;">
            <div><label>用户名</label><input v-model="form.username" required /></div>
            <div><label>显示名</label><input v-model="form.displayName" required /></div>
            <div>
              <label>角色</label>
              <select v-model="form.role"><option value="leader">团长</option><option value="creator">达人</option></select>
            </div>
            <div class="form-submit" style="display: flex; gap: 10px; margin-top: 8px;">
              <button type="submit" class="primary-action" style="flex: 1;">确认创建</button>
              <button type="button" class="ghost-aurora" @click="showCreate = false">取消</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- 重置密码对话框 -->
    <Teleport to="body">
      <div v-if="resetTarget" style="position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; background: rgba(33, 33, 33, 0.4); backdrop-filter: blur(2px);" @click.self="resetTarget = null">
        <div style="width: min(420px, 90vw); padding: 28px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--white); box-shadow: var(--shadow-float);">
          <h2 style="margin: 0 0 6px; font-family: var(--font-display); font-size: 22px;">重置密码</h2>
          <p style="margin: 0 0 20px; color: var(--ink-soft); font-size: 12px;">为 <strong style="color: var(--ink);">{{ resetTarget.displayName }}</strong> 设置新密码。</p>
          <form class="form-grid" style="grid-template-columns: 1fr; gap: 16px;" @submit.prevent="confirmReset">
            <div>
              <label>自定义密码</label>
              <input v-model="resetForm.password" type="text" minlength="8" maxlength="128" placeholder="留空则自动生成临时密码" autocomplete="off" />
              <small style="display: block; margin-top: 6px; color: var(--ink-soft); font-size: 10px;">至少 8 位。留空时系统生成临时密码，成员下次登录需修改。</small>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 8px;">
              <button type="submit" class="primary-action" :disabled="resetting" style="flex: 1;">{{ resetting ? '提交中...' : '确认重置' }}</button>
              <button type="button" class="ghost-aurora" @click="resetTarget = null">取消</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
