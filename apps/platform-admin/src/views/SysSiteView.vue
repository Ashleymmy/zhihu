<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SiteInfo } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const info = ref<SiteInfo | null>(null)
const loading = ref(true)
const error = ref('')
const message = ref('')

const minAmount = ref('')
const saving = ref(false)

function fmtUptime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    info.value = await apis.adminTools.siteInfo()
    // 项目列表不含 configJson，当前值从提现校验逻辑同源处不可读，输入框留空表示“保持现状”
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function saveMinAmount() {
  const value = Number(minAmount.value)
  if (!minAmount.value || !Number.isFinite(value) || value < 0) { error.value = '请输入非负数字'; return }
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const projects = await apis.projects.list()
    const zhihu = projects.find((p: any) => p.slug === 'zhihu')
    if (!zhihu) throw new Error('未找到知乎项目')
    // configJson 当前仅承载 withdrawalMinAmount，整体替换安全
    await apis.projects.update(zhihu.id, { configJson: { withdrawalMinAmount: value } })
    message.value = `最低提现金额已更新为 ${value} 元。`
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/system" class="back-link">← 返回系统工具</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">05 / 站点维护</p>
        <h1>站点维护</h1>
        <p>运行时信息与平台级结算参数。</p>
      </div>
      <button class="row-action" @click="load">刷新</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>
    <div v-if="message" style="padding: 12px 16px; border: 1px solid var(--moss); border-radius: var(--radius); background: #e6ebe7; font-size: 13px; color: var(--moss);">{{ message }}</div>

    <section class="workspace-grid">
      <div class="min-w-0">
        <article class="panel" style="padding: 22px;">
          <p class="section-index quiet">02 / 运行时</p>
          <div class="info-grid">
            <div class="info-item"><span>Node 版本</span><strong>{{ info?.node ?? '—' }}</strong></div>
            <div class="info-item"><span>运行时长</span><strong>{{ info ? fmtUptime(info.uptimeSec) : '—' }}</strong></div>
            <div class="info-item"><span>知乎 API</span><strong style="font-family: var(--font-mono); font-size: 13px;">{{ info?.zhihuApiBase ?? '—' }}</strong></div>
            <div class="info-item">
              <span>凭证模式</span>
              <span :class="['status-badge', info?.zhihuCredentialMode === 'real' ? 'active' : 'ended']">{{ info?.zhihuCredentialMode === 'real' ? '真实凭证' : 'Mock' }}</span>
            </div>
          </div>
        </article>
      </div>

      <aside class="workspace-rail">
        <p class="section-index quiet">03 / 结算参数</p>
        <h2 class="workspace-title" style="font-size: 22px;">提现规则</h2>
        <div class="rail-form">
          <label>最低提现金额（元）</label>
          <input v-model="minAmount" type="number" min="0" step="0.01" />
          <small style="color: var(--ink-soft); font-size: 12px;">达人/团长发起提现的最低金额门槛，保存在项目配置中。</small>
          <button class="primary-action" :disabled="saving" @click="saveMinAmount">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.info-grid { display: grid; gap: 0; margin-top: 12px; }
.info-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); }
.info-item:last-child { border-bottom: 0; }
.info-item span { color: #737a80; font-size: 13px; }
.info-item strong { font-size: 12px; font-weight: 500; }
.rail-form { display: grid; gap: 10px; }
.rail-form label { color: var(--ink-soft); font-size: 13px; font-weight: 600; }
</style>
