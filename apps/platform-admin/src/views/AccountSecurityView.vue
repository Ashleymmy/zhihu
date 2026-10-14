<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { apis, useAuthStore } from '../stores/auth'
const auth = useAuthStore(), router = useRouter()
const initial = computed(() => auth.user?.hasPassword === false)
const oldPassword=ref(''),newPassword=ref(''),confirmation=ref(''),busy=ref(false),error=ref('')
const phone=ref(auth.user?.phone || ''),phonePassword=ref(''),smsCode=ref(''),phoneError=ref(''),phoneNotice=ref(''),phoneBusy=ref(false),sending=ref(false),cooldown=ref(0),smsEnabled=ref(false)
let retryAt=0, timer:ReturnType<typeof setInterval>|undefined
onMounted(async()=>{try{smsEnabled.value=(await apis.auth.smsPolicy()).smsLoginEnabled}catch{phoneError.value='短信服务暂不可用，请稍后刷新重试'}})
onUnmounted(()=>clearInterval(timer))
async function later(){if(!auth.user || busy.value)return;localStorage.setItem('timo-password-later-'+auth.user.id,'1');await router.replace('/')}
async function submit(){
  if(busy.value)return
  error.value=''
  if(newPassword.value!==confirmation.value){error.value='两次输入的新密码不一致';return}
  if(!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,16}$/.test(newPassword.value)){error.value='密码须为 8–16 位，包含字母和数字，不支持空格或符号';return}
  busy.value=true
  try{
    if(initial.value) await apis.auth.setPassword(newPassword.value)
    else await apis.auth.changePassword({oldPassword:oldPassword.value,newPassword:newPassword.value})
    // Password changes already revoke every server session; avoid a second unauthorized request.
    auth.clearSession()
    await router.replace({name:'login',query:{passwordChanged:'1'}})
  }catch(e:any){error.value=e?.message||'保存失败，请重试'}finally{busy.value=false}
}
function validPhone(){
  phoneError.value=''
  if(!/^1\d{10}$/.test(phone.value) || !phonePassword.value){phoneError.value='请输入手机号和当前登录密码';return false}
  return true
}
async function sendCode(){
  if(sending.value||phoneBusy.value||cooldown.value||!validPhone())return
  sending.value=true;smsCode.value='';phoneNotice.value=''
  try{
    const result=await apis.auth.sendPhoneCode(phone.value,phonePassword.value)
    retryAt=Date.now()+Math.max(60,result.retryAfterSeconds||60)*1000
    const tick=()=>{cooldown.value=Math.max(0,Math.ceil((retryAt-Date.now())/1000));if(!cooldown.value)clearInterval(timer)}
    clearInterval(timer);tick();timer=setInterval(tick,1000);phoneNotice.value='验证码已发送，5 分钟内有效'
  }catch(e:any){phoneError.value=e.message||'发送失败，请重试'}finally{sending.value=false}
}
async function verifyPhone(){
  if(phoneBusy.value||sending.value||!validPhone())return
  if(!/^\d{6}$/.test(smsCode.value)){phoneError.value='请输入 6 位验证码';return}
  phoneBusy.value=true
  try{await apis.auth.verifyPhone(phone.value,phonePassword.value,smsCode.value);await auth.validateSession();phonePassword.value='';smsCode.value='';phoneNotice.value='手机号已验证，可使用验证码登录'}
  catch(e:any){phoneError.value=e.message||'验证失败，请重试'}finally{phoneBusy.value=false}
}
</script>
<template><section class="page-stack"><header class="page-header"><div><h1>账号安全</h1><p>用户 ID：{{auth.user?.userId || '—'}}</p></div></header>
<form class="security-form panel" @submit.prevent="submit">
  <h2>{{initial?'设置登录密码':'修改登录密码'}}</h2>
  <p v-if="initial">设置后可使用用户 ID 和密码登录。也可以稍后设置，继续使用手机验证码登录。</p>
  <p v-else-if="auth.user?.mustChangePwd">当前使用临时密码，请先设置你自己的密码。</p>
  <p>密码为 8–16 位，需包含字母和数字，不强制大小写。保存后需重新登录。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <label v-if="!initial">原密码<input v-model="oldPassword" type="password" autocomplete="current-password" required maxlength="128" /></label>
  <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="16" /></label>
  <label>确认新密码<input v-model="confirmation" type="password" autocomplete="new-password" required minlength="8" maxlength="16" /></label>
  <button class="primary-action" :disabled="busy">{{busy?'正在保存…':'保存密码并重新登录'}}</button>
  <button v-if="initial" type="button" :disabled="busy" @click="later">稍后设置</button>
</form>
<details class="security-form panel" :open="!auth.user?.phoneVerifiedAt && !initial"><summary>手机号验证 · {{auth.user?.phoneVerifiedAt?'已验证':'去验证'}}</summary>
  <p v-if="auth.user?.phoneVerifiedAt">{{auth.user.phone}} 已通过验证，可使用短信验证码登录。</p>
  <form v-else-if="smsEnabled" class="phone-form" @submit.prevent="verifyPhone">
    <p>旧账号验证手机号后，可使用验证码登录，原账号密码仍然有效。</p>
    <label>手机号<input v-model.trim="phone" type="tel" maxlength="11" :disabled="!!auth.user?.phone || sending || phoneBusy" required /></label>
    <label>当前密码<input v-model="phonePassword" type="password" autocomplete="current-password" required maxlength="128" /></label>
    <div class="code-row"><input v-model.trim="smsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" required /><button type="button" :disabled="sending || phoneBusy || cooldown>0" @click="sendCode">{{cooldown>0?cooldown+' 秒后重发':'获取验证码'}}</button></div>
    <small>发送时向阿里云短信服务及通信运营商提供接收手机号和验证码，仅用于本次验证。</small>
    <button :disabled="phoneBusy || sending">确认验证手机号</button>
  </form>
  <p v-else>短信验证暂不可用，请稍后刷新重试。</p>
  <p v-if="phoneError" role="alert" class="error">{{phoneError}}</p><p v-if="phoneNotice" role="status">{{phoneNotice}}</p>
</details>
</section></template>
<style scoped>
.security-form{max-width:520px;padding:24px;display:grid;gap:20px}.security-form label,.phone-form{display:grid;gap:8px}.phone-form{gap:16px}.security-form input{min-height:44px;min-width:0;box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--line,#ccc);border-radius:8px;background:var(--paper,#fff);color:inherit}.security-form p,.security-form h2{margin:0;line-height:1.6}.error{color:#a02f39}.code-row{display:flex;gap:8px}.code-row input{flex:1;width:0}.code-row button{flex-shrink:0}.security-form summary{cursor:pointer}
</style>
