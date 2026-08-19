<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isApiError } from '@zhihu-koc/shared-services'
import { APP_ROLE } from '../app-config'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const username = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const roleLabels: Record<string, string> = {
  admin: '管理员工作台',
  leader: '团长工作台',
  creator: '达人工作台',
}

async function submit() {
  if (!username.value || !password.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    await auth.login(username.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch (error) {
    errorMessage.value = isApiError(error) ? error.message : error instanceof Error ? error.message : '登录失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-editorial">
    <aside class="login-manifesto">
      <div>
        <div class="login-wordmark">
          <span class="studio-mark">O</span>
          <strong>OPC</strong>
          <i>OPERATIONS</i>
        </div>
      </div>

      <div class="manifesto-copy">
        <p class="eyebrow">WELCOME BACK</p>
        <h1>让每一次<br /><em>推广都有迹可循。</em></h1>
        <p>登录后即可管理你的推广计划、查看数据趋势、处理订单与结算。系统会为你准备好本周的投放线索。</p>
      </div>

      <div class="manifesto-note">
        <div>
          <strong>数据安全</strong>
          <span>所有数据传输均经过加密处理</span>
        </div>
        <b>SSL</b>
      </div>
    </aside>

    <main class="login-access">
      <div class="access-card">
        <div class="access-heading">
          <p class="eyebrow">SIGN IN</p>
          <h2>登录</h2>
          <p>使用你的账号密码登录 {{ roleLabels[APP_ROLE] }}</p>
        </div>

        <form @submit.prevent="submit">
          <div class="form-grid" style="grid-template-columns: 1fr; margin-top: 32px;">
            <div>
              <label>用户名</label>
              <input v-model.trim="username" type="text" autocomplete="username" placeholder="请输入用户名" required />
            </div>
            <div>
              <label>密码</label>
              <input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" required />
            </div>
          </div>

          <p v-if="errorMessage" style="margin: 16px 0 0; padding: 10px 14px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius);" role="alert">
            {{ errorMessage }}
          </p>

          <button type="submit" class="access-action primary-action" :disabled="submitting" style="margin-top: 24px;">
            {{ submitting ? '登录中...' : '登录' }}
          </button>
        </form>

        <div class="access-trust">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          受保护的企业级管理系统
        </div>

        <div class="access-rule" />

        <div class="access-list">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
            推广计划管理与数据分析
          </span>
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
            订单处理与结算审批
          </span>
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
            团队协作与权限控制
          </span>
        </div>

        <div class="access-footer">
          OPC © 2024 · Powered by Zhihu KOC Platform
        </div>
      </div>
    </main>
  </div>
</template>
