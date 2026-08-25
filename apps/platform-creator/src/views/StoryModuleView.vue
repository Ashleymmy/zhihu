<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { StoryItem, StoryItemType } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

/** 每个模块的文案与字段配置，由路由 meta.storyModule 指定 */
interface ModuleConfig { type: StoryItemType; index: string; title: string; desc: string; action: string; urlLabel?: string; noteLabel: string; notePlaceholder: string }

const DEFAULT_MODULE: ModuleConfig = { type: 'salt_pick', index: '04', title: '盐选榜单', desc: '沉淀值得反复使用的盐选内容，记录选题、表现与复用价值。', action: '收录内容', urlLabel: '内容链接', noteLabel: '选题与场景', notePlaceholder: '主题、适用场景、转化表现' }

const MODULES: Record<string, ModuleConfig> = {
  salt: DEFAULT_MODULE,
  comments: { type: 'comment_watch', index: '05', title: '评论截流', desc: '登记需要监控评论区的问题或回答，跟踪截流动作与结果。', action: '添加监控', urlLabel: '问题/回答链接', noteLabel: '监控重点', notePlaceholder: '截流话术方向、竞品动态等' },
  risk: { type: 'risk_report', index: '06', title: '风险举报', desc: '汇总需要处理的风险内容与举报事项，避免小问题扩大。', action: '登记风险', urlLabel: '风险内容链接', noteLabel: '风险说明', notePlaceholder: '风险类型、涉及账号、建议动作' },
  media: { type: 'media', index: '07', title: '有声书 / 漫画', desc: '管理有声书与漫画推广内容，跟踪上下架与授权状态。', action: '登记内容', urlLabel: '内容链接', noteLabel: '内容说明', notePlaceholder: '类型、授权状态、推广周期' },
  tags: { type: 'tag', index: '08', title: '内容标签', desc: '按主题与场景整理内容标签，让选题和投放从更清晰的词汇开始。', action: '新建标签', noteLabel: '适用场景', notePlaceholder: '适用的内容方向或计划类型' },
  products: { type: 'product', index: '09', title: '产品库', desc: '维护推广产品的档案，记录结算方式与转化要求。', action: '登记产品', urlLabel: '产品链接', noteLabel: '产品说明', notePlaceholder: '结算方式、转化目标、注意事项' },
  assets: { type: 'asset', index: '10', title: '素材库', desc: '为图片、文案和视觉物料建立结构化档案，方便检索复用。', action: '登记素材', urlLabel: '素材地址', noteLabel: '素材说明', notePlaceholder: '使用场景、版本、可用状态' },
}

const route = useRoute()
const auth = useAuthStore()
const moduleKey = computed(() => String(route.meta.storyModule ?? 'salt'))
const config = computed(() => MODULES[moduleKey.value] ?? DEFAULT_MODULE)

const items = ref<StoryItem[]>([])
const loading = ref(true)
const error = ref('')
const showCreate = ref(false)
const creating = ref(false)
const form = ref({ title: '', url: '', note: '' })

async function load() {
  loading.value = true
  error.value = ''
  try { items.value = await apis.story.listItems(config.value.type) }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function submitCreate() {
  if (!form.value.title.trim()) { error.value = '请填写名称'; return }
  creating.value = true
  try {
    await apis.story.createItem({
      type: config.value.type,
      title: form.value.title.trim(),
      url: form.value.url.trim() || null,
      note: form.value.note.trim() || null,
    })
    showCreate.value = false
    form.value = { title: '', url: '', note: '' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { creating.value = false }
}

async function archive(item: StoryItem) {
  try { await apis.story.updateItem(item.id, { status: 'archived' }); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

async function remove(item: StoryItem) {
  if (!confirm(`确定删除「${item.title}」？此操作不可恢复。`)) return
  try { await apis.story.deleteItem(item.id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

watch(moduleKey, () => { form.value = { title: '', url: '', note: '' }; load() })
onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/zhihu-story" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">{{ config.index }} / {{ config.title }}</p>
        <h1>{{ config.title }}</h1>
        <p>{{ config.desc }}</p>
      </div>
      <button class="primary-action" @click="showCreate = true">{{ config.action }}</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">{{ config.title }}列表</span>
        <span class="toolbar-count">{{ items.length }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!items.length" class="empty-panel"><span>还没有内容。点击「{{ config.action }}」开始。</span></div>
      <div v-else class="queue-list">
        <div v-for="item in items" :key="item.id" class="campaign-row">
          <div>
            <strong>{{ item.title }}</strong>
            <small>{{ item.note || '—' }}</small>
          </div>
          <a v-if="item.url" :href="item.url" target="_blank" class="row-action" style="text-decoration: none;">查看链接</a>
          <small style="color: var(--ink-soft); font-size: 12px;">{{ item.ownerName ?? '' }} · {{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}</small>
          <button v-if="item.ownerId === auth.user?.id || auth.user?.role === 'admin'" class="row-action" @click="archive(item)">归档</button>
          <button v-if="item.ownerId === auth.user?.id || auth.user?.role === 'admin'" class="row-action danger" @click="remove(item)">删除</button>
        </div>
      </div>
    </article>

    <Teleport to="body">
      <div v-if="showCreate" class="dialog-overlay" @click.self="showCreate = false">
        <div class="dialog-card" style="width: min(480px, 92vw);">
          <div class="dialog-header">
            <h3>{{ config.action }}</h3>
            <button type="button" class="dialog-close" @click="showCreate = false">×</button>
          </div>
          <div class="dialog-body">
            <div class="form-field">
              <label>名称</label>
              <input v-model="form.title" maxlength="255" />
            </div>
            <div v-if="config.urlLabel" class="form-field">
              <label>{{ config.urlLabel }}（可选）</label>
              <input v-model="form.url" type="url" placeholder="https://" />
            </div>
            <div class="form-field">
              <label>{{ config.noteLabel }}（可选）</label>
              <textarea v-model="form.note" maxlength="500" :placeholder="config.notePlaceholder"></textarea>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="ghost-aurora" @click="showCreate = false">取消</button>
            <button class="primary-action" :disabled="creating" @click="submitCreate">{{ creating ? '提交中...' : '确认' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
