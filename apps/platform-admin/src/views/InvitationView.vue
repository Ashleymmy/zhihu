<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apis, useAuthStore } from '../stores/auth'
const route = useRoute(), auth = useAuthStore()
const token = computed(() => new URLSearchParams(route.hash.slice(1)).get('invite') || '')
const invite = ref<{inviterName:string;teamName:string|null}|null>(null)
const loading = ref(false), busy = ref(false), error = ref(''), joined = ref(false)
const loginTarget = computed(() => ({ name: 'login', query: { redirect: route.fullPath } }))
let version = 0
watch(token, async value => {
  const current = ++version
  invite.value = null; error.value = ''; joined.value = false
  if (!value) { error.value = '邀请链接不完整，请让邀请人重新发送完整链接。'; return }
  loading.value = true
  try { const result = await apis.auth.invitation(value); if(current===version) invite.value = result }
  catch(e:any) { if(current===version) error.value = e.message || '邀请加载失败，请重试' }
  finally { if(current===version) loading.value = false }
}, {immediate:true})
async function join() {
  if(busy.value) return
  busy.value = true; error.value = ''
  try { await apis.team.acceptInvitation(token.value); joined.value = true; await auth.validateSession() }
  catch(e:any) { error.value = e.message || '加入失败，请重试' }
  finally { busy.value = false }
}
</script>
<template>
  <main class="invite-page">
    <section class="panel invite-card">
      <p class="eyebrow">团队邀请</p>
      <h1>{{ joined ? '已加入团队' : '一起开展推广业务' }}</h1>
      <p v-if="loading" role="status">正在加载邀请…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="invite">
        <h2>{{ invite.inviterName }} 邀请你{{ invite.teamName ? '加入团队' : '注册达人账号' }}</h2>
        <p v-if="invite.teamName">团队：{{ invite.teamName }}</p>
        <p>达人可以自行创建或领取关键词、登记作品。加入团队后自动开通团长已有项目。</p>
        <div v-if="!auth.loggedIn" class="invite-actions">
          <router-link class="primary-action" :to="{name:'register',hash:route.hash}">注册并加入</router-link>
          <router-link class="row-action" :to="loginTarget">已有账号，登录后加入</router-link>
        </div>
        <template v-else>
          <p>当前账号：{{ auth.user?.displayName }}（{{ auth.user?.username }}）</p>
          <p v-if="joined" role="status">已加入 {{ invite.teamName }}，可以开始创建关键词。</p>
          <p v-else-if="auth.user?.role !== 'creator'">此邀请供达人加入团队。你可将完整链接发给达人，对方打开后即可使用。</p>
          <p v-else-if="!invite.teamName">你已有达人账号，可以直接进入工作台。</p>
          <div class="invite-actions">
            <button v-if="!joined && auth.user?.role==='creator' && invite.teamName" class="primary-action" :disabled="busy" @click="join">{{busy?'正在加入…':'确认加入团队'}}</button>
            <router-link class="row-action" to="/dashboard">进入工作台</router-link>
          </div>
        </template>
      </template>
    </section>
  </main>
</template>
<style scoped>
.invite-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--paper,#f5f4f0)}
.invite-card{max-width:600px;width:100%;padding:32px;box-sizing:border-box}
.invite-card h1{font-size:28px}.invite-card h2{font-size:20px}.invite-card p{line-height:1.8;overflow-wrap:anywhere}
.invite-actions{display:flex;gap:14px;flex-wrap:wrap;margin-top:24px;align-items:center}.invite-actions a{text-decoration:none}
[role=alert]{color:#964639}
</style>
