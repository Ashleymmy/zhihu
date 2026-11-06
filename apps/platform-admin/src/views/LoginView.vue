<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isApiError } from '@zhihu-koc/shared-services/core'
import { apis, useAuthStore } from '../stores/auth'
import { safeRedirect } from '../access'
import Lanyard3D from './Lanyard3D.vue'

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
const legacyLogin = ref(false)
function toggleLegacyLogin() {
  if (submitting.value || sendingCode.value) return
  legacyLogin.value = !legacyLogin.value
  username.value = ''; password.value = ''; errorMessage.value = ''
}
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

/* ===== 挂绳工牌编排 ===== */
const badge = ref<InstanceType<typeof Lanyard3D> | null>(null)
const cardOut = ref(false) // 递卡中：背景模糊，卡翻到背面
const formOn = ref(false) // DOM 表单贴上卡面
const verifyState = ref<'' | 'checking' | 'ok' | 'fail'>('')
const faceLayer = ref<HTMLElement>()
let formTimer: ReturnType<typeof setTimeout> | undefined

function syncFace(matrix: string, rect: { x: number; y: number; w: number; h: number }) {
  const el = faceLayer.value
  if (!el) return
  el.style.transform = matrix
  el.style.width = rect.w + 'px'
  el.style.height = rect.h + 'px'
}
function openCard() {
  if (cardOut.value) return
  cardOut.value = true
  badge.value?.present()
  clearTimeout(formTimer)
  formTimer = setTimeout(() => { formOn.value = true }, 680)
}
function closeCard() {
  if (submitting.value) return
  formOn.value = false
  cardOut.value = false
  verifyState.value = ''
  badge.value?.dismiss()
}
function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') closeCard() }
if (typeof window !== 'undefined') window.addEventListener('keydown', onEsc)
onUnmounted(() => { window.removeEventListener('keydown', onEsc); clearTimeout(formTimer) })

/* 卡面绘制：正面是品牌工牌，背面是登录卡标题 */
const INK = '#141413', INK_SOFT = '#5e5d59', CLAY = '#d46b45', PAPER_DEEP = '#ece9e0'
function paintBrand(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const mx = w * 0.09
  // 挂孔下方留白由几何槽位承担，内容从 12% 高度开始
  let y = h * 0.135
  // 品牌行
  ctx.fillStyle = CLAY
  const mark = w * 0.115
  ctx.beginPath()
  ctx.roundRect(mx, y, mark, mark, mark * 0.22)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = `700 ${mark * 0.62}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('T', mx + mark / 2, y + mark / 2 + mark * 0.03)
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = `650 ${w * 0.075}px system-ui, sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('TIMO', mx + mark + w * 0.035, y + mark * 0.72)
  ctx.fillStyle = INK_SOFT
  ctx.font = `${w * 0.032}px system-ui, sans-serif`
  ctx.fillText('推广任务聚合平台', mx + mark + w * 0.037, y + mark * 1.08)
  y += mark + h * 0.045
  // 照片区
  const pw = w * 0.52, ph = h * 0.30, px = (w - pw) / 2
  ctx.fillStyle = PAPER_DEEP
  ctx.beginPath()
  ctx.roundRect(px, y, pw, ph, 18)
  ctx.fill()
  // 人形剪影
  ctx.fillStyle = '#c9c5b8'
  const cx = w / 2
  ctx.beginPath()
  ctx.arc(cx, y + ph * 0.38, ph * 0.17, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, y + ph * 1.02, ph * 0.42, Math.PI, 0)
  ctx.fill()
  y += ph + h * 0.05
  // 通行证字样
  ctx.fillStyle = INK
  ctx.font = `700 ${w * 0.056}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${w * 0.006}px`
  ctx.fillText('TIMO PASSPORT', cx, y)
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
  ctx.fillStyle = INK_SOFT
  ctx.font = `${w * 0.033}px ui-monospace, "SF Mono", Consolas, monospace`
  ctx.fillText('NO. TIMO-2026', cx, y + h * 0.038)
  // 底部标语
  ctx.fillStyle = INK
  ctx.font = `500 ${w * 0.036}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('让每一段关系、每一分收益，', cx, h * 0.845)
  ctx.fillText('都看得见。', cx, h * 0.845 + w * 0.05)
  // 条码装饰
  let bx = w * 0.22
  const by = h * 0.9, bw = w * 0.56
  ctx.fillStyle = INK
  let seed = 7
  while (bx < w * 0.22 + bw) {
    seed = (seed * 16807) % 2147483647
    const bwWidth = (seed % 3) + 1
    if (seed % 5) ctx.fillRect(bx, by, bwWidth, h * 0.035)
    bx += bwWidth + (seed % 4) + 2
  }
}
function paintLoginBack(title: string, subtitle: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.textAlign = 'center'
    ctx.fillStyle = CLAY
    ctx.font = `600 ${w * 0.034}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText('TIMO', w / 2, h * 0.15)
    ctx.fillStyle = INK
    ctx.font = `600 ${w * 0.095}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(title, w / 2, h * 0.225)
    ctx.fillStyle = INK_SOFT
    ctx.font = `${w * 0.030}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(subtitle, w / 2, h * 0.27)
    // 底部淡淡的水印
    ctx.fillStyle = 'rgba(20,20,19,0.05)'
    ctx.font = `700 ${w * 0.22}px system-ui, sans-serif`
    ctx.fillText('TIMO', w / 2, h * 0.99)
  }
}
const paintBack = computed(() =>
  registering.value
    ? paintLoginBack('创建账号', '注册达人账号，开始管理业务与收益。')
    : paintLoginBack('账号登录', '使用手机号和密码，或手机验证码登录。'),
)

