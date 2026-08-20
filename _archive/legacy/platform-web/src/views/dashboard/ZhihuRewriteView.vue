<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">本地快速改写</h1><p class="pg-sub">使用固定语气规则整理文案</p></div>
      <button v-if="rewrites.length" class="btn-danger-sm" @click="clearAll">清空记录</button>
    </div>

    <a-alert
      message="本工具仅执行浏览器本地字符串规则，不调用 AI 或后端服务；历史记录会在刷新页面后清空。"
      type="info"
      show-icon
      style="margin-bottom:16px"
    />

    <!-- 新建改写 -->
    <div class="new-rewrite-card">
      <div class="nr-title">快速改写</div>
      <div class="nr-body">
        <a-textarea v-model:value="quickInput" placeholder="输入需要改写的文案…" :rows="4" :maxlength="1000" show-count class="nr-textarea" />
        <div class="nr-actions">
          <div class="tone-select">
            <span class="tone-label">改写语气：</span>
            <a-radio-group v-model:value="tone" size="small">
              <a-radio-button value="formal">正式</a-radio-button>
              <a-radio-button value="casual">轻松</a-radio-button>
              <a-radio-button value="persuasive">说服力</a-radio-button>
            </a-radio-group>
          </div>
          <a-button type="primary" :disabled="!quickInput.trim()" @click="doRewrite">改写文案</a-button>
        </div>
      </div>
    </div>

    <!-- 历史记录 -->
    <div v-if="rewrites.length" class="rewrite-list">
      <div class="list-header">
        <span class="list-title">本次会话记录（{{ rewrites.length }} 条）</span>
      </div>
      <div v-for="(r, i) in rewrites" :key="r.id" class="rewrite-item animate-card" :style="{ animationDelay: i * 40 + 'ms' }">
        <div class="ri-header">
          <span class="ri-time">{{ r.time }}</span>
          <span class="ri-tone">{{ toneLabel(r.tone) }}</span>
          <button class="ri-copy" @click="copyText(r.output)">复制</button>
          <button class="ri-del" @click="deleteItem(r.id)">删除</button>
        </div>
        <div class="ri-row">
          <div class="ri-side original">
            <div class="ri-side-label">原文</div>
            <div class="ri-text">{{ r.input }}</div>
          </div>
          <div class="ri-arrow">→</div>
          <div class="ri-side result">
            <div class="ri-side-label">改写后</div>
            <div class="ri-text">{{ r.output }}</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty-hint">暂无改写记录，在上方快速改写一条文案试试</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { message } from 'ant-design-vue'

interface RewriteItem { id: string; time: string; tone: string; input: string; output: string }

const quickInput = ref(''); const tone = ref('casual')
const rewrites   = ref<RewriteItem[]>([])

const TONE_MAP: Record<string, string> = { formal:'正式', casual:'轻松', persuasive:'说服力' }
function toneLabel(t: string) { return TONE_MAP[t] ?? t }

/** 根据语气对原文做本地改写变换 */
function rewriteText(text: string, toneKey: string): string {
  const t = text.trim()
  switch (toneKey) {
    case 'formal':
      return '经专业评估，' + t
        .replace(/[！!]+/g, '。')
        .replace(/[哇呀啊]/g, '')
        .replace(/真的|好像|感觉/g, '')
        .trim() + '，欢迎深入了解与体验。'
    case 'casual':
      return '说真的，' + t + ' 强烈安利！'
    case 'persuasive':
      return '试想一下：' + t + '——现在就是做出改变的最好时机。'
    default:
      return t
  }
}

function doRewrite() {
  if (!quickInput.value.trim()) return
  const output = rewriteText(quickInput.value, tone.value)
  rewrites.value.unshift({
    id:   Date.now().toString(),
    time: new Date().toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }),
    tone: tone.value,
    input:  quickInput.value,
    output,
  })
  quickInput.value = ''
  message.success('改写完成')
}

async function copyText(text: string) { await navigator.clipboard.writeText(text); message.success('已复制') }
function deleteItem(id: string) { rewrites.value = rewrites.value.filter(r => r.id !== id) }
function clearAll() { rewrites.value = []; message.success('已清空') }
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.btn-danger-sm { padding: 6px 14px; background: var(--color-error-bg); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--radius-md); font-size: 12px; color: var(--color-error); cursor: pointer; transition: all var(--transition-fast); }
.btn-danger-sm:hover { background: var(--color-error); color: white; }
.new-rewrite-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 20px; }
.nr-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 12px; }
.nr-body { display: flex; flex-direction: column; gap: 12px; }
.nr-textarea :deep(textarea) { background: var(--color-bg-primary) !important; color: var(--color-text-primary) !important; border-color: var(--color-border) !important; font-size: 13.5px !important; }
.nr-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.tone-select { display: flex; align-items: center; gap: 8px; }
.tone-label { font-size: 12.5px; color: var(--color-text-tertiary); }
.rewrite-list { display: flex; flex-direction: column; gap: 12px; }
.items-header { display: flex; align-items: center; margin-bottom: 4px; }
.items-title { font-size: 13.5px; font-weight: 600; color: var(--color-text-primary); }
.rewrite-item { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 16px; opacity: 0; transition: border-color var(--transition-fast); }
.rewrite-item:hover { border-color: var(--color-border-hover); }
.ri-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.ri-time { font-size: 11.5px; color: var(--color-text-disabled); }
.ri-tone { padding: 2px 8px; background: var(--color-accent-subtle); border-radius: var(--radius-full); font-size: 11px; color: var(--color-accent); }
.ri-copy,.ri-del { margin-left: auto; padding: 3px 10px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 11.5px; cursor: pointer; transition: all var(--transition-fast); color: var(--color-text-secondary); }
.ri-del { margin-left: 4px; }
.ri-copy:hover { border-color: var(--color-accent); color: var(--color-accent); }
.ri-del:hover  { border-color: var(--color-error); color: var(--color-error); }
.ri-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: start; }
.ri-side { background: var(--color-bg-primary); border-radius: var(--radius-md); padding: 10px 12px; }
.ri-side.result { background: rgba(99,102,241,0.05); border: 1px solid var(--color-accent-border); }
.ri-side-label { font-size: 10.5px; font-weight: 600; color: var(--color-text-disabled); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
.ri-text { font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; }
.ri-side.result .ri-text { color: var(--color-text-primary); }
.ri-arrow { color: var(--color-text-disabled); font-size: 18px; padding-top: 26px; }
.empty-hint { padding: 40px; text-align: center; color: var(--color-text-disabled); font-size: 14px; background: var(--color-bg-elevated); border: 1px dashed var(--color-border); border-radius: var(--radius-lg); }
</style>
