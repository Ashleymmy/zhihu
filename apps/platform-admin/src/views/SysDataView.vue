<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SiteInfo } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const info = ref<SiteInfo | null>(null)
const syncing = ref('')
const message = ref('')
const error = ref('')

function fmt(value: string | null) {
  if (!value) return '从未同步'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function load() {
  try { info.value = await apis.adminTools.siteInfo() } catch (e: any) { error.value = e?.message ?? String(e) }
}

async function trigger(kind: 'channels' | 'tasks' | 'metrics' | 'planStatus' | 'compositionStatus') {
  syncing.value = kind
  message.value = ''
  error.value = ''
  try {
    if (kind === 'channels') await apis.channels.sync()
    else if (kind === 'tasks') await apis.story.syncTasks()
    else if (kind === 'metrics') await apis.metrics.sync()
    else if (kind === 'planStatus') {
      // 调用推广计划审核状态同步
      await fetch('/api/v1/admin-tools/sync-plan-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }
      })
    }
    else if (kind === 'compositionStatus') {
      // 调用作品审核状态同步
      await fetch('/api/v1/admin-tools/sync-composition-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }
      })
    }
    message.value = '同步任务已入队，稍后自动刷新。'
    setTimeout(load, 6000)
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { syncing.value = '' }
}

async function exportEarnings() {
  try {
    const data = await apis.earnings.list({ page: 1, pageSize: 1000 })
    const header = '结算日期,关键词,渠道,金额(分),状态\n'
    const lines = data.list.map((e: any) =>
      `${e.settleDate},${e.keyword ?? ''},${e.channelName ?? ''},${e.amount},${e.status}`,
    )
    const blob = new Blob(['﻿' + header + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `earnings-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/system" class="back-link">← 返回系统工具</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">01 / 数据处理与授权</p>
        <h1>数据处理与授权</h1>
        <p>知乎开放平台的接口授权状态、数据同步与导出。</p>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>
    <div v-if="message" style="padding: 12px 16px; border: 1px solid var(--moss); border-radius: var(--radius); background: #e6ebe7; font-size: 13px; color: var(--moss);">{{ message }}</div>

    <section class="workspace-grid">
      <div class="min-w-0">
        <article class="panel" style="padding: 22px;">
          <p class="section-index quiet">02 / 数据同步</p>
          <div class="sync-list">
            <div class="sync-row">
              <div><strong>渠道目录</strong><small>上次同步：{{ fmt(info?.sync.channels ?? null) }}</small></div>
              <button class="row-action" :disabled="!!syncing" @click="trigger('channels')">{{ syncing === 'channels' ? '入队中...' : '立即同步' }}</button>
            </div>
            <div class="sync-row">
              <div><strong>推广任务</strong><small>上次同步：{{ fmt(info?.sync.tasks ?? null) }}</small></div>
              <button class="row-action" :disabled="!!syncing" @click="trigger('tasks')">{{ syncing === 'tasks' ? '入队中...' : '立即同步' }}</button>
            </div>
            <div class="sync-row">
              <div><strong>运营指标</strong><small>上次同步：{{ fmt(info?.sync.metrics ?? null) }}</small></div>
              <button class="row-action" :disabled="!!syncing" @click="trigger('metrics')">{{ syncing === 'metrics' ? '入队中...' : '立即同步' }}</button>
            </div>
            <div class="sync-row">
              <div><strong>推广计划审核状态</strong><small>从知乎拉取计划的审核状态与拒绝原因</small></div>
              <button class="row-action" :disabled="!!syncing" @click="trigger('planStatus')">{{ syncing === 'planStatus' ? '入队中...' : '立即同步' }}</button>
            </div>
            <div class="sync-row">
              <div><strong>作品审核状态</strong><small>从知乎拉取作品的审核状态与拒绝原因</small></div>
              <button class="row-action" :disabled="!!syncing" @click="trigger('compositionStatus')">{{ syncing === 'compositionStatus' ? '入队中...' : '立即同步' }}</button>
            </div>
          </div>
        </article>
      </div>

      <aside class="workspace-rail">
        <p class="section-index quiet">03 / 授权与导出</p>
        <h2 class="workspace-title" style="font-size: 22px;">接口授权</h2>
        <div class="auth-card">
          <p><span>知乎 OpenAPI</span><strong>{{ info?.zhihuApiBase || '—' }}</strong></p>
          <p><span>凭证模式</span>
            <span :class="['status-badge', info?.zhihuCredentialMode === 'real' ? 'active' : 'ended']">{{ info?.zhihuCredentialMode === 'real' ? '真实凭证' : 'Mock' }}</span>
          </p>
          <p><span>运行环境</span><strong style="font-family: var(--font-mono); font-size: 13px;">Node {{ info?.node ?? '—' }}</strong></p>
        </div>
        <button class="row-action" style="margin-top: 14px;" @click="exportEarnings">导出收益明细 CSV</button>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.sync-list { display: grid; margin-top: 12px; }
.sync-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--line); }
.sync-row:last-child { border-bottom: 0; }
.sync-row div { display: grid; gap: 3px; }
.sync-row strong { font-size: 13px; }
.sync-row small { color: var(--ink-soft); font-family: var(--font-mono); font-size: 12px; }
.auth-card { display: grid; gap: 12px; padding: 16px 0; border-top: 1px solid var(--line); }
.auth-card p { display: flex; align-items: center; justify-content: space-between; margin: 0; }
.auth-card span { color: #737a80; font-size: 13px; }
.auth-card strong { font-size: 12px; font-weight: 500; }
</style>
