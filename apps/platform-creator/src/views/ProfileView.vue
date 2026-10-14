<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { MeResp } from '@zhihu-koc/shared-contracts/core'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const profile = ref<MeResp | null>(null)
const loading = ref(true)
const error = ref('')

const roleLabels: Record<string, string> = { admin: '管理员', leader: '团长', creator: '达人' }

async function load() {
  loading.value = true
  try { profile.value = await apis.auth.me() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
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
            <div class="profile-item"><span>用户 ID</span><strong>{{ profile.userId || 'TIMO-' + profile.id }}</strong></div>
            <div class="profile-item"><span>登录账号</span><strong>{{ profile.username }}</strong></div>
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
        <h2 class="workspace-title" style="font-size:22px">登录与安全</h2>
        <p>管理登录密码与手机号验证。</p>
        <router-link class="primary-action" to="/account/security">{{profile?.hasPassword === false ? '设置登录密码' : '账号安全'}}</router-link>
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
