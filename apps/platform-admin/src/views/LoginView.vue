<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isApiError } from '@zhihu-koc/shared-services/core'
import { apis, useAuthStore } from '../stores/auth'
import { safeRedirect } from '../access'
const auth = useAuthStore(),
  route = useRoute(),
  router = useRouter()
const registering = computed(() => route.name === 'register')
const username = ref(''),
  password = ref(''),
  confirmPassword = ref(''),
  displayName = ref(''),
  phone = ref('')
const submitting = ref(false),
  errorMessage = ref('')
const invitationToken = computed(() => new URLSearchParams(route.hash.slice(1)).get('invite') ?? '')
const invitation = ref<{ inviterName: string; teamName: string | null } | null>(null)
const invitationLoading = ref(false), invitationError = ref('')
let invitationVersion = 0
watch([registering, invitationToken], async ([isRegister, token]) => {
  const version = ++invitationVersion
  invitation.value = null
  invitationError.value = ''
  invitationLoading.value = false
  if (!isRegister || !token) return
  invitationLoading.value = true
  try {
    const result = await apis.auth.invitation(token)
    if (version === invitationVersion) invitation.value = result
  } catch (error) {
    if (version === invitationVersion) invitationError.value = isApiError(error) || error instanceof Error ? error.message : '邀请链接不可用，请联系邀请人'
  } finally {
    if (version === invitationVersion) invitationLoading.value = false
  }
}, { immediate: true })
watch(registering, () => {
  errorMessage.value = ''
  if (registering.value && invitationToken.value && !invitation.value) {
    errorMessage.value = invitationError.value || '正在核验邀请链接，请稍候'
    return
  }
  password.value = ''
  confirmPassword.value = ''
})
async function submit() {
  if (submitting.value) return
  errorMessage.value = ''
  if (registering.value && invitationToken.value && !invitation.value) {
    errorMessage.value = invitationError.value || '正在核验邀请链接，请稍候'
    return
  }
  if (registering.value && password.value !== confirmPassword.value) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }
  if (
    registering.value &&
    new TextEncoder().encode(password.value).length > 72
  ) {
    errorMessage.value = '密码不能超过 72 个字节，请减少字符数量'
    return
  }
  submitting.value = true
  try {
    if (registering.value) {
      await auth.register({
        username: username.value,
        password: password.value,
        displayName: displayName.value,
        ...(phone.value ? { phone: phone.value } : {}),
        ...(invitationToken.value ? { invitationToken: invitationToken.value } : {}),
      })
      await router.replace({
        name: 'login',
        query: {
          registered: '1',
          redirect: safeRedirect(route.query.redirect),
        },
      })
    } else {
      await auth.login(username.value, password.value)
      await router.replace(safeRedirect(route.query.redirect))
    }
  } catch (error) {
    errorMessage.value = isApiError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : '操作失败，请重试'
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
        <h1>让每一项<br /><em>业务协作更清晰。</em></h1>
        <p>
          统一管理项目与团队，按需接入业务平台，在同一个工作台查看各项业务。
        </p>
      </div>

      <div class="manifesto-note">
        <div>
          <strong>账号与权限</strong>
          <span>按角色分配权限，管理登录设备</span>
        </div>
        <b>OPC</b>
      </div>
    </aside>

    <main class="login-access">
      <div class="access-card">
        <div class="access-heading">
          <p class="eyebrow">
            {{ registering ? 'CREATE ACCOUNT' : 'SIGN IN' }}
          </p>
          <h2>{{ registering ? '创建账号' : '登录' }}</h2>
          <p>
            {{
              registering
                ? '注册达人账号，开始管理你的业务与收益。'
                : '使用账号密码登录，自动进入你有权限的工作台。'
            }}
          </p>
        </div>

        <p
          v-if="!registering && route.query.registered === '1'"
          class="auth-success"
          role="status"
        >
          注册成功，请使用新账号登录。
        </p>
        <p v-if="!registering && route.query.passwordChanged === '1'" class="auth-success" role="status">密码已修改，请使用新密码登录。</p>
        <div v-if="registering && invitationToken" class="invitation-note" role="status">
          <p v-if="invitationLoading">正在核验邀请链接…</p>
          <p v-else-if="invitationError" role="alert">{{ invitationError }}</p>
          <template v-else-if="invitation"><strong>{{ invitation.inviterName }} 邀请你注册</strong><p>角色：达人 · {{ invitation.teamName ? '加入团队：' + invitation.teamName : '独立达人' }}</p><small>注册后，业务项目由团长或运营在成员编辑中分配。</small></template>
        </div>
        <form @submit.prevent="submit">
          <div
            class="form-grid"
            style="grid-template-columns: 1fr; margin-top: 32px"
          >
            <div>
              <label for="username">用户名</label>
              <input
                id="username"
                v-model.trim="username"
                type="text"
                autocomplete="username"
                :minlength="registering ? 3 : 1"
                maxlength="64"
                :pattern="registering ? '[a-zA-Z0-9_\\-]+' : undefined"
                :placeholder="
                  registering
                    ? '3–64 位字母、数字、下划线或短横线'
                    : '请输入用户名'
                "
                required
              />
            </div>
            <div>
              <label for="password">密码</label>
              <input
                id="password"
                v-model="password"
                type="password"
                :autocomplete="
                  registering ? 'new-password' : 'current-password'
                "
                :minlength="registering ? 8 : 1"
                :maxlength="registering ? 72 : 128"
                :placeholder="
                  registering ? '请输入至少 8 位密码' : '请输入密码'
                "
                required
              />
            </div>
            <template v-if="registering">
              <div>
                <label for="confirm-password">确认密码</label
                ><input
                  id="confirm-password"
                  v-model="confirmPassword"
                  type="password"
                  autocomplete="new-password"
                  placeholder="请再次输入密码"
                  required
                />
              </div>
              <div>
                <label for="display-name">昵称</label
                ><input
                  id="display-name"
                  v-model.trim="displayName"
                  autocomplete="nickname"
                  maxlength="64"
                  placeholder="请输入昵称"
                  required
                />
              </div>
              <div>
                <label for="phone">手机号（选填）</label
                ><input
                  id="phone"
                  v-model.trim="phone"
                  type="tel"
                  autocomplete="tel"
                  maxlength="20"
                  pattern="\+?[0-9 \-]{6,20}"
                  placeholder="请输入手机号"
                />
              </div>
            </template>
          </div>

          <p
            v-if="errorMessage"
            style="
              margin: 16px 0 0;
              padding: 10px 14px;
              background: #f1ded9;
              color: #964639;
              font-size: 13px;
              border-radius: var(--radius);
            "
            role="alert"
          >
            {{ errorMessage }}
          </p>

          <button
            type="submit"
            class="access-action primary-action"
            :disabled="submitting || (registering && !!invitationToken && !invitation)"
            style="margin-top: 24px"
          >
            {{ submitting ? '提交中...' : registering ? '注册' : '登录' }}
          </button>
        </form>

        <p class="auth-switch">
          {{ registering ? '已有账号？' : '还没有账号？' }}
          <router-link
            :to="{
              name: registering ? 'login' : 'register',
              query: { redirect: safeRedirect(route.query.redirect) },
              hash: route.hash,
            }"
            >{{ registering ? '立即登录' : '立即注册' }}</router-link
          >
        </p>
        <div class="access-trust">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          受保护的企业级管理系统
        </div>

        <div class="access-rule" />

        <div class="access-list">
          <span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            推广计划管理与数据分析
          </span>
          <span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            订单处理与结算审批
          </span>
          <span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
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

<style scoped>
.invitation-note { margin-top:20px;padding:16px;border:1px solid var(--line);border-radius:8px;background:var(--paper);line-height:1.6 }
.invitation-note p { margin:8px 0 }
.invitation-note [role=alert] { color:#964639 }
.auth-switch {
  margin-top: 20px;
  text-align: center;
  font-size: 14px;
}
.auth-switch a {
  color: var(--ink);
  font-weight: 600;
  text-decoration: underline;
}
.auth-success {
  padding: 12px;
  margin-top: 20px;
  background: #e2eee7;
  color: #245c3b;
  border-radius: 4px;
}
</style>
