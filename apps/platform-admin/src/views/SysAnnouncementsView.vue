<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Announcement } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const announcements = ref<Announcement[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)
const creating = ref(false)
const form = ref({ title: '', content: '' })

async function load() {
  loading.value = true
  try { announcements.value = await apis.announcements.list() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function submit() {
  if (!form.value.title.trim() || !form.value.content.trim()) { error.value = '请填写标题和内容'; return }
  creating.value = true
  try {
    await apis.announcements.create({ title: form.value.title.trim(), content: form.value.content.trim() })
    showCreate.value = false
    form.value = { title: '', content: '' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { creating.value = false }
}

async function toggle(a: Announcement) {
  try {
    await apis.announcements.setStatus(a.id, a.status === 'published' ? 'offline' : 'published')
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/system" class="back-link">← 返回系统工具</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">04 / 系统公告</p>
        <h1>系统公告</h1>
        <p>发布公告后，三端用户登录时会在工作台顶部看到。</p>
      </div>
      <button class="primary-action" @click="showCreate = true">发布公告</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">公告列表</span>
        <span class="toolbar-count">{{ announcements.length }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!announcements.length" class="empty-panel"><span>还没有公告。点击「发布公告」开始。</span></div>
      <div v-else class="queue-list">
        <div v-for="a in announcements" :key="a.id" class="campaign-row" style="align-items: flex-start; padding: 14px 22px;">
          <div>
            <strong>{{ a.title }}</strong>
            <small style="white-space: normal;">{{ a.content }}</small>
            <small style="margin-top: 4px; color: #9a9d9e;">{{ a.createdByName ?? '' }} · {{ new Date(a.createdAt).toLocaleString('zh-CN') }}</small>
          </div>
          <span :class="['status-badge', a.status === 'published' ? 'active' : 'ended']">{{ a.status === 'published' ? '已发布' : '已下线' }}</span>
          <button class="row-action" @click="toggle(a)">{{ a.status === 'published' ? '下线' : '重新发布' }}</button>
        </div>
      </div>
    </article>

    <Teleport to="body">
      <div v-if="showCreate" class="dialog-overlay" @click.self="showCreate = false">
        <div class="dialog-card" style="width: min(480px, 92vw);">
          <div class="dialog-header">
            <h3>发布公告</h3>
            <button type="button" class="dialog-close" @click="showCreate = false">×</button>
          </div>
          <div class="dialog-body">
            <div class="form-field">
              <label>标题</label>
              <input v-model="form.title" maxlength="128" />
            </div>
            <div class="form-field">
              <label>内容</label>
              <textarea v-model="form.content" rows="4" maxlength="2000"></textarea>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="ghost-aurora" @click="showCreate = false">取消</button>
            <button class="primary-action" :disabled="creating" @click="submit">{{ creating ? '发布中...' : '确认发布' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
