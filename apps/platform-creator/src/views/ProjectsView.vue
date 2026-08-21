<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Project } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const projects = ref<Project[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)
const form = ref({ name: '', slug: '', apiBaseUrl: '', signMethod: 'hmac_sha256' as const })
const creating = ref(false)
const selected = ref<Project | null>(null)
const members = ref<any[]>([])
const courses = ref<any[]>([])

async function load() {
  loading.value = true
  error.value = ''
  try {
    projects.value = await apis.projects.list()
    const first = projects.value[0]
    if (first && !selected.value) await selectProject(first)
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function selectProject(p: Project) {
  selected.value = p
  try {
    const [m, c] = await Promise.all([
      apis.projects.listMembers(p.id),
      apis.projects.listCourses(p.id),
    ])
    members.value = m
    courses.value = c
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

async function createProject() {
  if (!form.value.name.trim() || !form.value.slug.trim() || !form.value.apiBaseUrl.trim()) return
  creating.value = true
  try {
    await apis.projects.create(form.value)
    showCreate.value = false
    form.value = { name: '', slug: '', apiBaseUrl: '', signMethod: 'hmac_sha256' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { creating.value = false }
}

async function deleteProject(id: string) {
  if (!confirm('确定要禁用此项目？')) return
  try { await apis.projects.disable(id); selected.value = null; await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">PROJECTS / MANAGEMENT</p>
        <h1>项目管理</h1>
      </div>
      <button class="primary-action" @click="showCreate = true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        创建项目
      </button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <div style="display: grid; grid-template-columns: 240px 1fr; gap: 20px; align-items: start;">
      <aside style="display: flex; flex-direction: column; gap: 10px;">
        <div v-if="!loading && !projects.length" style="color: var(--ink-soft); font-size: 12px; padding: 20px;">暂无项目</div>
        <button v-for="p in projects" :key="p.id" type="button" :style="{ padding: '12px 14px', border: `1px solid ${selected?.id === p.id ? 'var(--forest)' : 'var(--line)'}`, borderRadius: 'var(--radius)', background: selected?.id === p.id ? 'var(--paper)' : 'var(--white)', textAlign: 'left', cursor: 'pointer', fontSize: '12px' }" @click="selectProject(p)">
          <div style="font-weight: 600;">{{ p.name }}</div>
          <div style="font-family: var(--font-mono); font-size: 10px; color: var(--ink-soft);">{{ p.slug }}</div>
        </button>
      </aside>

      <div v-if="selected" style="display: flex; flex-direction: column; gap: 20px;">
        <article class="panel" style="padding: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2 style="margin: 0; font-size: 18px;">{{ selected.name }} <small style="font-weight: normal; color: var(--ink-soft); font-size: 11px; font-family: var(--font-mono);">{{ selected.slug }}</small></h2>
            <button class="row-action danger" @click="deleteProject(selected.id)">禁用项目</button>
          </div>
          <div style="font-size: 11px; color: var(--ink-soft);">状态：<span :class="['status-badge', selected.isEnabled ? 'active' : 'ended']">{{ selected.isEnabled ? '启用' : '已禁用' }}</span></div>
        </article>

        <article class="panel" style="padding: 20px;">
          <h2 style="margin: 0 0 14px; font-size: 16px;">成员（{{ members.length }}）</h2>
          <div v-if="!members.length" style="color: var(--ink-soft); font-size: 12px;">暂无成员</div>
          <div v-for="m in members" :key="m.userId" style="display: flex; justify-content: space-between; padding: 10px 0; border-top: 1px solid var(--paper-deep); font-size: 12px;">
            <span>{{ m.displayName ?? m.username ?? m.userId }}</span>
            <span class="status-badge draft">{{ m.memberRole }}</span>
          </div>
        </article>

        <article class="panel" style="padding: 20px;">
          <h2 style="margin: 0 0 14px; font-size: 16px;">课程（{{ courses.length }}）</h2>
          <div v-if="!courses.length" style="color: var(--ink-soft); font-size: 12px;">暂无课程</div>
          <div v-for="c in courses" :key="c.id" style="display: flex; justify-content: space-between; padding: 10px 0; border-top: 1px solid var(--paper-deep); font-size: 12px;">
            <span>{{ c.courseName }}</span>
            <a v-if="c.courseUrl" :href="c.courseUrl" target="_blank" style="color: var(--forest); font-size: 10px;">查看</a>
          </div>
        </article>
      </div>
      <div v-else-if="projects.length" style="color: var(--ink-soft); font-size: 12px; padding: 40px; text-align: center;">选择一个项目查看详情</div>
    </div>

    <!-- 创建对话框 -->
    <Teleport to="body">
      <div v-if="showCreate" style="position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; background: rgba(33, 33, 33, 0.4); backdrop-filter: blur(2px);" @click.self="showCreate = false">
        <div style="width: min(480px, 90vw); padding: 28px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--white); box-shadow: var(--shadow-float);">
          <h2 style="margin: 0 0 20px; font-family: var(--font-display); font-size: 22px;">创建项目</h2>
          <form class="form-grid" @submit.prevent="createProject" style="gap: 16px;">
            <div><label>项目名称</label><input v-model="form.name" required maxlength="64" /></div>
            <div><label>Slug</label><input v-model="form.slug" required maxlength="32" pattern="[a-z0-9-]+" /></div>
            <div class="full-span"><label>API Base URL</label><input v-model="form.apiBaseUrl" required type="url" maxlength="255" /></div>
            <div>
              <label>签名方式</label>
              <select v-model="form.signMethod"><option value="hmac_sha256">HMAC SHA256</option><option value="oauth2">OAuth2</option></select>
            </div>
            <div class="form-submit" style="display: flex; gap: 10px; margin-top: 8px;">
              <button type="submit" class="primary-action" :disabled="creating" style="flex: 1;">{{ creating ? '创建中...' : '确认创建' }}</button>
              <button type="button" class="ghost-aurora" @click="showCreate = false">取消</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
