<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { MeResp } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const profile = ref<MeResp | null>(null)
const loading = ref(true)
const error = ref('')

const pwdForm = ref({ oldPassword: '', newPassword: '', confirm: '' })
const pwdSubmitting = ref(false)
const pwdMessage = ref('')
const pwdError = ref('')

const roleLabels: Record<string, string> = { admin: '管理员', leader: '团长', creator: '达人' }

async function load() {
  loading.value = true
  try { profile.value = await apis.auth.me() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function submitPassword() {
  pwdError.value = ''
  pwdMessage.value = ''
  if (!pwdForm.value.oldPassword || !pwdForm.value.newPassword) { pwdError.value = '请填写完整的密码信息'; return }
  if (pwdForm.value.newPassword.length < 8) { pwdError.value = '新密码至少 8 位'; return }
  if (pwdForm.value.newPassword !== pwdForm.value.confirm) { pwdError.value = '两次输入的新密码不一致'; return }
  pwdSubmitting.value = true
  try {
    await apis.auth.changePassword({ oldPassword: pwdForm.value.oldPassword, newPassword: pwdForm.value.newPassword })
    pwdMessage.value = '密码已更新。'
    pwdForm.value = { oldPassword: '', newPassword: '', confirm: '' }
  } catch (e: any) { pwdError.value = e?.message ?? String(e) }
  finally { pwdSubmitting.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">01 / 个人信息</p>
        <h1>账号与身份</h1>
        <p>你的账号信息、团队归属与登录安全设置。</p>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <section class="workspace-grid">
      <div class="min-w-0">
        <article class="panel" style="padding: 24px;">
          <p class="section-index quiet">02 / 基本资料</p>
          <div v-if="profile" class="profile-grid">
            <div class="profile-item"><span>用户名</span><strong>{{ profile.username }}</strong></div>
            <div class="profile-item"><span>显示名</span><strong>{{ profile.displayName }}</strong></div>
            <div class="profile-item"><span>角色</span><strong>{{ roleLabels[profile.role] ?? profile.role }}</strong></div>
            <div class="profile-item"><span>手机号</span><strong>{{ profile.phone ?? '未绑定' }}</strong></div>
            <div class="profile-item">
              <span>团队归属</span>
              <strong>{{ profile.parentId ? '已入团' : '未入团' }}</strong>
            </div>
          </div>
          <div v-else-if="loading" style="padding: 24px 0; color: var(--ink-soft); font-size: 12px;">加载中...</div>
        </article>
      </div>

      <aside class="workspace-rail">
        <p class="section-index quiet">03 / 登录安全</p>
        <h2 class="workspace-title" style="font-size: 22px;">修改密码</h2>
        <form class="rail-form" @submit.prevent="submitPassword">
          <label>当前密码</label>
          <input v-model="pwdForm.oldPassword" type="password" autocomplete="current-password" />
          <label>新密码</label>
          <input v-model="pwdForm.newPassword" type="password" autocomplete="new-password" placeholder="至少 8 位" />
          <label>确认新密码</label>
          <input v-model="pwdForm.confirm" type="password" autocomplete="new-password" />
          <p v-if="pwdError" style="margin: 0; color: var(--clay-deep); font-size: 13px;">{{ pwdError }}</p>
          <p v-if="pwdMessage" style="margin: 0; color: var(--moss); font-size: 13px;">{{ pwdMessage }}</p>
          <button type="submit" class="primary-action" :disabled="pwdSubmitting">{{ pwdSubmitting ? '提交中...' : '更新密码' }}</button>
        </form>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 16px; border-top: 1px solid var(--line); }
.profile-item { display: grid; gap: 4px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.profile-item span { color: #737a80; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.1em; }
.profile-item strong { font-size: 13px; font-weight: 500; }
.rail-form { display: grid; gap: 10px; }
.rail-form label { color: var(--ink-soft); font-size: 13px; font-weight: 600; }
</style>
