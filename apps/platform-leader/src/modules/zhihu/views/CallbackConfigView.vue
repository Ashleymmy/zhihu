<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchAllPages } from '@zhihu-koc/shared-services'
import { apis } from '../context'

const rules = ref<any[]>([])
const loading = ref(true)
const error = ref('')

const eventTypeLabels: Record<string, string> = { impression: '曝光', click: '点击', conversion: '转化' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    rules.value = await fetchAllPages((params) => apis.callbacks.listRules(params))
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
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
      <span>回传规则由管理员配置</span>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 200px;">
      <div class="list-toolbar">
        <span class="toolbar-title">回传规则</span>
      </div>
      <div v-if="loading" style="display: grid; min-height: 160px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!rules.length" class="empty-panel"><span>暂无回传规则，请联系管理员配置。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>回传 URL</th><th>事件类型</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.id">
              <td style="font-family: var(--font-mono); font-size: 12px;">{{ rule.callbackUrl }}</td>
              <td>
                <span v-for="et in rule.eventsJson" :key="et" class="event-tag" style="margin-right: 4px;">{{ eventTypeLabels[et] || et }}</span>
              </td>
              <td><span :class="['status-badge', rule.status === 'active' ? 'active' : 'ended']">{{ rule.status === 'active' ? '启用' : '停用' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>


  </div>
</template>
