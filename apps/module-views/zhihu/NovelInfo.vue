<script setup lang="ts">
import { computed, ref } from 'vue'
const props = defineProps<{ title?: string | null; url?: string | null }>()
const copied = ref('')
const safeUrl = computed(() => {
  try {
    const url = new URL(props.url || '')
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
})
async function copy() {
  try { await navigator.clipboard.writeText(props.url || ''); copied.value = '原文链接已复制' }
  catch { copied.value = '复制失败，请选中链接手动复制' }
}
</script>
<template>
  <div class="novel-info">
    <div>小说原名：{{ title || '未填写' }}</div>
    <template v-if="safeUrl">
      <a :href="safeUrl" target="_blank" rel="noopener noreferrer" class="novel-url">{{ url }}</a>
      <div class="novel-actions"><a :href="safeUrl" target="_blank" rel="noopener noreferrer">查看原文</a><button type="button" @click="copy">复制原文链接</button></div>
      <span v-if="copied" role="status">{{ copied }}</span>
    </template>
    <span v-else>原文链接未填写</span>
  </div>
</template>
<style scoped>
.novel-info{margin-top:10px;font-size:13px;line-height:1.6;color:var(--ink-soft,#65716d);text-align:left;min-width:0;max-width:480px;white-space:normal;overflow-wrap:anywhere}
.novel-url{display:block;max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:break-all;margin:4px 0;color:inherit}
.novel-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.novel-actions a{color:var(--accent,#195e62)}
.novel-actions button{font:inherit;padding:4px 8px;border:1px solid var(--line,#dce3e5);border-radius:5px;background:transparent;cursor:pointer;color:inherit}
</style>
