<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { WorkImportOptions, WorkImportPreview, WorkImportResult, WorkImportDraftReceipt } from '@zhihu-koc/shared-services/zhihu'

const props = defineProps<{
  api: {
    analyzeWorks: (file: File, options: WorkImportOptions) => Promise<WorkImportPreview>
    importWorks: (file: File, options: WorkImportOptions) => Promise<WorkImportResult>
    saveWorkDraft: (file: File, options: WorkImportOptions) => Promise<WorkImportDraftReceipt>
  }
  plans: { id: string; keyword: string; channelName?: string }[]
  initialPlanId?: string
  initialFile?: File
  initialOptions?: WorkImportOptions
}>()
const emit = defineEmits<{ close: []; imported: [result: WorkImportResult]; saved: [] }>()
const file = ref<File | null>(null)
const preview = ref<WorkImportPreview | null>(null)
const receipt = ref<WorkImportResult | null>(null)
const draftReceipt = ref<WorkImportDraftReceipt | null>(null)
const busy = ref(false)
const error = ref('')
const dirty = ref(false)
const filter = ref('all')
const page = ref(1)
const input = ref<HTMLInputElement>()
const options = ref<WorkImportOptions>(props.initialOptions ? JSON.parse(JSON.stringify(props.initialOptions)) : { defaults: { planId: props.initialPlanId || undefined }, categoryMode: 'manual' })
options.value.defaults ||= {}
onMounted(() => { if (props.initialFile) { file.value = props.initialFile; void analyze() } })
const statusLabels = { ready: '可上传', duplicate: '重复，跳过', invalid: '需补充', created: '已保存' }
const types = [{ value: 0, label: '其他' }, { value: 1, label: '图文' }, { value: 2, label: '视频' }]
const subTypes = [{ value: 11, label: '其他', parent: 0 }, { value: 1, label: '实拍', parent: 1 }, { value: 2, label: 'Live 图', parent: 1 }, { value: 3, label: '截屏', parent: 1 }, { value: 4, label: '漫画', parent: 1 }, { value: 5, label: '表情包解说', parent: 2 }, { value: 6, label: '真人演绎', parent: 2 }, { value: 7, label: '猫 meme', parent: 2 }, { value: 8, label: '漫剧', parent: 2 }, { value: 9, label: '解压', parent: 2 }, { value: 10, label: '滚屏', parent: 2 }]
const availableSubTypes = computed(() => subTypes.filter(item => item.parent === options.value.defaults?.compositionType))
const filteredRows = computed(() => (receipt.value || preview.value)?.rows.filter(row => filter.value === 'all' || row.status === filter.value) || [])
const shownRows = computed(() => filteredRows.value.slice((page.value - 1) * 20, page.value * 20))
let alive = true
onBeforeUnmount(() => { alive = false })
function changed() { dirty.value = true; error.value = '' }
function headerChanged() { delete options.value.mapping; changed() }
function close() { if (!busy.value) emit('close') }
function categoryLabel(category?: string) {
  if (!category) return '—'
  const [type, sub] = category.split(' / ').map(Number)
  return `${types.find(item => item.value === type)?.label || '待补充'} / ${subTypes.find(item => item.value === sub)?.label || '待补充'}`
}
function displayDate(value: string) {
  if (!value.includes('T')) return value || '—'
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}
async function chooseFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0]
  if (!selected) return
  error.value = ''
  if (!/\.(xlsx|xls|csv)$/i.test(selected.name) || selected.size > 5 * 1024 * 1024) {
    file.value = null
    preview.value = null
    receipt.value = null
    error.value = '请选择不超过 5 MB 的 .xlsx、.xls 或 .csv 文件'
    return
  }
  file.value = selected
  preview.value = null
  receipt.value = null
  options.value = { defaults: options.value.defaults, categoryMode: options.value.categoryMode }
  await analyze()
}
async function analyze(resetMapping = false) {
  if (!file.value || busy.value) return
  busy.value = true
  error.value = ''
  if (resetMapping) { delete options.value.mapping; delete options.value.headerRow }
  try {
    const result = await props.api.analyzeWorks(file.value, options.value)
    if (!alive) return
    preview.value = result
    options.value.sheetName = result.sheetName
    options.value.headerRow = result.headerRow
    options.value.mapping = { ...result.mapping }
    dirty.value = false
    page.value = 1
    filter.value = 'all'
  } catch (e: any) { error.value = e?.message || '表格分析失败，请重试' }
  finally { busy.value = false }
}
async function submit() {
  if (!file.value || busy.value || dirty.value || !preview.value?.ready || receipt.value) return
  busy.value = true
  error.value = ''
  try {
    receipt.value = await props.api.importWorks(file.value, options.value)
    page.value = 1
    filter.value = 'all'
    emit('imported', receipt.value)
  } catch (e: any) {
    error.value = `${e?.message || '上传失败'}。可重新分析后重试，服务器会再次核对重复链接。`
    dirty.value = true
  } finally { busy.value = false }
}
async function saveDraft() {
  if (!file.value || busy.value || dirty.value || !preview.value?.total) return
  busy.value = true
  error.value = ''
  try {
    draftReceipt.value = await props.api.saveWorkDraft(file.value, options.value)
    preview.value = draftReceipt.value.preview
    emit('saved')
  } catch (e: any) { error.value = e?.message || '本地保存失败，请重试' }
  finally { busy.value = false }
}
function downloadIssues() {
  const rows = (receipt.value || preview.value)?.rows.filter(row => row.status === 'invalid') || []
  const quote = (value: unknown) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`
  const csv = [['原表行号', '关键词', '媒体账号', '媒体类型', '推广链接', '发布时间', '问题'], ...rows.map(row => [row.row, row.keyword, row.mediaAccount, row.mediaType, row.promoUrl, row.releaseTime, row.errors.join('；')])].map(row => row.map(quote).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = '作品上传待补充.csv'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <Teleport to="body">
    <div class="dialog-overlay work-import-overlay" @click.self="close" @keydown.esc="close">
      <section class="dialog-card work-import-card" role="dialog" aria-modal="true" aria-labelledby="work-import-title" :aria-busy="busy">
        <header class="dialog-header">
          <div><h3 id="work-import-title">批量上传作品</h3><p>读取表格，核对已有作品，只新增未上传的记录。</p></div>
          <button class="dialog-close" aria-label="关闭批量上传" :disabled="busy" @click="emit('close')">×</button>
        </header>
        <div class="dialog-body work-import-body">
          <div v-if="error" class="import-error" role="alert">{{ error }}</div>
          <div v-if="draftReceipt" class="import-result" role="status"><strong>本地批次 #{{ draftReceipt.id }} 已保存：{{ draftReceipt.pending }} 条待推送，{{ draftReceipt.duplicate }} 条重复跳过。</strong><p>原表及全部 {{ draftReceipt.total }} 行核对记录已保留。尚未提交线上或知乎，可在“本地待推送批次”继续处理。</p></div>
          <div v-if="receipt" class="import-result" role="status">
            <strong>已保存 {{ receipt.created }} 条，跳过重复 {{ receipt.duplicate }} 条，需补充 {{ receipt.invalid }} 条。</strong>
            <p>{{ receipt.queued }} 条已提交知乎同步队列，实际同步结果请查看作品列表。</p>
            <p v-if="receipt.queueFailed.length" class="import-error">{{ receipt.queueFailed.length }} 条已保存，但同步队列暂不可用，请联系管理员重试同步。作品编号：{{ receipt.queueFailed.join('、') }}</p>
          </div>
          <template v-if="!receipt && !draftReceipt">
            <div class="import-file">
              <div><strong>{{ file?.name || '选择作品登记表' }}</strong><p>Excel / CSV · 最大 5 MB · 每张工作表最多 1000 条</p></div>
              <button type="button" class="primary-action" :disabled="busy" @click="input?.click()">{{ file ? '更换表格' : '选择表格' }}</button>
              <input ref="input" class="file-input" type="file" accept=".xlsx,.xls,.csv" aria-label="选择作品表格" :disabled="busy" @change="chooseFile" />
            </div>
            <p v-if="!preview" class="import-help">支持识别“日期、平台id、平台、视频链接、关键词”等列名。上传后可调整字段对应关系，再确认保存。</p>
            <fieldset v-if="preview" class="import-settings" :disabled="busy">
              <div class="import-controls">
                <label>工作表<select v-model="options.sheetName" @change="changed(); analyze(true)"><option v-for="name in preview.sheetNames" :key="name">{{ name }}</option></select></label>
                <label>表头所在行<input v-model.number="options.headerRow" type="number" min="1" max="30" @input="headerChanged" /></label>
                <label>缺少关键词时使用的计划<select v-model="options.defaults!.planId" @change="changed"><option :value="undefined">不补填，标记待处理</option><option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.keyword }}（{{ plan.channelName || plan.id }}）</option></select></label>
              </div>
              <details class="import-mapping">
                <summary>字段识别 · 已对应 {{ Object.values(options.mapping || {}).filter(v => v !== null).length }} 个字段（点击调整）</summary>
                <div v-if="options.mapping" class="mapping-grid"><label v-for="field in preview.fields" :key="field.key">{{ field.label }}<select v-model="options.mapping[field.key]" @change="changed"><option :value="null">表格中没有此字段</option><option v-for="column in preview.columns" :key="column.index" :value="column.index">{{ column.index + 1 }}. {{ column.label }}{{ column.samples[0] ? `（${column.samples[0].slice(0, 26)}）` : '' }}</option></select></label></div>
              </details>
              <div class="import-controls defaults">
                <label>缺失分类的补填方式<select v-model="options.categoryMode" @change="changed"><option value="manual">指定统一分类</option><option value="rotate-video">视频子分类均衡随机填充</option></select></label>
                <template v-if="options.categoryMode === 'manual'">
                  <label>默认作品分类<select v-model="options.defaults!.compositionType" @change="options.defaults!.compositionSubType = undefined; changed()"><option :value="undefined">请选择</option><option v-for="type in types" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
                  <label>默认作品子分类<select v-model="options.defaults!.compositionSubType" @change="changed"><option :value="undefined">请选择</option><option v-for="type in availableSubTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
                </template>
                <label>缺失日期时补填（北京时间）<input v-model="options.defaults!.releaseTime" type="datetime-local" @input="changed" /></label>
              </div>
              <p class="import-help">日期按北京时间解析，仅有日期时按 00:00 登记。{{ options.categoryMode === 'rotate-video' ? '随机分类为按设置补填，不代表识别了视频内容。' : '分类缺失时请明确选择，不会自动猜测。' }} 未识别的关键词不会套用默认计划。</p>
              <button type="button" class="import-recheck" :disabled="busy" @click="analyze()">{{ busy ? '正在读取表格并核对数据库…' : dirty ? '设置已变更，重新分析' : '重新核对已有作品' }}</button>
            </fieldset>
          </template>
          <p v-if="busy" class="import-help" role="status">{{ preview ? '正在处理，请稍候…' : '正在读取文件内容并匹配字段…' }}</p>
          <template v-if="preview">
            <div class="import-summary" :class="{ stale: dirty }">
              <div><span>表格记录</span><strong>{{ preview.total }}</strong></div>
              <div><span>{{ receipt ? '已保存' : '可上传' }}</span><strong>{{ receipt ? receipt.created : preview.ready }}</strong></div>
              <div><span>重复，跳过</span><strong>{{ (receipt || preview).duplicate }}</strong></div>
              <div><span>需补充</span><strong>{{ (receipt || preview).invalid }}</strong></div>
            </div>
            <p v-if="dirty" class="import-error">设置已变化，重新分析后才可上传。</p>
            <div class="preview-toolbar"><label>查看<select v-model="filter" @change="page = 1"><option value="all">全部记录</option><option :value="receipt ? 'created' : 'ready'">{{ receipt ? '已保存' : '可上传' }}</option><option value="duplicate">重复记录</option><option value="invalid">需补充</option></select></label><button v-if="(receipt || preview).invalid" @click="downloadIssues">下载待补充清单</button></div>
            <div class="import-table"><table><thead><tr><th>原表行</th><th>关键词 / 账号</th><th>平台 / 分类</th><th>推广链接 / 发布时间</th><th>核对结果</th></tr></thead><tbody>
              <tr v-for="row in shownRows" :key="row.row"><td>{{ row.row }}</td><td><strong>{{ row.keyword || '缺少关键词' }}</strong><small>{{ row.mediaAccount || '缺少账号' }}</small></td><td>{{ row.mediaType || '—' }}<small>{{ categoryLabel(row.category) }}</small></td><td><span class="import-url" :title="row.promoUrl">{{ row.promoUrl || '缺少链接' }}</span><small>{{ displayDate(row.releaseTime) }}</small></td><td><span :class="['import-status', row.status]">{{ statusLabels[row.status] }}</span><small v-for="message in [...row.errors, ...row.notes]" :key="message">{{ message }}</small></td></tr>
              <tr v-if="!shownRows.length"><td colspan="5">{{ preview.total ? '此分类没有记录' : '当前工作表没有作品数据，请选择其他工作表' }}</td></tr>
            </tbody></table></div>
            <nav class="preview-pagination" aria-label="上传预览分页"><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ Math.max(1, Math.ceil(filteredRows.length / 20)) }} 页 · {{ filteredRows.length }} 条</span><button :disabled="page * 20 >= filteredRows.length" @click="page++">下一页</button></nav>
          </template>
        </div>
        <footer class="dialog-footer import-footer"><p>{{ draftReceipt ? '本地已保存，等待补充资料及统一推送。' : receipt ? '保存结果已返回，作品列表已刷新。' : '可先保存本地批次；确认上传会登记作品并提交知乎同步。' }}</p><button :disabled="busy" @click="emit('close')">{{ receipt || draftReceipt ? '完成' : '取消' }}</button><template v-if="!receipt && !draftReceipt"><button :disabled="busy || dirty || !preview?.total" @click="saveDraft">保存本地，稍后推送</button><button class="primary-action" :disabled="busy || dirty || !preview?.ready" @click="submit">{{ busy ? '处理中…' : `确认上传 ${preview?.ready || 0} 条` }}</button></template></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.work-import-overlay{z-index:1100;padding:24px}.work-import-card{width:min(1080px,96vw);max-height:92vh;display:flex;flex-direction:column}.dialog-header{align-items:flex-start}.dialog-header p{font-size:13px;color:var(--ink-soft);margin:7px 0 0}.work-import-body{overflow:auto;padding:24px;min-height:0}.import-file{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px;border:1px dashed var(--line,#d6d2cc);background:var(--paper,#faf9f6)}.import-file strong{word-break:break-all}.import-file p,.import-help{color:var(--ink-soft);font-size:12px;line-height:1.8;margin:7px 0}.file-input{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}.import-settings{padding:0;border:0;min-width:0;margin:20px 0}.import-controls,.mapping-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.import-controls label,.mapping-grid label{display:flex;flex-direction:column;gap:8px;font-size:12px;font-weight:600;min-width:0}.import-controls input,.import-controls select,.mapping-grid select{width:100%;min-width:0;box-sizing:border-box;padding:9px;border:1px solid var(--line,#d6d2cc);background:transparent;color:inherit;font:inherit;border-radius:2px}.import-mapping{margin:18px 0;padding:14px 0;border-block:1px solid var(--line,#dedad4)}.import-mapping summary{cursor:pointer;font-size:13px}.mapping-grid{margin-top:16px}.defaults{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}.import-recheck{margin-top:6px}.import-summary{display:grid;grid-template-columns:repeat(4,1fr);background:var(--paper,#f5f4f0);border:1px solid var(--line,#dedad4);margin:16px 0}.import-summary>div{padding:14px 20px;display:flex;flex-direction:column;gap:7px}.import-summary span{font-size:12px;color:var(--ink-soft)}.import-summary strong{font-size:25px;font-weight:600}.stale{opacity:.5}.preview-toolbar,.preview-pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0;font-size:12px}.preview-toolbar label{display:flex;align-items:center;gap:10px}.preview-toolbar select{padding:7px;background:transparent;border:1px solid var(--line,#ddd)}.import-table{overflow:auto;border:1px solid var(--line,#dedad4)}.import-table table{width:100%;min-width:730px;border-collapse:collapse;font-size:12px}.import-table th,.import-table td{text-align:left;padding:12px;vertical-align:top;border-bottom:1px solid var(--line,#e7e3de)}.import-table th{background:var(--paper,#f5f4f0);font-weight:600;white-space:nowrap}.import-table td:last-child{min-width:180px;max-width:280px}.import-table small{display:block;color:var(--ink-soft);line-height:1.6;margin-top:5px}.import-url{display:block;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.import-status{display:inline-block;padding:3px 7px;background:#ecebe6;color:#555}.import-status.ready,.import-status.created{color:#28624b;background:#e4eee7}.import-status.invalid{color:#964639;background:#f1ded9}.import-error{padding:10px 12px;color:#964639;background:#f1ded9;font-size:13px;line-height:1.7;margin-bottom:12px}.import-result{padding:18px;background:#e4eee7;color:#28624b;font-size:14px;line-height:1.8}.import-result p{margin:5px 0 0;font-size:12px}.import-footer{align-items:center;flex-wrap:wrap;flex-shrink:0}.import-footer p{flex:1;font-size:12px;line-height:1.6;color:var(--ink-soft);margin:0 12px 0 0}.work-import-card button{cursor:pointer}.work-import-card button:disabled{cursor:wait;opacity:.5}@media(max-width:640px){.work-import-overlay{padding:10px}.work-import-card{max-height:95vh;width:100%}.work-import-body{padding:16px}.import-controls,.mapping-grid{grid-template-columns:1fr}.import-summary>div{padding:12px 8px}.import-summary strong{font-size:22px}.import-footer p{flex-basis:100%;margin-bottom:10px}.import-file{padding:14px}.import-file .primary-action{white-space:nowrap}}
</style>
