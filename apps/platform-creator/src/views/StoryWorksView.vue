<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Composition, Plan } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const works = ref<Composition[]>([])
const total = ref(0)
const plans = ref<Plan[]>([])
const loading = ref(true)
const error = ref('')
const statusFilter = ref('')

const showCreate = ref(false)
const creating = ref(false)
const MEDIA_TYPES = ['KOC视频号', 'KOC百家号', 'KOC抖音', 'KOC快手', 'KOC微博', 'KOC小红书', 'KOC定向', 'KOC头条号', 'KOC哔哩哔哩', 'KOC公众号']
const TYPE_OPTIONS = [
  { value: 1, label: '图文' },
  { value: 2, label: '视频' },
  { value: 0, label: '其他' },
]
const SUB_TYPES = [
  { value: 11, label: '其他', parent: 0 },
  { value: 1, label: '实拍', parent: 1 },
  { value: 2, label: 'Live 图', parent: 1 },
  { value: 3, label: '截屏', parent: 1 },
  { value: 4, label: '漫画', parent: 1 },
  { value: 5, label: '表情包解说', parent: 2 },
  { value: 6, label: '真人演绎', parent: 2 },
  { value: 7, label: '猫 meme', parent: 2 },
  { value: 8, label: '漫剧', parent: 2 },
  { value: 9, label: '解压', parent: 2 },
  { value: 10, label: '滚屏', parent: 2 },
]
const form = ref({ planId: '', mediaType: 'KOC抖音', mediaAccount: '', compositionType: 1, compositionSubType: 1, title: '', promoUrl: '', releaseTime: '' })

const subTypeOptions = computed(() => SUB_TYPES.filter((s) => s.parent === form.value.compositionType))

const statusLabels: Record<string, string> = { pending: '待审核', active: '已发布', rejected: '已拒绝', ended: '已结束' }
const syncLabels: Record<string, string> = { local: '本地', syncing: '同步中', synced: '已同步', failed: '同步失败' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await apis.story.listWorks({ page: 1, pageSize: 100, status: statusFilter.value || undefined })
    works.value = data.list
    total.value = data.total
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function openCreate() {
  showCreate.value = true
  if (!plans.value.length) {
    try { plans.value = (await apis.plans.list({ page: 1, pageSize: 100 })).list } catch { /* 计划加载失败不阻塞打开 */ }
  }
}

async function submitCreate() {
  if (!form.value.planId || !form.value.mediaAccount.trim() || !form.value.promoUrl.trim() || !form.value.releaseTime) {
    error.value = '请完整填写计划、媒体账号、推广链接和发布时间'
    return
  }
  creating.value = true
  try {
    await apis.story.createWork({
      planId: form.value.planId,
      mediaType: form.value.mediaType,
      mediaAccount: form.value.mediaAccount.trim(),
      compositionType: form.value.compositionType,
      compositionSubType: form.value.compositionSubType,
      title: form.value.title.trim() || null,
      promoUrl: form.value.promoUrl.trim(),
      releaseTime: new Date(form.value.releaseTime).toISOString(),
    })
    showCreate.value = false
    form.value = { planId: '', mediaType: 'KOC抖音', mediaAccount: '', compositionType: 1, compositionSubType: 1, title: '', promoUrl: '', releaseTime: '' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { creating.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/zhihu-story" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">02 / 作品管理</p>
        <h1>推广作品</h1>
        <p>挂在推广计划下的内容与素材作品，跟踪审核与同步状态。</p>
      </div>
      <div class="page-actions">
        <select v-model="statusFilter" @change="load">
          <option value="">全部状态</option>
          <option value="pending">待审核</option>
          <option value="active">已发布</option>
          <option value="rejected">已拒绝</option>
          <option value="ended">已结束</option>
        </select>
        <button class="primary-action" @click="openCreate">登记作品</button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">作品列表</span>
        <span class="toolbar-count">{{ total }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!works.length" class="empty-panel"><span>还没有登记作品。点击「登记作品」开始。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>标题</th><th>所属计划</th><th>媒体账号</th><th>分类</th><th>状态</th><th>同步</th></tr></thead>
          <tbody>
            <tr v-for="w in works" :key="w.id">
              <td><strong>{{ w.title || '未命名作品' }}</strong><br /><a :href="w.promoUrl" target="_blank" style="color: var(--ink-soft); font-size: 12px;">{{ w.promoUrl.slice(0, 48) }}</a></td>
              <td style="font-size: 13px;">{{ w.keyword ?? '—' }}</td>
              <td style="font-size: 13px;">{{ w.mediaType }}<br /><small style="color: var(--ink-soft);">{{ w.mediaAccount }}</small></td>
              <td style="font-size: 13px;">{{ TYPE_OPTIONS.find(t => t.value === w.compositionType)?.label ?? '其他' }} / {{ SUB_TYPES.find(s => s.value === w.compositionSubType)?.label ?? '—' }}</td>
              <td><span :class="['status-badge', w.status]">{{ statusLabels[w.status] ?? w.status }}</span></td>
              <td><span :class="['status-badge', w.syncStatus === 'synced' ? 'active' : w.syncStatus === 'failed' ? 'rejected' : 'draft']">{{ syncLabels[w.syncStatus] ?? w.syncStatus }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <Teleport to="body">
      <div v-if="showCreate" class="dialog-overlay" @click.self="showCreate = false">
        <div class="dialog-card" style="width: min(520px, 92vw);">
          <div class="dialog-header">
            <h3>登记作品</h3>
            <button type="button" class="dialog-close" @click="showCreate = false">×</button>
          </div>
          <div class="dialog-body">
            <div class="form-field">
              <label>所属计划</label>
              <select v-model="form.planId">
                <option value="" disabled>选择推广计划</option>
                <option v-for="p in plans" :key="p.id" :value="p.id">{{ p.keyword }}（{{ p.channelName }}）</option>
              </select>
            </div>
            <div class="form-field">
              <label>媒体类型</label>
              <select v-model="form.mediaType">
                <option v-for="m in MEDIA_TYPES" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>
            <div class="form-field">
              <label>媒体账号</label>
              <input v-model="form.mediaAccount" placeholder="发布作品的媒体账号名" />
            </div>
            <div class="form-field">
              <label>作品分类</label>
              <div style="display: flex; gap: 10px;">
                <select v-model="form.compositionType" style="flex: 1;" @change="form.compositionSubType = subTypeOptions[0]?.value ?? 11">
                  <option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
                <select v-model="form.compositionSubType" style="flex: 1;">
                  <option v-for="s in subTypeOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
                </select>
              </div>
            </div>
            <div class="form-field">
              <label>标题（可选）</label>
              <input v-model="form.title" maxlength="255" />
            </div>
            <div class="form-field">
              <label>推广链接</label>
              <input v-model="form.promoUrl" type="url" placeholder="https://" />
            </div>
            <div class="form-field">
              <label>发布时间</label>
              <input v-model="form.releaseTime" type="datetime-local" />
            </div>
          </div>
          <div class="dialog-footer">
            <button class="ghost-aurora" @click="showCreate = false">取消</button>
            <button class="primary-action" :disabled="creating" @click="submitCreate">{{ creating ? '提交中...' : '确认登记' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
