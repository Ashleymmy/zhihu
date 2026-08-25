<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CallbackRule, CallbackSecret, Plan } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const rules = ref<CallbackRule[]>([])
const plans = ref<Plan[]>([])
const secret = ref<CallbackSecret | null>(null)
const loading = ref(true)
const error = ref('')
const showModal = ref(false)
const submitting = ref(false)
const rotating = ref(false)
const form = ref({ planId: '', callbackUrl: '', events: ['impression', 'click', 'conversion'] as string[] })

const eventTypeLabels: Record<string, string> = { impression: '曝光', click: '点击', conversion: '转化' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [r, s] = await Promise.all([
      apis.callbacks.listRules({ page: 1, pageSize: 100 }),
      apis.callbacks.getSecret().catch(() => null),
    ])
    rules.value = r.list
    secret.value = s
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function openCreate() {
  showModal.value = true
  if (!plans.value.length) {
    try { plans.value = (await apis.plans.list({ page: 1, pageSize: 100 })).list } catch { /* 不阻塞 */ }
  }
}

async function createRule() {
  error.value = ''
  if (!form.value.planId || !form.value.callbackUrl.trim()) { error.value = '请选择计划并填写回传 URL'; return }
  if (!form.value.events.length) { error.value = '至少选择一个事件类型'; return }
  submitting.value = true
  try {
    await apis.callbacks.createRule({
      planId: form.value.planId,
      callbackUrl: form.value.callbackUrl.trim(),
      events: form.value.events,
    })
    showModal.value = false
    form.value = { planId: '', callbackUrl: '', events: ['impression', 'click', 'conversion'] }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { submitting.value = false }
}

async function deleteRule(id: string) {
  if (!confirm('确定删除此回传规则？')) return
  try { await apis.callbacks.deleteRule(id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

async function rotateSecret() {
  if (!confirm('轮换密钥后，旧的回调签名将失效。确定继续？')) return
  rotating.value = true
  error.value = ''
  try { secret.value = await apis.callbacks.rotateSecret() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { rotating.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">CALLBACK / CONFIG</p>
        <h1>回传配置</h1>
        <p style="max-width: 520px; margin: 6px 0 0; color: var(--ink-soft); font-size: 13px; line-height: 1.7;">配置回传事件的 URL 和类型，系统会自动将转化数据回传到指定地址。</p>
      </div>
      <button class="primary-action" @click="openCreate">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        添加规则
      </button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <!-- 密钥管理 -->
    <article class="panel" style="padding: 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div>
          <p class="section-index quiet" style="margin-bottom: 4px;">回传密钥</p>
          <p style="margin: 0; font-family: var(--font-mono); font-size: 12px;">
            {{ secret ? `****${secret.lastFour}` : '未配置' }}
            <small v-if="secret" style="color: var(--ink-soft); margin-left: 8px;">轮换于 {{ new Date(secret.rotatedAt).toLocaleDateString('zh-CN') }}</small>
          </p>
        </div>
        <button class="row-action" :disabled="rotating" @click="rotateSecret">{{ rotating ? '轮换中...' : '轮换密钥' }}</button>
      </div>
    </article>

    <article class="panel data-panel" style="min-height: 200px;">
      <div class="list-toolbar">
        <span class="toolbar-title">回传规则</span>
        <span class="toolbar-count">{{ rules.length }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!rules.length" class="empty-panel"><span>暂无回传规则。点击「添加规则」开始配置。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>所属计划</th><th>回传 URL</th><th>事件类型</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.id">
              <td style="font-size: 13px;">{{ rule.planName ?? '—' }}</td>
              <td style="font-family: var(--font-mono); font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ rule.callbackUrl }}</td>
              <td>
                <span v-for="et in rule.eventsJson" :key="et" class="event-tag" style="margin-right: 4px;">{{ eventTypeLabels[et] || et }}</span>
              </td>
              <td><span :class="['status-badge', rule.status === 'active' ? 'active' : 'ended']">{{ rule.status === 'active' ? '启用' : '停用' }}</span></td>
              <td><button class="row-action danger" @click="deleteRule(rule.id)">删除</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <!-- 创建对话框 -->
    <Teleport to="body">
      <div v-if="showModal" class="dialog-overlay" @click.self="showModal = false">
        <div class="dialog-card" style="width: min(480px, 92vw);">
          <div class="dialog-header">
            <h3>添加回传规则</h3>
            <button type="button" class="dialog-close" @click="showModal = false">×</button>
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
              <label>回传 URL</label>
              <input v-model="form.callbackUrl" type="url" placeholder="https://your-api.com/callback" required />
            </div>
            <div class="form-field">
              <label>事件类型</label>
              <div class="event-options">
                <label v-for="(label, key) in eventTypeLabels" :key="key">
                  <input type="checkbox" :value="key" v-model="form.events" />
                  {{ label }}
                </label>
              </div>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="ghost-aurora" @click="showModal = false">取消</button>
            <button class="primary-action" :disabled="submitting" @click="createRule">{{ submitting ? '提交中...' : '确认添加' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