async function submit() {
  if (submitting.value || sendingCode.value) return
  errorMessage.value = ''
  if (registering.value && (!policyReady.value || !agreed.value || (invitationToken.value && !invitation.value))) {
    errorMessage.value = !agreed.value ? '请先阅读并同意用户协议与隐私协议' : invitationError.value || '短信注册尚未就绪，请重试'; return
  }
  if ((registering.value || loginMode.value === 'sms') && (!/^1\d{10}$/.test(phone.value) || !/^\d{6}$/.test(smsCode.value))) {
    errorMessage.value = '请输入正确手机号和 6 位验证码'; return
  }
  if (!registering.value && loginMode.value === 'password' && !legacyLogin.value && !/^1\d{10}$/.test(username.value)) {
    errorMessage.value = '请输入正确的 11 位手机号；旧账号可选择原账号登录'; return
  }
  submitting.value = true
  verifyState.value = 'checking'
  try {
    if (registering.value) await auth.register({ phone: phone.value, smsCode: smsCode.value, displayName: displayName.value, ...(invitationToken.value ? {invitationToken: invitationToken.value} : {}) })
    else if (loginMode.value === 'sms') await auth.smsLogin(phone.value, smsCode.value)
    else await auth.login(username.value, password.value, legacyLogin.value ? 'username' : 'phone')
    password.value = ''; smsCode.value = ''
    // 验证通过：卡面亮绿灯 → 收卡 → 进场
    verifyState.value = 'ok'
    await new Promise((resolve) => setTimeout(resolve, 700))
    formOn.value = false
    cardOut.value = false
    badge.value?.dismiss()
    await new Promise((resolve) => setTimeout(resolve, 420))
    await afterLogin()
  } catch (e: any) {
    verifyState.value = 'fail'
    errorMessage.value = e.message || '操作失败，请重试'
    setTimeout(() => { if (verifyState.value === 'fail') verifyState.value = '' }, 950)
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
          <span class="studio-mark">T</span>
          <strong>TIMO</strong>
          <i>推广任务聚合平台</i>
        </div>
      </div>

      <div class="manifesto-copy">
        <p class="eyebrow">欢迎回来</p>
        <h1>让每一段关系、<br /><em>每一分收益，<br />都看得见。</em></h1>
        <p>
          领取推广项目、跟进作品、查看收益和提现进度，都在这里完成。
        </p>
      </div>

      <div class="manifesto-note">
        <div>
          <strong>每一笔收益都能查</strong>
          <span>点开任意金额，就能看到它是怎么算出来的</span>
        </div>
      </div>
    </aside>

    <main class="login-access" :class="{ veiled: cardOut }">
      <div class="badge-stage">
        <Lanyard3D
          ref="badge"
          :size="0.56"
          :strap-length="0.22"
          :card-color="'#fbfaf6'"
          :strap-color="'#1c1c20'"
          :gravity="1"
          :damping="0.5"
          :elasticity="0.5"
          :breeze="0.5"
          interactive
          intro
          :paint-front="paintBrand"
          :paint-back="paintBack"
          :on-face-frame="syncFace"
        />
        <!-- DOM 表单层：递卡时贴上卡面（矩阵逐帧同步） -->
        <div v-show="formOn" ref="faceLayer" class="face-layer" :data-verify="verifyState">
          <button type="button" class="face-close" aria-label="收起" @click="closeCard">×</button>
          <div class="face-scroll">
            <h2 class="sr-only">{{ registering ? '创建账号' : '登录' }}</h2>
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
              <div class="form-grid" style="grid-template-columns:1fr">
                <div v-if="!registering && smsEnabled" class="auth-modes">
                  <button type="button" :aria-pressed="loginMode==='password'" :disabled="submitting || sendingCode" @click="loginMode='password';errorMessage=''">手机号密码登录</button>
                  <button type="button" :aria-pressed="loginMode==='sms'" :disabled="submitting || sendingCode" @click="loginMode='sms';errorMessage=''">手机号验证码登录</button>
                </div>
                <template v-if="registering || loginMode==='sms'">
                  <div><label for="phone">手机号</label><input id="phone" v-model.trim="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="11" pattern="1[0-9]{10}" :disabled="submitting || sendingCode" placeholder="请输入手机号" required /></div>
                  <div><label for="sms-code">短信验证码</label><div class="sms-code-row"><input id="sms-code" v-model.trim="smsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位验证码" required /><button type="button" :disabled="sendingCode || submitting || cooldown>0 || (registering && !policyReady)" @click="sendCode">{{sendingCode?'正在发送…':cooldown>0?cooldown+' 秒后重发':'获取验证码'}}</button></div></div>
                  <p v-if="codeNotice" role="status">{{codeNotice}}</p>
                  <small>验证码 5 分钟内有效，由阿里云短信服务及通信运营商发送，仅用于验证手机号。</small>
                </template>
                <template v-else>
                  <div><label for="username">{{legacyLogin ? '原登录账号' : '手机号'}}</label><input id="username" v-model.trim="username" :type="legacyLogin ? 'text' : 'tel'" :inputmode="legacyLogin ? 'text' : 'numeric'" autocomplete="username" :maxlength="legacyLogin ? 64 : 11" :pattern="legacyLogin ? undefined : '1[0-9]{10}'" :placeholder="legacyLogin ? '请输入原登录账号' : '请输入已验证的手机号'" required /></div>
                  <div><label for="password">密码</label><input id="password" v-model="password" type="password" autocomplete="current-password" maxlength="128" placeholder="请输入密码" required /></div>
                  <button type="button" class="legacy-login-switch" :disabled="submitting || sendingCode" @click="toggleLegacyLogin">{{legacyLogin ? '返回手机号登录' : '使用原账号登录'}}</button>
                  <small v-if="legacyLogin">尚未验证手机号的旧账号可先登录，再到个人信息中验证手机号。</small>
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
                  background: #f6e1dc;
                  color: #b4402e;
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
                style="margin-top: 22px"
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
          </div>
          <!-- 验证状态层 -->
          <div v-if="verifyState" class="verify-overlay" :data-state="verifyState" role="status">
            <template v-if="verifyState === 'checking'">
              <span class="verify-scan" aria-hidden="true" />
              <strong>正在核对账号信息…</strong>
            </template>
            <template v-else-if="verifyState === 'ok'">
              <span class="verify-mark ok" aria-hidden="true">✓</span>
              <strong>验证通过，正在进入…</strong>
            </template>
            <template v-else>
              <span class="verify-mark fail" aria-hidden="true">✕</span>
              <strong>没有通过，请检查后重试</strong>
            </template>
          </div>
        </div>
      </div>

      <div v-if="!cardOut" class="badge-cta">
        <button type="button" class="landing-action primary-action" @click="openCard">
          {{ registering ? '注册账号' : '登录' }}
        </button>
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          受保护的企业级管理系统 · 工牌可拖动把玩
        </div>
      </div>
    </main>

    <!-- 背景模糊层：递卡时整页退后，工牌与表单保持清晰 -->
    <div v-if="cardOut" class="login-veil" aria-hidden="true" />
  </div>
</template>

<style scoped>
.login-access { position: relative; padding: 0; }
.login-access.veiled { z-index: 50; }
.badge-stage { position: absolute; inset: 0; overflow: hidden; }
.badge-cta {
  position: absolute;
  left: 50%;
  bottom: clamp(20px, 5vh, 48px);
  z-index: 10;
  display: grid;
  width: min(320px, 80%);
  transform: translateX(-50%);
  gap: 4px;
}
.landing-action { width: 100%; min-height: 52px; font-size: 16px; }
.badge-cta .auth-switch { margin-top: 10px; }

/* 背景模糊：左边文字不消失，退后变虚 */
.login-veil {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(245, 243, 236, 0.55);
  backdrop-filter: blur(14px) saturate(1.05);
  -webkit-backdrop-filter: blur(14px) saturate(1.05);
  animation: veil-in 0.3s ease-out both;
}
@keyframes veil-in { from { opacity: 0; } to { opacity: 1; } }

/* 贴上卡面的 DOM 表单层：透明底，3D 卡面透出来 */
.face-layer {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  transform-origin: 0 0;
  animation: face-in 0.35s var(--ease-out) both;
}
@keyframes face-in { from { opacity: 0; } to { opacity: 1; } }
.face-scroll {
  position: absolute;
  inset: 0;
  padding: 38% 11% 7%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-width: none;
}
.face-scroll::-webkit-scrollbar { display: none; }
.face-close {
  position: absolute;
  top: 13%;
  right: 9%;
  z-index: 3;
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

/* 验证状态层 */
.verify-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 14px;
  background: rgba(251, 250, 246, 0.86);
  backdrop-filter: blur(2px);
  font-size: 15px;
  animation: face-in 0.25s ease-out both;
}
.verify-scan {
  position: absolute;
  top: 30%;
  left: 8%;
  right: 8%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--clay), transparent);
  animation: verify-scan 1.1s ease-in-out infinite;
}
@keyframes verify-scan { 0%, 100% { transform: translateY(0); opacity: 0.9; } 50% { transform: translateY(220px); opacity: 0.5; } }
.verify-mark {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  font-size: 26px;
  color: #fff;
  animation: mark-pop 0.4s var(--spring) both;
}
.verify-mark.ok { background: #2f7d4f; }
.verify-mark.fail { background: #b4402e; }
@keyframes mark-pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
/* 失败：整卡抖动 */
.face-layer[data-verify='fail'] .face-scroll { animation: face-shake 0.5s var(--ease-out); }
@keyframes face-shake {
  20% { transform: translateX(-9px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(4px); }
}

.login-access input:not([type=checkbox]) { min-height:44px; box-sizing:border-box; padding:10px 12px; font:inherit }
.auth-modes { display:flex; gap:2px; padding:3px; border-radius:12px; background:var(--paper-deep) }
.auth-modes button { flex:1; min-height:38px; border:0; border-radius:9px; background:transparent; color:var(--ink-soft); font-size:13.5px; transition:background .2s, color .2s }
.auth-modes button[aria-pressed=true] { background:var(--white); color:var(--ink); font-weight:600; box-shadow:0 1px 3px rgba(20,20,19,.1) }
.legacy-login-switch { justify-self:start; padding:2px 0; border:0; background:none; color:var(--ink-soft); font-size:13px; text-decoration:underline; text-underline-offset:3px }
.legacy-login-switch:hover { color:var(--ink) }
.sms-code-row { display:flex; gap:8px }
.sms-code-row input { width:0; flex:1; min-width:0 }
.sms-code-row button { flex-shrink:0; padding:8px }
.agreement-consent { display:flex; align-items:center; gap:5px; flex-wrap:wrap; font-size:13px }
.agreement-consent input { width:16px; min-height:16px }
.invitation-note { margin-top:20px;padding:16px;border:1px solid var(--line);border-radius:8px;background:var(--paper);line-height:1.6 }
.invitation-note p { margin:8px 0 }
.invitation-note [role=alert] { color:#b4402e }
.auth-switch { margin-top: 20px; text-align: center; font-size: 14px; }
.auth-switch a { color: var(--ink); font-weight: 600; text-decoration: underline; }
.auth-success { padding: 12px; margin-top: 20px; background: #e3efe5; color: #2f7d4f; border-radius: 4px; }

@media (prefers-reduced-motion: reduce) {
  .login-veil, .face-layer, .verify-overlay, .verify-mark { animation-duration: 0.01ms !important; }
  .verify-scan, .face-layer[data-verify='fail'] .face-scroll { animation: none !important; }
}
</style>
