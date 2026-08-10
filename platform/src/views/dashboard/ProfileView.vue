<template>
  <div class="profile-page">
    <div class="pg-header">
      <div><h1 class="pg-title">个人中心</h1><p class="pg-sub">管理你的账号信息与登录密码</p></div>
    </div>

    <div class="profile-layout">
      <!-- 左侧：用户信息卡片 -->
      <div class="info-card animate-card">
        <div class="avatar-block">
          <div class="big-avatar">{{ initials(auth.user?.displayName ?? '?') }}</div>
          <div class="avatar-info">
            <div class="ainfo-name">{{ auth.user?.displayName }}</div>
            <div class="ainfo-username">@{{ auth.user?.username }}</div>
            <span :class="['badge', roleBadgeClass(auth.user?.role ?? '')]" style="margin-top:6px">
              <span class="badge-dot"/>{{ roleLabel(auth.user?.role ?? '') }}
            </span>
          </div>
        </div>

        <div class="info-rows">
          <div class="info-row">
            <span class="ir-k">账号 ID</span>
            <span class="ir-v mono">{{ auth.user?.id }}</span>
          </div>
          <div class="info-row">
            <span class="ir-k">用户名</span>
            <span class="ir-v">{{ auth.user?.username }}</span>
          </div>
          <div class="info-row">
            <span class="ir-k">显示名称</span>
            <span class="ir-v">{{ auth.user?.displayName }}</span>
          </div>
          <div class="info-row">
            <span class="ir-k">角色</span>
            <span class="ir-v">{{ roleLabel(auth.user?.role ?? '') }}</span>
          </div>
          <div class="info-row">
            <span class="ir-k">手机号</span>
            <span class="ir-v">{{ auth.user?.phone || '未绑定' }}</span>
          </div>
          <div class="info-row">
            <span class="ir-k">权限数</span>
            <span class="ir-v">{{ auth.user?.permissions?.length ?? 0 }} 项</span>
          </div>
        </div>

        <!-- 权限列表 -->
        <div class="perm-section">
          <div class="perm-title">已有权限</div>
          <div class="perm-tags">
            <span v-for="p in auth.user?.permissions ?? []" :key="p" class="perm-tag">{{ p }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧：改密表单 -->
      <div class="pwd-card animate-card" style="animation-delay:80ms">
        <div class="card-title">修改密码</div>

        <div v-if="pwdSuccess" class="success-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          密码已更新，下次登录请使用新密码
        </div>

        <a-form :model="pwdForm" layout="vertical" @finish="handleChangePwd" style="margin-top:12px">
          <a-form-item label="当前密码" name="oldPassword" :rules="[{ required: true, message: '请输入当前密码' }]">
            <a-input-password v-model:value="pwdForm.oldPassword" placeholder="输入当前登录密码" />
          </a-form-item>
          <a-form-item label="新密码" name="newPassword"
            :rules="[{ required: true, message: '请输入新密码' }, { min: 8, message: '至少 8 位' }]">
            <a-input-password v-model:value="pwdForm.newPassword" placeholder="至少 8 位" />
          </a-form-item>
          <a-form-item label="确认新密码" name="confirmPassword"
            :rules="[{ required: true, message: '请再次输入新密码' }, { validator: confirmValidator }]">
            <a-input-password v-model:value="pwdForm.confirmPassword" placeholder="再次输入新密码" />
          </a-form-item>
          <a-button type="primary" html-type="submit" :loading="pwdLoading" block style="margin-top:4px">
            更新密码
          </a-button>
        </a-form>

        <div class="logout-zone">
          <div class="logout-title">退出登录</div>
          <p class="logout-desc">退出后需重新登录才能访问平台。</p>
          <a-button danger :loading="logoutLoading" @click="handleLogout">退出当前账号</a-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import { initials, roleLabel } from '@/utils/format'

const auth   = useAuthStore()
const router = useRouter()

const roleBadgeClass = (r: string) =>
  ({ boss: 'badge-error', leader: 'badge-accent', member: 'badge-success' })[r] ?? 'badge-default'

// ── 改密 ────────────────────────────────────────────────────────
const pwdForm    = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const pwdLoading = ref(false)
const pwdSuccess = ref(false)

async function confirmValidator(_: unknown, value: string) {
  if (value && value !== pwdForm.newPassword) return Promise.reject('两次输入的密码不一致')
  return Promise.resolve()
}

async function handleChangePwd() {
  pwdLoading.value = true
  try {
    await authApi.changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword })
    pwdSuccess.value = true
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPassword = ''
    message.success('密码已更新')
  } catch (e: any) {
    message.error(e.message || '修改失败，请检查原密码')
  } finally {
    pwdLoading.value = false
  }
}

// ── 退出 ────────────────────────────────────────────────────────
const logoutLoading = ref(false)
async function handleLogout() {
  logoutLoading.value = true
  await auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.profile-page { padding-bottom: 24px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.profile-layout { display: grid; grid-template-columns: 320px 1fr; gap: 20px; }
.info-card, .pwd-card {
  background: var(--color-bg-elevated); border: 1px solid var(--color-border);
  border-radius: var(--radius-xl); padding: 24px; opacity: 0;
}
.avatar-block { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--color-border); }
.big-avatar { width: 56px; height: 56px; border-radius: 50%; background: var(--gradient-accent); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; color: white; flex-shrink: 0; }
.ainfo-name { font-size: 16px; font-weight: 700; color: var(--color-text-primary); }
.ainfo-username { font-size: 12.5px; color: var(--color-text-disabled); margin-top: 3px; }
.badge-accent { background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.25); color: var(--color-accent); }
.info-rows { display: flex; flex-direction: column; gap: 0; }
.info-row { display: flex; align-items: center; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--color-border); }
.info-row:last-child { border-bottom: none; }
.ir-k { font-size: 12px; color: var(--color-text-tertiary); min-width: 60px; flex-shrink: 0; }
.ir-v { font-size: 13px; color: var(--color-text-secondary); }
.mono { font-family: var(--font-mono); font-size: 11.5px; }
.perm-section { margin-top: 16px; border-top: 1px solid var(--color-border); padding-top: 16px; }
.perm-title { font-size: 12px; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }
.perm-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.perm-tag { padding: 2px 8px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: 11px; font-family: var(--font-mono); color: var(--color-text-tertiary); }
.card-title { font-size: 15px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.success-banner { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--color-success-bg); border: 1px solid rgba(16,185,129,0.2); border-radius: var(--radius-md); font-size: 13px; color: var(--color-success); }
.logout-zone { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--color-border); }
.logout-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; }
.logout-desc { font-size: 12.5px; color: var(--color-text-tertiary); margin-bottom: 12px; }
</style>
