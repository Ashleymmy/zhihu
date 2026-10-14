<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
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
})
const smsCode = ref(''), loginMode = ref<'password' | 'sms'>('password'), smsEnabled = ref(false)
const policyReady = ref(false), policyLoading = ref(false), sendingCode = ref(false), cooldown = ref(0), codeNotice = ref(''), agreed = ref(false)
let timer: ReturnType<typeof setInterval> | undefined, retryAt = 0, policyVersion = 0, disposed = false
const tick = () => { cooldown.value = Math.max(0, Math.ceil((retryAt-Date.now())/1000)); if (!cooldown.value) clearInterval(timer) }
onUnmounted(() => { disposed = true; ++policyVersion; ++invitationVersion; clearInterval(timer) })
watch(phone, () => { smsCode.value = ''; codeNotice.value = '' })
async function loadPolicy() {
  const version = ++policyVersion
  policyReady.value = false; policyLoading.value = true
  try {
    if (registering.value) {
      const result = await apis.auth.registrationPolicy(invitationToken.value || undefined)
      if (version !== policyVersion) return
      policyReady.value = result.registrationMode === 'sms' && result.smsRequired && result.smsEnabled
      if (!policyReady.value) errorMessage.value = '短信注册暂不可用，请稍后重试；已有账号可直接登录'
    } else {
      const result = await apis.auth.smsPolicy()
      if (version !== policyVersion) return
      smsEnabled.value = result.smsLoginEnabled
    }
  } catch (e: any) { if(version === policyVersion) errorMessage.value = e.message || '读取失败，请重试' }
  finally { if(version === policyVersion) policyLoading.value = false }
}
watch([registering, invitationToken], () => { smsCode.value = ''; password.value = ''; errorMessage.value = ''; void loadPolicy() }, {immediate:true})
async function sendCode() {
  if (sendingCode.value || submitting.value || cooldown.value) return
  errorMessage.value = ''
  if (registering.value && !agreed.value) { errorMessage.value = '请先阅读并同意用户协议与隐私协议'; return }
  if (!/^1\d{10}$/.test(phone.value)) { errorMessage.value = '请输入正确的 11 位手机号'; return }
  if (registering.value && !policyReady.value) return
  const number = phone.value, wasRegistering = registering.value
  sendingCode.value = true; smsCode.value = ''; codeNotice.value = ''
  try {
    const result = wasRegistering ? await apis.auth.sendRegistrationCode(number, invitationToken.value || undefined) : await apis.auth.sendLoginCode(number)
    if (disposed) return
    retryAt = Date.now() + Math.max(60,result.retryAfterSeconds || 60)*1000
    clearInterval(timer); tick(); timer = setInterval(tick,1000)
    if(number === phone.value && wasRegistering === registering.value) codeNotice.value = '验证码已发送，5 分钟内有效'
  } catch(e:any) { errorMessage.value = e.message || '发送失败，请重试' }
  finally { sendingCode.value = false }
}
async function afterLogin() {
  const user = auth.user
  if (user?.hasPassword === false && !localStorage.getItem('timo-password-later-' + user.id)) {
    await router.replace({ name: 'account-security' }); return
  }
  await router.replace(invitationToken.value && !registering.value ? {name:'invitation',hash:route.hash} : safeRedirect(route.query.redirect))
}
async function submit() {
  if (submitting.value || sendingCode.value) return
  errorMessage.value = ''
  if (registering.value && (!policyReady.value || !agreed.value || (invitationToken.value && !invitation.value))) {
    errorMessage.value = !agreed.value ? '请先阅读并同意用户协议与隐私协议' : invitationError.value || '短信注册尚未就绪，请重试'; return
  }
  if ((registering.value || loginMode.value === 'sms') && (!/^1\d{10}$/.test(phone.value) || !/^\d{6}$/.test(smsCode.value))) {
    errorMessage.value = '请输入正确手机号和 6 位验证码'; return
  }
  submitting.value = true
  try {
    if (registering.value) await auth.register({ phone: phone.value, smsCode: smsCode.value, displayName: displayName.value, ...(invitationToken.value ? {invitationToken: invitationToken.value} : {}) })
    else if (loginMode.value === 'sms') await auth.smsLogin(phone.value, smsCode.value)
    else await auth.login(username.value, password.value)
    password.value = ''; smsCode.value = ''
    await afterLogin()
  } catch(e:any) { errorMessage.value = e.message || '操作失败，请重试' }
  finally { submitting.value = false }
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
                : '使用账号密码或手机验证码登录。'
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
          <template v-else-if="invitation"><strong>{{ invitation.inviterName }} 邀请你注册</strong><p>角色：达人 · {{ invitation.teamName ? '加入团队：' + invitation.teamName : '独立达人' }}</p><small>注册后自动开通知乎；加入团队后同时开通团长已有项目。</small></template>
        </div>
        <form @submit.prevent="submit">
          <div class="form-grid" style="grid-template-columns:1fr;margin-top:24px">
            <div v-if="!registering && smsEnabled" class="auth-modes">
              <button type="button" :aria-pressed="loginMode==='password'" :disabled="submitting || sendingCode" @click="loginMode='password';errorMessage=''">账号密码登录</button>
              <button type="button" :aria-pressed="loginMode==='sms'" :disabled="submitting || sendingCode" @click="loginMode='sms';errorMessage=''">手机号验证码登录</button>
            </div>
            <template v-if="registering || loginMode==='sms'">
              <div><label for="phone">手机号</label><input id="phone" v-model.trim="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="11" pattern="1[0-9]{10}" :disabled="submitting || sendingCode" placeholder="请输入手机号" required /></div>
              <div><label for="sms-code">短信验证码</label><div class="sms-code-row"><input id="sms-code" v-model.trim="smsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位验证码" required /><button type="button" :disabled="sendingCode || submitting || cooldown>0 || (registering && !policyReady)" @click="sendCode">{{sendingCode?'正在发送…':cooldown>0?cooldown+' 秒后重发':'获取验证码'}}</button></div></div>
              <p v-if="codeNotice" role="status">{{codeNotice}}</p>
              <small>验证码 5 分钟内有效，由阿里云短信服务及通信运营商发送，仅用于验证手机号。</small>
            </template>
            <template v-else>
              <div><label for="username">用户 ID / 原登录账号</label><input id="username" v-model.trim="username" autocomplete="username" maxlength="64" placeholder="如 timo123456 或原登录账号" required /></div>
              <div><label for="password">密码</label><input id="password" v-model="password" type="password" autocomplete="current-password" maxlength="128" placeholder="请输入密码" required /></div>
            </template>
            <template v-if="registering">
              <div><label for="display-name">昵称（选填）</label><input id="display-name" v-model.trim="displayName" autocomplete="nickname" maxlength="64" placeholder="可在登录后完善" /></div>
              <p>验证后自动分配用户 ID，登录后可设置密码，也可继续使用验证码登录。</p>
              <label class="agreement-consent"><input v-model="agreed" type="checkbox" />我已阅读并同意<router-link to="/agreements/user" target="_blank">用户协议</router-link>和<router-link to="/agreements/privacy" target="_blank">隐私协议</router-link></label>
              <p v-if="!policyReady" role="status">{{policyLoading?'正在读取注册规则…':'注册暂不可用'}} <button v-if="!policyLoading" type="button" @click="loadPolicy">重试</button></p>
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
            :disabled="submitting || sendingCode || (registering && (!policyReady || (!!invitationToken && !invitation)))"
            style="margin-top: 24px"
          >
            {{ submitting ? '提交中...' : registering ? '注册并登录' : '登录' }}
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
.access-card input:not([type=checkbox]) { min-height:44px; box-sizing:border-box; padding:10px 12px; font:inherit }
.auth-modes { display:flex; gap:8px; flex-wrap:wrap }
.auth-modes button { flex:1; min-height:40px }
.auth-modes button[aria-pressed=true] { background:#214239; color:white }
.sms-code-row { display:flex; gap:8px }
.sms-code-row input { width:0; flex:1; min-width:0 }
.sms-code-row button { flex-shrink:0; padding:8px }
.agreement-consent { display:flex; align-items:center; gap:5px; flex-wrap:wrap; font-size:13px }
.agreement-consent input { width:16px; min-height:16px }

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
