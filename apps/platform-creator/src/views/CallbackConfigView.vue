<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { apis } from '../stores/auth'

const rules = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const showModal = ref(false)
const form = ref({ callbackUrl: '', eventTypes: ['impression', 'click', 'conversion'] })

const eventTypeLabels: Record<string, string> = { impression: '曝光', click: '点击', conversion: '转化' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    // TODO: 后端需要实现回传规则接口
    rules.value = []
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function createRule() {
  if (!form.value.callbackUrl.trim()) return
  try {
    // TODO: 后端需要实现回传规则创建接口
    showModal.value = false
    form.value = { callbackUrl: '', eventTypes: ['impression', 'click', 'conversion'] }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

async function deleteRule(id: string) {
  if (!confirm('确定删除此回传规则？')) return
  try {
    // TODO: 后端需要实现回传规则删除接口
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
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
      <button class="primary-action" @click="showModal = true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        添加规则
      </button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 200px;">
      <div class="list-toolbar">
        <span class="toolbar-title">回传规则</span>
      </div>
      <div v-if="loading" style="display: grid; min-height: 160px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!rules.length" class="empty-panel"><span>暂无回传规则。点击「添加规则」开始配置。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>回传 URL</th><th>事件类型</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.id">
              <td style="font-family: var(--font-mono); font-size: 12px;">{{ rule.callbackUrl }}</td>
              <td>
                <span v-for="et in rule.eventTypes" :key="et" class="event-tag" style="margin-right: 4px;">{{ eventTypeLabels[et] || et }}</span>
              </td>
              <td><span :class="['status-badge', rule.isActive ? 'active' : 'ended']">{{ rule.isActive ? '启用' : '停用' }}</span></td>
              <td><button class="row-action danger" @click="deleteRule(rule.id)">删除</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <!-- 创建对话框 -->
    <Teleport to="body">
      <div v-if="showModal" style="position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; background: rgba(33, 33, 33, 0.4); backdrop-filter: blur(2px);" @click.self="showModal = false">
        <div style="width: min(480px, 90vw); padding: 28px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--white); box-shadow: var(--shadow-float);">
          <h2 style="margin: 0 0 20px; font-family: var(--font-display); font-size: 22px;">添加回传规则</h2>
          <form class="form-grid" @submit.prevent="createRule" style="gap: 16px;">
            <div class="full-span">
              <label>回传 URL</label>
              <input v-model="form.callbackUrl" placeholder="https://your-api.com/callback" required />
            </div>
            <div class="full-span">
              <label>事件类型</label>
              <div class="event-options">
                <label v-for="(label, key) in eventTypeLabels" :key="key">
                  <input type="checkbox" :value="key" v-model="form.eventTypes" />
                  {{ label }}
                </label>
              </div>
            </div>
            <div class="form-submit" style="display: flex; gap: 10px; margin-top: 8px;">
              <button type="submit" class="primary-action" style="flex: 1;">确认添加</button>
              <button type="button" class="ghost-aurora" @click="showModal = false">取消</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
