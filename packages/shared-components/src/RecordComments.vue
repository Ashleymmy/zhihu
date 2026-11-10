<script setup lang="ts">
import { ref, watch } from 'vue'
import { apiMessage } from './settlement-request'
import { createRequestKey } from '@zhihu-koc/shared-utils'
import type { CommentApi, PageResult, RecordComment } from '@zhihu-koc/shared-contracts/core'
const props = defineProps<{ api: CommentApi; title?: string }>()
const data = ref<PageResult<RecordComment> | null>(null), body = ref(''), error = ref(''), sendError = ref(''), notice = ref(''), busy = ref(false), saving = ref(false), page = ref(1)
const attempt = ref<{ body: string; requestKey: string } | null>(null)
let generation = 0
async function load() {
  const version = ++generation; busy.value = true; error.value = ''; data.value = null
  try { const result = await props.api.list({ page: page.value, pageSize: 20 }); if (version === generation) data.value = result }
  catch (e) { if (version === generation) error.value = apiMessage(e, '沟通记录暂未加载，请重试。') }
  finally { if (version === generation) busy.value = false }
}
async function send() {
  if (saving.value || (!attempt.value && !body.value.trim())) return
  attempt.value ??= { body: body.value.trim(), requestKey: createRequestKey() }
  saving.value = true; sendError.value = ''; notice.value = ''
  try { await props.api.add(attempt.value); attempt.value = null; body.value = ''; notice.value = '留言已保存。'; page.value = 1; await load() }
  catch (e) { sendError.value = apiMessage(e, '未确认留言是否保存，请用原内容重试。'); const status = Number((e as { status?: number })?.status); if (status >= 400 && status < 500 && status !== 408) attempt.value = null }
  finally { saving.value = false }
}
watch(() => props.api, () => { page.value = 1; body.value = ''; attempt.value = null; notice.value = ''; sendError.value = ''; void load() }, { immediate: true })
</script>
<template>
  <section class="record-comments"><h3>{{ title || '这条记录的沟通' }}</h3>
    <div v-if="error" role="alert"><p>{{ error }}</p><button @click="load" :disabled="busy">重新读取留言</button></div><p v-else-if="busy" role="status">正在读取留言…</p>
    <template v-if="data"><p v-if="!data.total" class="muted">还没有留言，可以在这里补充核对进展。</p><article v-for="item in data.list" :key="item.id"><header><b>{{ item.authorName }}</b><time>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</time></header><p class="body">{{ item.body }}</p></article><div v-if="data.total > data.pageSize" class="pager"><button :disabled="page === 1 || busy" @click="page--;load()">上一页</button><span>第 {{ page }} 页 · {{ data.total }} 条</span><button :disabled="page * data.pageSize >= data.total || busy" @click="page++;load()">下一页</button></div></template>
    <form @submit.prevent="send"><label>补充进展<textarea v-model="body" required maxlength="2000" rows="3" :disabled="saving || !!attempt" placeholder="写下这条记录的核对进展" /></label><p v-if="sendError" role="alert">{{ sendError }}</p><p v-if="notice" role="status">{{ notice }}</p><button :disabled="saving || (!body.trim() && !attempt)">{{ saving ? '正在保存…' : attempt ? '用原内容重试保存' : '保存留言' }}</button></form>
  </section>
</template>
<style scoped>
.record-comments{border-top:1px solid var(--line);padding-top:18px;display:grid;gap:12px;min-width:0}.record-comments h3,.record-comments p{margin:0}.record-comments article{padding:12px;background:var(--paper-deep);border-radius:8px}.record-comments header,.pager{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.record-comments time,.muted{font-size:13px;color:var(--ink-soft)}.body{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px!important}.record-comments form,.record-comments label{display:grid;gap:8px}.record-comments textarea{box-sizing:border-box;width:100%;font:inherit;padding:10px;background:var(--paper);color:inherit;border:1px solid var(--line);border-radius:8px;resize:vertical}.record-comments button{min-height:44px;padding:10px 14px;border:1px solid var(--line);border-radius:8px;color:inherit;background:var(--paper);cursor:pointer}.record-comments button:disabled{opacity:.5;cursor:default}
</style>
