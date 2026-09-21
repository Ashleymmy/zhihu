<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { WorkImportDraft, WorkImportDraftDetail, WorkImportOptions } from '@zhihu-koc/shared-services/zhihu'
const props = defineProps<{
  refreshKey: number
  api: {
    listWorkDrafts: (page: number) => Promise<{ list: WorkImportDraft[]; total: number }>
    getWorkDraft: (id: string) => Promise<WorkImportDraftDetail>
    getWorkDraftFile: (id: string) => Promise<Blob>
  }
}>()
const emit = defineEmits<{ resume: [file: File, options: WorkImportOptions] }>()
const list = ref<WorkImportDraft[]>([]), total = ref(0), page = ref(1), busy = ref(false), error = ref('')
const detail = ref<WorkImportDraftDetail | null>(null)
const detailPage = ref(1)
async function load() {
  busy.value = true; error.value = ''
  try { const result = await props.api.listWorkDrafts(page.value); list.value = result.list; total.value = result.total }
  catch (e: any) { error.value = e?.message || '本地批次加载失败' }
  finally { busy.value = false }
}
async function view(id: string) {
  busy.value = true
  try { detail.value = await props.api.getWorkDraft(id); detailPage.value = 1 }
  catch (e: any) { error.value = e?.message || '批次加载失败' }
  finally { busy.value = false }
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function source(draft: WorkImportDraft, resume = false) {
  busy.value = true; error.value = ''
  try {
    const blob = await props.api.getWorkDraftFile(draft.id)
    if (resume) { const data = await props.api.getWorkDraft(draft.id); detail.value = null; emit('resume', new File([blob], draft.fileName), data.options) }
    else download(blob, draft.fileName)
  } catch (e: any) { error.value = e?.message || '原表读取失败' }
  finally { busy.value = false }
}
function exportPending() {
  if (!detail.value) return
  const quote = (value: unknown) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`
  const rows = detail.value.preview.rows.filter(row => row.status !== 'duplicate')
  const typeLabels = ['其他', '图文', '视频']
  const subLabels: Record<number, string> = { 1: '实拍', 2: 'Live 图', 3: '截屏', 4: '漫画', 5: '表情包解说', 6: '真人演绎', 7: '猫 meme', 8: '漫剧', 9: '解压', 10: '滚屏', 11: '其他' }
  const table = [['原表行号', '关键词', '平台id', '平台', '视频链接', '日期', '作品分类', '作品子分类', '待处理问题'], ...rows.map(row => { const [type = -1, sub = -1] = (row.category || '').split(' / ').map(Number); return [row.row, row.keyword, row.mediaAccount, row.mediaType, row.promoUrl, row.releaseTime, typeLabels[type] || '', subLabels[sub] || '', row.errors.join('；')] })]
  download(new Blob(['\uFEFF', table.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `待推送作品-批次${detail.value.id}.csv`)
}
watch(() => props.refreshKey, () => { page.value = 1; void load() })
onMounted(load)
</script>
<template>
  <article class="panel draft-panel">
    <div class="draft-heading"><div><h3>本地待推送批次 <small>{{ total }}</small></h3><p>原表和核对记录保存在当前站点，补齐资料后可继续处理或导出，等待统一推送。</p></div><button :disabled="busy" @click="load">刷新批次</button></div>
    <p v-if="error" role="alert" class="draft-error">{{ error }}</p>
    <p v-if="!total && !busy" class="draft-empty">暂无本地批次。批量上传分析后，可选择“保存本地，稍后推送”。</p>
    <div v-for="draft in list" :key="draft.id" class="draft-item"><div><strong>{{ draft.fileName }}</strong><small>{{ draft.sheetName }} · 原表 {{ draft.totalCount }} 行 · 待推送 {{ draft.pendingCount }} 条 · 重复跳过 {{ draft.duplicateCount }} 条</small><small>资料待核对 {{ draft.pendingCount - draft.readyCount }} 条，当前校验通过 {{ draft.readyCount }} 条</small></div><div class="draft-actions"><button :disabled="busy" @click="view(draft.id)">查看明细</button><button :disabled="busy" @click="source(draft)">下载原表</button><button :disabled="busy" @click="source(draft, true)">继续处理</button></div></div>
    <nav v-if="total > 20" class="draft-actions"><button :disabled="page <= 1 || busy" @click="page--;load()">上一页</button><span>{{ page }} 页</span><button :disabled="page * 20 >= total || busy" @click="page++;load()">下一页</button></nav>
    <Teleport to="body"><div v-if="detail" class="dialog-overlay" @click.self="detail = null"><section class="dialog-card draft-dialog" role="dialog" aria-modal="true" aria-label="本地批次明细"><header class="dialog-header"><h3>{{ detail.fileName }} · 本地批次 #{{ detail.id }}</h3><button class="dialog-close" aria-label="关闭批次明细" @click="detail = null">×</button></header><div class="dialog-body draft-body"><p>待推送 {{ detail.pendingCount }} 条，重复 {{ detail.duplicateCount }} 条。此处展示保存时的核对结果，统一推送前需再次核对目标站点。</p><p v-if="detail.options.knownExternal">已附线上核对快照：{{ detail.options.knownExternal.site }}（{{ detail.options.knownExternal.checkedAt }}）。</p><div class="draft-table"><table><thead><tr><th>原表行</th><th>关键词 / 账号</th><th>链接</th><th>保存状态与问题</th></tr></thead><tbody><tr v-for="row in detail.preview.rows.slice((detailPage-1)*25, detailPage*25)" :key="row.row"><td>{{ row.row }}</td><td>{{ row.keyword || '缺少关键词' }}<small>{{ row.mediaAccount }}</small></td><td class="draft-url">{{ row.promoUrl }}</td><td><strong>{{ row.status === 'duplicate' ? '重复，跳过' : '本地待推送' }}</strong><small v-for="message in [...row.errors, ...row.notes]" :key="message">{{ message }}</small></td></tr></tbody></table></div><nav class="draft-actions"><button :disabled="detailPage === 1" @click="detailPage--">上一页</button><span>{{ detailPage }} / {{ Math.ceil(detail.totalCount / 25) }} 页</span><button :disabled="detailPage * 25 >= detail.totalCount" @click="detailPage++">下一页</button></nav></div><footer class="dialog-footer"><button @click="exportPending">导出待推送数据</button><button @click="detail = null">关闭</button></footer></section></div></Teleport>
  </article>
</template>
<style scoped>
.draft-panel{padding:22px}.draft-heading,.draft-item{display:flex;align-items:center;justify-content:space-between;gap:16px}.draft-heading h3{margin:0;font-size:16px}.draft-heading p,.draft-empty{font-size:12px;color:var(--ink-soft);line-height:1.8}.draft-item{padding:16px 0;border-top:1px solid var(--line,#ddd)}.draft-item small,.draft-table small{display:block;font-size:12px;color:var(--ink-soft);line-height:1.7;margin-top:5px}.draft-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}.draft-actions button,.draft-heading button{white-space:nowrap}.draft-error{color:#964639}.draft-dialog{width:min(1080px,95vw);max-height:90vh;display:flex;flex-direction:column}.draft-body{overflow:auto;font-size:13px}.draft-table{overflow:auto}.draft-table table{width:100%;min-width:700px;border-collapse:collapse}.draft-table th,.draft-table td{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line,#ddd)}.draft-url{max-width:280px;overflow-wrap:anywhere}@media(max-width:640px){.draft-heading,.draft-item{align-items:flex-start;flex-direction:column}.draft-panel{padding:16px}}
</style>
