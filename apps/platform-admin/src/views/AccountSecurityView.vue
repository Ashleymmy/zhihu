<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apis, useAuthStore } from '../stores/auth'
const auth = useAuthStore(), router = useRouter()
const oldPassword=ref(''),newPassword=ref(''),confirmation=ref(''),busy=ref(false),error=ref('')
async function submit(){
  if(busy.value)return
  error.value=''
  if(newPassword.value!==confirmation.value){error.value='两次输入的新密码不一致';return}
  if(new TextEncoder().encode(newPassword.value).length>72){error.value='密码不能超过 72 个字节';return}
  busy.value=true
  try{
    await apis.auth.changePassword({oldPassword:oldPassword.value,newPassword:newPassword.value})
    await auth.logout()
    await router.replace({name:'login',query:{passwordChanged:'1'}})
  }catch(e:any){error.value=e?.message||'修改失败，请重试'}finally{busy.value=false}
}
</script>
<template><section class="page-stack"><header class="page-header"><h1>账号安全</h1></header><form class="security-form panel" @submit.prevent="submit">
  <p v-if="auth.user?.mustChangePwd">当前使用临时密码，请先设置你自己的密码。</p>
  <p>修改密码后，所有设备上的登录都会失效。</p><p v-if="error" role="alert" class="error">{{error}}</p>
  <label>原密码<input v-model="oldPassword" type="password" autocomplete="current-password" required maxlength="128" /></label>
  <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="72" /></label>
  <label>确认新密码<input v-model="confirmation" type="password" autocomplete="new-password" required minlength="8" maxlength="72" /></label>
  <button class="primary-action" :disabled="busy">{{busy?'正在保存…':'修改密码并重新登录'}}</button>
</form></section></template>
<style scoped>.security-form{max-width:520px;padding:24px;display:grid;gap:20px}.security-form label{display:grid;gap:8px}.security-form input{min-height:44px;padding:10px;border:1px solid var(--line,#ccc);border-radius:8px;background:var(--paper,#fff);color:inherit}.security-form p{margin:0;line-height:1.6}.error{color:#a02f39}</style>
