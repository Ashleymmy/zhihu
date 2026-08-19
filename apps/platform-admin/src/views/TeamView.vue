<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { TeamMember, CreateMemberResp } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const members = ref<TeamMember[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)
const form = ref({ username: '', displayName: '', role: 'creator' as 'leader' | 'creator' })
const created = ref<CreateMemberResp | null>(null)
const resetResult = ref<{ id: string; temporaryPassword: string } | null>(null)

async function load() {
  loading.value = true
  try { members.value = await apis.team.listMembers() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
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

async function resetPassword(id: string) {
  try {
    const r = await apis.team.resetPassword(id)
    resetResult.value = { id, temporaryPassword: r.temporaryPassword }
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

async function disableMember(id: string) {
  if (!confirm('确定禁用此成员？')) return
  try { await apis.team.disableMember(id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
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
      重置密码：<strong>{{ resetResult.temporaryPassword }}</strong>
    </div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">成员列表</span>
        <span class="toolbar-count">{{ members.length }}</span>
      </div>
      <div v-if="loading" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!members.length" class="empty-panel"><span>暂无成员。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>最后登录</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="m in members" :key="m.id">
              <td style="font-family: var(--font-mono); font-size: 10px;">{{ m.username }}</td>
              <td><strong>{{ m.displayName }}</strong></td>
              <td><span class="status-badge draft">{{ m.role }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('zh-CN') : '—' }}</td>
              <td><span :class="['status-badge', m.isActive ? 'active' : 'ended']">{{ m.isActive ? '活跃' : '已禁用' }}</span></td>
              <td>
                <div style="display: flex; gap: 6px;">
                  <button class="row-action" @click="resetPassword(m.id)">重置密码</button>
                  <button v-if="m.isActive" class="row-action" style="color: var(--clay); border-color: var(--clay);" @click="disableMember(m.id)">禁用</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <Teleport to="body">
      <div v-if="showCreate" style="position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; background: rgba(23, 53, 46, 0.58); backdrop-filter: blur(3px);" @click.self="showCreate = false">
        <div style="width: min(420px, 90vw); padding: 28px; border: 1px solid var(--ink); border-radius: 8px; background: var(--white); box-shadow: 7px 8px 0 rgba(23, 53, 46, 0.34);">
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
  </div>
</template>
