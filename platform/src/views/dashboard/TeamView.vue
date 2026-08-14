<template>
  <div class="team-page">
    <div class="pg-header">
      <div><h1 class="pg-title">子账号与团队管理</h1><p class="pg-sub">Admin 管理团长 / 运营，团长 / 运营管理本组 KOC 达人</p></div>
      <button v-if="auth.isBoss || auth.isLeader" class="btn-accent-sm" @click="openCreate">+ {{ createButtonLabel }}</button>
    </div>

    <!-- Stats row -->
    <div class="stat-row">
      <div class="stat-pill"><span class="sp-v">{{ members.length }}</span><span class="sp-l">成员总数</span></div>
      <div class="stat-pill"><span class="sp-v" style="color:var(--color-accent)">{{ members.filter(m=>m.role==='leader').length }}</span><span class="sp-l">团长 / 运营</span></div>
      <div class="stat-pill"><span class="sp-v">{{ members.filter(m=>m.role==='member').length }}</span><span class="sp-l">KOC 达人</span></div>
      <div class="stat-pill"><span class="sp-v" style="color:var(--color-success)">{{ fmtFen(totalEarnings) }}</span><span class="sp-l">团队总收益</span></div>
    </div>

    <!-- Filter -->
    <div class="filter-row">
      <div class="search-box">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input v-model="q" placeholder="搜索成员昵称…" />
      </div>
      <div class="filter-chips">
        <span v-for="f in roleFilters" :key="f.val" :class="['chip', { active: roleF === f.val }]" @click="roleF = f.val">{{ f.label }}</span>
      </div>
    </div>

    <!-- Table -->
    <div class="table-card">
      <a-table :dataSource="filtered" :columns="cols" :pagination="{ pageSize: 10 }" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'member'">
            <div class="member-cell">
              <div class="member-avatar">{{ initials(record.displayName) }}</div>
              <div>
                <div class="member-name">{{ record.displayName }}</div>
                <div class="member-id">{{ record.username }}</div>
              </div>
            </div>
          </template>
          <template v-if="column.key === 'role'">
            <span :class="['badge', record.role === 'leader' ? 'badge-accent' : 'badge-default']">
              <span class="badge-dot"/>{{ roleLabel(record.role) }}
            </span>
          </template>
          <template v-if="column.key === 'earnings'">
            <span style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--color-success)">{{ fmtFen(record.totalEarnings) }}</span>
          </template>
          <template v-if="column.key === 'actions'">
            <div class="actions-cell" v-if="auth.isBoss || (auth.isLeader && record.role === 'member')">
              <button class="act-btn" @click="openEdit(record as TeamMember)">编辑</button>
              <a-popconfirm
                title="重置后原密码立即失效，确认继续？"
                ok-text="确认重置"
                cancel-text="取消"
                @confirm="handleResetPassword(record as TeamMember)"
              >
                <button class="act-btn" :disabled="resettingId === record.id">重置密码</button>
              </a-popconfirm>
              <button class="act-btn danger" @click="handleRemove(record as TeamMember)">移除</button>
            </div>
            <span v-else style="color:var(--color-text-disabled);font-size:12px">—</span>
          </template>
        </template>
      </a-table>
    </div>

    <!-- Create / Edit Modal -->
    <a-modal v-model:open="showModal" :title="editingId ? '编辑成员' : '添加成员'" :footer="null" width="480">
      <a-form :model="form" layout="vertical" @finish="handleSubmit">
        <a-form-item label="显示名称" name="displayName" :rules="[{ required: true, message: '请输入显示名称' }]">
          <a-input v-model:value="form.displayName" placeholder="成员显示名称" />
        </a-form-item>
        <template v-if="!editingId">
          <a-form-item label="登录账号" name="username" :rules="[{ required: true, message: '请输入账号' }]">
            <a-input v-model:value="form.username" placeholder="用于登录的唯一账号" />
          </a-form-item>
          <a-alert message="账号创建后会生成一次性临时密码，请及时复制并交给成员。" type="info" show-icon />
        </template>
        <a-form-item v-if="!editingId" label="角色" name="role" :rules="[{ required: true }]">
          <a-select v-model:value="form.role">
            <a-select-option v-if="auth.isBoss" value="leader">团长 / 运营（管理本组 KOC）</a-select-option>
            <a-select-option value="member">KOC 达人（执行编词与回传）</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item v-if="!editingId && form.role === 'member' && leaders.length > 0" label="归属团长" name="parentId">
          <a-select v-model:value="form.parentId" placeholder="选择归属团长（可选）" allow-clear>
            <a-select-option v-for="l in leaders" :key="l.id" :value="l.id">{{ l.displayName }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="!editingId && auth.isBoss && (form.role === 'leader' || !form.parentId)"
          label="分配渠道（可选）"
          name="channelId"
          extra="仅显示未归属渠道；达人若选择了归属团长，将自动继承团长渠道。"
        >
          <a-select v-model:value="form.channelId" placeholder="可稍后在推广计划页分配" allow-clear>
            <a-select-option v-for="channel in assignableChannels" :key="channel.id" :value="channel.id">
              {{ channel.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <div style="display:flex;gap:10px;margin-top:8px">
          <a-button @click="showModal = false" style="flex:1">取消</a-button>
          <a-button type="primary" html-type="submit" :loading="submitting" style="flex:1">{{ editingId ? '保存' : '创建成员' }}</a-button>
        </div>
      </a-form>
    </a-modal>

    <!-- 一次性临时密码弹窗 -->
    <a-modal
      v-model:open="showPasswordModal"
      title="请保存临时密码"
      :footer="null"
      :closable="false"
      :keyboard="false"
      :mask-closable="false"
      width="480"
      @after-close="clearTemporaryPassword"
    >
      <a-alert
        message="该密码仅展示一次"
        description="关闭后无法再次查看；成员首次登录后应立即修改密码。"
        type="warning"
        show-icon
      />
      <div class="password-account">登录账号：<strong>{{ temporaryUsername }}</strong></div>
      <div class="temporary-password-row">
        <code class="temporary-password">{{ temporaryPassword }}</code>
        <a-button @click="copyTemporaryPassword">复制密码</a-button>
      </div>
      <a-button type="primary" block @click="showPasswordModal = false">我已保存</a-button>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { teamApi } from '@/api/team'
import { channelsApi } from '@/api/channels'
import { useAuthStore } from '@/stores/auth'
import { fmtFen, initials, roleLabel } from '@/utils/format'
import { message } from 'ant-design-vue'
import type { Channel, TeamMember } from '@/types/api'

const auth = useAuthStore()
const createButtonLabel = computed(() => auth.isBoss ? '添加子账号' : '添加 KOC 达人')

const members    = ref<TeamMember[]>([])
const channels   = ref<Channel[]>([])
const q          = ref('')
const roleF      = ref('all')
const showModal  = ref(false)
const submitting = ref(false)
const editingId  = ref<string>()
const resettingId = ref<string>()
const showPasswordModal = ref(false)
const temporaryUsername = ref('')
const temporaryPassword = ref('')
const form = ref({ displayName: '', username: '', role: 'member' as 'leader'|'member', parentId: undefined as string | undefined, channelId: undefined as string | undefined })

const roleFilters = [
  { val: 'all', label: '全部' }, { val: 'leader', label: '团长' }, { val: 'member', label: '达人' },
]

const filtered = computed(() => members.value
  .filter(m => roleF.value === 'all' || m.role === roleF.value)
  .filter(m => !q.value || m.displayName.includes(q.value)))

const leaders        = computed(() => members.value.filter(m => m.role === 'leader'))
const assignableChannels = computed(() => channels.value.filter(channel => !channel.ownerId))
const totalEarnings  = computed(() => members.value.reduce((s, m) => s + m.totalEarnings, 0))

function openCreate() {
  editingId.value = undefined
  form.value = { displayName: '', username: '', role: 'member', parentId: undefined, channelId: undefined }
  showModal.value = true
}
function openEdit(m: TeamMember) {
  editingId.value = m.id
  form.value = { displayName: m.displayName, username: m.username, role: m.role, parentId: m.parentId ?? undefined, channelId: undefined }
  showModal.value = true
}

function showTemporaryPassword(username: string, password: string) {
  temporaryUsername.value = username
  temporaryPassword.value = password
  showPasswordModal.value = true
}

function clearTemporaryPassword() {
  temporaryUsername.value = ''
  temporaryPassword.value = ''
}

async function copyTemporaryPassword() {
  await navigator.clipboard.writeText(temporaryPassword.value)
  message.success('临时密码已复制')
}

async function handleResetPassword(m: TeamMember) {
  resettingId.value = m.id
  try {
    const result = await teamApi.resetPassword(m.id)
    showTemporaryPassword(m.username, result.temporaryPassword)
    message.success(`「${m.displayName}」的密码已重置`)
  } catch (e: any) {
    message.error(e.message || '重置密码失败')
  } finally {
    resettingId.value = undefined
  }
}

async function handleRemove(m: TeamMember) {
  try {
    await teamApi.remove(m.id)
    members.value = members.value.filter(x => x.id !== m.id)
    message.success(`已移除「${m.displayName}」`)
  } catch (e: any) { message.error(e.message || '操作失败') }
}

async function handleSubmit() {
  submitting.value = true
  try {
    if (editingId.value) {
      const updated = await teamApi.update(editingId.value, { displayName: form.value.displayName })
      const idx = members.value.findIndex(m => m.id === editingId.value)
      if (idx >= 0) members.value[idx] = updated
      message.success('成员信息已更新')
    } else {
      const created = await teamApi.create({ username: form.value.username, displayName: form.value.displayName, role: form.value.role, parentId: form.value.parentId })
      let channelAssignmentFailed = false
      if (form.value.channelId) {
        try {
          await channelsApi.assignOwner(form.value.channelId, created.id)
        } catch {
          channelAssignmentFailed = true
        }
      }
      await loadData()
      showTemporaryPassword(created.username, created.temporaryPassword)
      if (channelAssignmentFailed) {
        message.warning(`「${form.value.displayName}」已添加，但渠道分配失败，请前往推广计划页重试`)
      } else {
        message.success(`「${form.value.displayName}」已添加`)
      }
    }
    showModal.value = false
  } catch (e: any) {
    message.error(e.message || '提交失败')
  } finally { submitting.value = false }
}

async function loadData() {
  try {
    const [memberList, channelList] = await Promise.all([
      teamApi.list(),
      auth.isBoss ? channelsApi.list({ page: 1, pageSize: 100 }) : Promise.resolve(null),
    ])
    members.value = memberList
    channels.value = channelList?.list ?? []
  } catch (_) { /* empty */ }
}

const cols = [
  { title: '成员',    key: 'member' },
  { title: '角色',    key: 'role',           width: 110 },
  { title: '计划数',  dataIndex: 'planCount', key: 'planCount', width: 90 },
  { title: '累计收益', key: 'earnings',       width: 120 },
  { title: '加入时间', dataIndex: 'created_at', key: 'created_at', width: 120,
    customRender: ({ text }: { text: string }) => text?.slice(0, 10) ?? '—' },
  { title: '操作',    key: 'actions',         width: 220 },
]

onMounted(loadData)
</script>

<style scoped>
.team-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.btn-accent-sm { padding: 8px 16px; background: var(--color-accent); border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; color: white; cursor: pointer; transition: all var(--transition-fast); }
.btn-accent-sm:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); }
.stat-row { display: flex; gap: 12px; margin-bottom: 18px; }
.stat-pill { display: flex; flex-direction: column; gap: 3px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 14px 20px; }
.sp-v { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-text-primary); }
.sp-l { font-size: 11.5px; color: var(--color-text-disabled); }
.filter-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.search-box { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-disabled); min-width: 220px; }
.search-box:focus-within { border-color: var(--color-accent); }
.search-box input { background: none; border: none; outline: none; font-size: 13px; color: var(--color-text-secondary); width: 100%; }
.filter-chips { display: flex; gap: 6px; }
.chip { padding: 5px 12px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.chip.active, .chip:hover { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent); }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.member-cell { display: flex; align-items: center; gap: 10px; }
.member-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--gradient-accent); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: white; flex-shrink: 0; }
.member-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary); }
.member-id { font-size: 11px; color: var(--color-text-disabled); font-family: var(--font-mono); }
.badge-accent { background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.25); color: var(--color-accent); }
.actions-cell { display: flex; gap: 6px; }
.act-btn { padding: 4px 10px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 11.5px; color: var(--color-text-secondary); cursor: pointer; transition: all var(--transition-fast); }
.act-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.act-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.act-btn.danger:hover { border-color: var(--color-error); color: var(--color-error); }
.password-account { margin: 20px 0 10px; color: var(--color-text-secondary); }
.temporary-password-row { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
.temporary-password { flex: 1; padding: 10px 12px; overflow-wrap: anywhere; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-primary); font-size: 14px; }
</style>
