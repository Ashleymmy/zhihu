<template>
  <div class="login-page">
    <!-- Left brand panel -->
    <div class="brand-panel">
      <div class="brand-glow" />
      <div class="brand-content">
        <router-link to="/" class="brand-logo">
          <div class="logo-hex"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="12 2 22 8 22 16 12 22 2 16 2 8"/></svg></div>
          <span>OPC <em>Platform</em></span>
        </router-link>
        <h1 class="brand-headline">知乎推广<br><span class="gradient-text">精准触达，高效转化</span></h1>
        <p class="brand-desc">一站式绑词回传 · 词条管理 · 转化归因<br>让每一次推广投入都有迹可查</p>
        <div class="brand-stats">
          <div class="bs-item"><div class="bs-v">50万+</div><div class="bs-l">活跃运营者</div></div>
          <div class="bs-sep"/>
          <div class="bs-item"><div class="bs-v">98.5%</div><div class="bs-l">回传成功率</div></div>
          <div class="bs-sep"/>
          <div class="bs-item"><div class="bs-v">¥2亿+</div><div class="bs-l">累计转化金额</div></div>
        </div>
        <div class="feature-list">
          <div v-for="f in features" :key="f" class="feat-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            {{ f }}
          </div>
        </div>
      </div>
    </div>

    <!-- Right form panel -->
    <div class="form-panel">
      <div class="form-box">
        <div class="form-header">
          <div class="form-tabs">
            <button :class="['f-tab', { active: tab === 'login' }]" @click="tab = 'login'">登录</button>
            <button :class="['f-tab', { active: tab === 'register' }]" @click="tab = 'register'">注册</button>
          </div>
          <div class="form-title">{{ tab === 'login' ? '欢迎回来' : '创建账号' }}</div>
          <div class="form-sub">{{ tab === 'login' ? '登录 OPC 推广运营平台' : '免费注册，立即开始推广' }}</div>
        </div>

        <a-form :model="form" layout="vertical" @finish="handleSubmit">
          <a-form-item label="账号" name="username" :rules="[{ required: true, message: '请输入账号' }]">
            <a-input v-model:value="form.username" size="large" placeholder="请输入用户名" />
          </a-form-item>
          <a-form-item v-if="tab === 'register'" label="真实姓名" name="name">
            <a-input v-model:value="form.name" size="large" placeholder="请输入真实姓名" />
          </a-form-item>
          <a-form-item label="密码" name="password" :rules="[{ required: true, message: '请输入密码' }]">
            <a-input-password v-model:value="form.password" size="large" placeholder="请输入密码" />
          </a-form-item>
          <div v-if="tab === 'login'" class="form-opts"><a class="forgot-link" href="#">忘记密码？</a></div>
          <a-button type="primary" html-type="submit" size="large" block :loading="loading" style="margin-top:8px">
            {{ tab === 'login' ? '立即登录' : '免费注册' }}
          </a-button>
        </a-form>

        <div class="divider"><span>或使用第三方登录</span></div>
        <div class="third-party">
          <button class="tp-btn" v-for="t in ['微信', '抖音', '知乎']" :key="t">{{ t }}</button>
        </div>
        <div class="switch-link">
          {{ tab === 'login' ? '还没有账号？' : '已有账号？' }}
          <a @click="tab = tab === 'login' ? 'register' : 'login'">{{ tab === 'login' ? '免费注册' : '立即登录' }}</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const tab = ref<'login' | 'register'>('login')
const loading = ref(false)
const form = ref({ username: '', password: '', name: '' })
const features = ['多维词条绑定与归因追踪', '实时回传日志与异常告警', '推广计划预算智能管控', '精细化转化数据分析']

const handleSubmit = async () => {
  loading.value = true
  try {
    await auth.login(form.value.username, form.value.password)
    const redirect = route.query.redirect as string | undefined
    const dest = redirect?.startsWith('/dashboard') ? redirect : '/dashboard/overview'
    router.push(dest)
  } catch (err: any) {
    message.error(err.message || '登录失败，请检查账号密码')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page { display: flex; min-height: 100vh; background: var(--color-bg-primary); }
.brand-panel { flex: 1; position: relative; background: var(--color-bg-secondary); border-right: 1px solid var(--color-border); display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 60px 64px; }
.brand-glow { position: absolute; top: -100px; left: -100px; width: 500px; height: 500px; background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%); pointer-events: none; }
.brand-content { position: relative; max-width: 420px; }
.brand-logo { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 48px; }
.brand-logo em { font-style: normal; color: var(--color-accent); }
.logo-hex { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: var(--color-accent); border-radius: 7px; }
.brand-headline { font-family: var(--font-display); font-size: 36px; font-weight: 700; line-height: 1.2; color: var(--color-text-primary); margin-bottom: 16px; }
.brand-desc { font-size: 14px; color: var(--color-text-tertiary); line-height: 1.7; margin-bottom: 36px; }
.brand-stats { display: flex; align-items: center; gap: 20px; margin-bottom: 32px; }
.bs-item { text-align: center; }
.bs-v { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-text-primary); }
.bs-l { font-size: 11px; color: var(--color-text-disabled); margin-top: 3px; }
.bs-sep { width: 1px; height: 32px; background: var(--color-border); }
.feature-list { display: flex; flex-direction: column; gap: 10px; }
.feat-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--color-text-secondary); }
.form-panel { width: 480px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 60px 48px; }
.form-box { width: 100%; max-width: 380px; }
.form-tabs { display: flex; gap: 0; background: var(--color-bg-tertiary); border-radius: var(--radius-md); padding: 3px; margin-bottom: 24px; }
.f-tab { flex: 1; padding: 7px; background: none; border: none; border-radius: var(--radius-sm); font-size: 13.5px; font-weight: 500; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.f-tab.active { background: var(--color-bg-elevated); color: var(--color-text-primary); box-shadow: var(--shadow-sm); }
.form-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.form-sub { font-size: 13px; color: var(--color-text-tertiary); margin-bottom: 28px; }
.form-opts { display: flex; justify-content: flex-end; margin-bottom: 4px; }
.forgot-link { font-size: 12.5px; color: var(--color-accent); }
.forgot-link:hover { opacity: 0.75; }
.divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--color-border); }
.divider span { font-size: 12px; color: var(--color-text-disabled); white-space: nowrap; }
.third-party { display: flex; gap: 8px; margin-bottom: 20px; }
.tp-btn { flex: 1; padding: 8px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-text-secondary); cursor: pointer; transition: all var(--transition-fast); }
.tp-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.switch-link { text-align: center; font-size: 13px; color: var(--color-text-tertiary); }
.switch-link a { color: var(--color-accent); cursor: pointer; }
.switch-link a:hover { opacity: 0.75; }
</style>
