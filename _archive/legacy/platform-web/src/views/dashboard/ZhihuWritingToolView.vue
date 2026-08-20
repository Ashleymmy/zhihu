<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">文案模板工具</h1><p class="pg-sub">使用固定规则快速整理推广文案</p></div>
    </div>

    <a-alert
      message="本工具仅在浏览器中按固定模板处理文本，不调用 AI 或后端服务；本次记录会在刷新页面后清空。"
      type="info"
      show-icon
      style="margin-bottom:16px"
    />

    <div class="writing-layout">
      <!-- 左栏：输入 -->
      <div class="write-panel">
        <div class="panel-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          原始文案
        </div>
        <a-textarea
          v-model:value="inputText"
          placeholder="粘贴推广文案，选择固定模板进行整理…"
          :rows="12"
          :maxlength="2000"
          show-count
          class="write-textarea"
        />
        <div class="style-row">
          <span class="style-label">优化风格：</span>
          <div class="style-chips">
            <span v-for="s in styles" :key="s.v" :class="['style-chip', { active: selectedStyle === s.v }]" @click="selectedStyle = s.v">{{ s.l }}</span>
          </div>
        </div>
        <a-button type="primary" size="large" :disabled="!inputText.trim()" block @click="optimize" style="margin-top:12px">
          <template #icon><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></template>
          应用本地模板
        </a-button>
      </div>

      <!-- 右栏：输出 -->
      <div class="write-panel result-panel">
        <div class="panel-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span style="color:var(--color-accent)">优化结果</span>
          <span v-if="outputText" class="copy-link" @click="copyOutput">复制结果</span>
        </div>
        <div v-if="outputText" class="output-text">{{ outputText }}</div>
        <div v-else class="output-empty">优化结果将显示在这里</div>

        <!-- 历史 -->
        <div v-if="history.length" class="history-section">
          <div class="history-title">本次会话记录</div>
          <div v-for="h in history.slice(0, 3)" :key="h.ts" class="history-item" @click="restoreHistory(h)">
            <div class="hi-text">{{ h.output.slice(0, 60) }}…</div>
            <div class="hi-meta">{{ h.style }} · {{ h.ts }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { message } from 'ant-design-vue'

interface HistoryItem { ts: string; style: string; input: string; output: string }

const inputText     = ref('')
const outputText    = ref('')
const selectedStyle = ref('professional')
const history       = ref<HistoryItem[]>([])

const styles = [
  { v: 'professional', l: '专业严谨' },
  { v: 'vivid',        l: '生动活泼' },
  { v: 'concise',      l: '简洁精炼' },
  { v: 'emotional',    l: '情感共鸣' },
]

/** 按风格对原文做本地文案变换（不依赖外部 API） */
function applyStyle(text: string, style: string): string {
  const t = text.trim()
  // 提取关键信息：取前两句或前80字作为核心内容
  const core = t.replace(/[！!。？?，,\n]+$/g, '').slice(0, 80)
  const suffix = t.length > 80 ? '…' : ''

  switch (style) {
    case 'professional':
      return `经专业评测，${core}${suffix}。在同类产品中，该方案兼顾功能深度与使用便捷性，数据表现领先行业均值，适合注重效率与品质的用户群体。`
    case 'vivid':
      return `哇！${core}${suffix}！用了之后简直停不下来，真的强烈推荐！已经安利给身边所有人了，你还没试试吗？快来一起体验吧！🔥`
    case 'concise':
      // 把长句拆短，去掉修饰词
      return core.replace(/[的地得]/g, '').replace(/[，,]/g, '。') + `${suffix}。简单直接，高效解决需求。`
    case 'emotional':
      return `每当用到${core.slice(0, 20)}，就感觉生活多了一份仪式感。${core}${suffix}——不只是产品，更是陪伴你每一天的好伙伴。`
    default:
      return t
  }
}

function optimize() {
  if (!inputText.value.trim()) return
  outputText.value = applyStyle(inputText.value, selectedStyle.value)

  history.value.unshift({
    ts:     new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }),
    style:  styles.find(s => s.v === selectedStyle.value)?.l ?? '',
    input:  inputText.value,
    output: outputText.value,
  })
  if (history.value.length > 10) history.value.pop()
}

async function copyOutput() {
  await navigator.clipboard.writeText(outputText.value)
  message.success('已复制优化结果')
}

function restoreHistory(h: HistoryItem) {
  inputText.value = h.input; outputText.value = h.output
}
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.writing-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.write-panel { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.result-panel { border-color: var(--color-accent-border); background: linear-gradient(135deg, var(--color-bg-elevated) 0%, rgba(99,102,241,0.03) 100%); }
.panel-title { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.copy-link { margin-left: auto; font-size: 12px; color: var(--color-accent); cursor: pointer; font-weight: 400; }
.copy-link:hover { opacity: 0.75; }
.write-textarea :deep(textarea) { background: var(--color-bg-primary) !important; color: var(--color-text-primary) !important; border-color: var(--color-border) !important; font-size: 13.5px !important; line-height: 1.7 !important; resize: none; }
.style-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.style-label { font-size: 12.5px; color: var(--color-text-tertiary); flex-shrink: 0; }
.style-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.style-chip { padding: 4px 12px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.style-chip.active { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent); }
.output-text { font-size: 13.5px; color: var(--color-text-secondary); line-height: 1.8; padding: 8px 0; flex: 1; }
.output-empty { font-size: 13px; color: var(--color-text-disabled); padding: 40px 0; text-align: center; flex: 1; }
.history-section { border-top: 1px solid var(--color-border); padding-top: 12px; margin-top: 4px; }
.history-title { font-size: 11.5px; font-weight: 600; color: var(--color-text-disabled); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.history-item { padding: 8px 10px; background: var(--color-bg-active); border-radius: var(--radius-md); cursor: pointer; margin-bottom: 6px; transition: border-color var(--transition-fast); border: 1px solid transparent; }
.history-item:hover { border-color: var(--color-accent-border); }
.hi-text { font-size: 12px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hi-meta { font-size: 11px; color: var(--color-text-disabled); margin-top: 3px; }
</style>
