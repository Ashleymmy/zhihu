<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Composition, Plan } from '@zhihu-koc/shared-contracts/zhihu'
import { SearchableSelect } from '@zhihu-koc/shared-components'
import { fetchAllPages } from '@zhihu-koc/shared-services'
import { useAuthStore, apis, http } from '../context'
import { upstreamReview } from '@zhihu-koc/zhihu-module-views/work-status'
import WorkDetail, {type WorkDetailRecord} from '@zhihu-koc/zhihu-module-views/WorkDetail.vue'
import WorkImportDialog from '@zhihu-koc/zhihu-module-views/WorkImportDialog.vue'
import WorkImportDrafts from '@zhihu-koc/zhihu-module-views/WorkImportDrafts.vue'
import type { WorkImportOptions } from '@zhihu-koc/shared-services/zhihu'

const route=useRoute(), router=useRouter()
const registrationPage=computed(()=>route.path.endsWith('/works/new'))
function cancelRegistration(){showCreate.value=false;if(registrationPage.value)void router.push({path:'/modules/zhihu/works',query:{planId:selectedPlan.value,keyword:route.query.keyword}})}
type LinkedComposition=Composition & {assigneeName?:string;keywordProjectId?:string;keywordAccountId?:string}
const works = ref<LinkedComposition[]>([])
const detail=ref<LinkedComposition|null>(null)
const detailRecord=computed(()=>detail.value?({...detail.value,source:'composition',compositionId:detail.value.id,workUrl:detail.value.promoUrl,description:detail.value.title,executorName:detail.value.assigneeName} as WorkDetailRecord):null)
const detailScope=computed(()=>detail.value?.keywordProjectId&&detail.value?.keywordAccountId?{projectId:detail.value.keywordProjectId,accountId:detail.value.keywordAccountId}:undefined)
const page=ref(1),pageSize=25,keywordFilter=ref(String(route.query.keyword||''))
const selectedPlan=computed(()=>/^\d+$/.test(String(route.query.planId||''))?String(route.query.planId):undefined)
const total = ref(0)
const plans = ref<Plan[]>([])
const loading = ref(true)
const error = ref('')
const statusFilter = ref('')

const editingId=ref<string|null>(null)
const showCreate = ref(false)
const showImport = ref(false)
const draftsVersion = ref(0)
const importInitialFile = ref<File>()
const importInitialOptions = ref<WorkImportOptions>()
function resumeImport(file: File, options: WorkImportOptions) {
  importInitialFile.value = file
  importInitialOptions.value = options
  showImport.value = true
  void loadPlans()
}
const creating = ref(false)
const createError = ref('')
const plansError = ref('')
const planOptions = computed(() => plans.value.map(plan => ({ value: plan.id, label: `${plan.keyword}（${plan.channelName || '未标注渠道'}）`, detail: `计划编号：${plan.id}` })))
const plansLoading = ref(false)
let planSearchVersion = 0
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


let loadVersion=0
async function load() {
  const version=++loadVersion
  loading.value = true
  error.value = ''
  try {
    const data = await apis.story.listWorks({ page: page.value, pageSize, planId: selectedPlan.value, keyword: keywordFilter.value || undefined, status: statusFilter.value || undefined })
    if(version!==loadVersion)return
    works.value = data.list
    total.value = data.total
    const edit=String(route.query.edit||'');const work=data.list.find(w=>w.id===edit);if(work&&!showCreate.value){openEdit(work);void router.replace({query:{...route.query,edit:undefined}})}
  } catch (e: any) { if(version===loadVersion)error.value = e?.message ?? String(e) }
  finally { if(version===loadVersion)loading.value = false }
}

async function openCreate() {
  editingId.value=null
  showCreate.value = true
  createError.value = ''
  form.value.planId=selectedPlan.value ?? ''
  await loadPlans()
}

function openEdit(work: Composition) {
  editingId.value=work.id;showCreate.value=true;createError.value='';plansError.value='';plansLoading.value=false;
  const date=work.releaseTime?new Date(work.releaseTime):null;
  const local=date?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):'';
  form.value={planId:work.planId,mediaType:work.mediaType,mediaAccount:work.mediaAccount,compositionType:work.compositionType,compositionSubType:work.compositionSubType,title:work.title||'',promoUrl:work.promoUrl,releaseTime:local};
}
async function loadPlans() {
  const version = ++planSearchVersion
  plansLoading.value = true
  plansError.value = ''
  plans.value = []
  try {
    const result = await fetchAllPages(params => apis.plans.list({ ...params, purpose: 'composition' }))
    if (version !== planSearchVersion) return
    plans.value = result
    if (!result.some(plan => plan.id === form.value.planId)) {
      if (form.value.planId) plansError.value = '所选关键词当前不可登记作品，请返回关键词页面检查归属与状态。'
      form.value.planId = ''
    }
  } catch (e) {
    if (version === planSearchVersion) plansError.value = e instanceof Error ? e.message : '计划加载失败，请重试'
  } finally {
    if (version === planSearchVersion) plansLoading.value = false
  }
}

async function submitCreate() {
  if (creating.value) return
  createError.value = ''
  if (plansLoading.value || plansError.value || (!editingId.value && !plans.value.some(plan => plan.id === form.value.planId)) || !form.value.mediaAccount.trim() || !form.value.promoUrl.trim() || !form.value.releaseTime) {
    createError.value = '请完整填写计划、媒体账号、推广链接和发布时间'
    return
  }
  creating.value = true
  try {
    const payload = {
      planId: form.value.planId,
      mediaType: form.value.mediaType,
      mediaAccount: form.value.mediaAccount.trim(),
      compositionType: form.value.compositionType,
      compositionSubType: form.value.compositionSubType,
      title: form.value.title.trim() || null,
      promoUrl: form.value.promoUrl.trim(),
      releaseTime: new Date(form.value.releaseTime).toISOString(),
    }
    if(editingId.value)await apis.story.updateWork(editingId.value,payload);else await apis.story.createWork(payload)
    editingId.value=null
    showCreate.value = false
    form.value = { planId: '', mediaType: 'KOC抖音', mediaAccount: '', compositionType: 1, compositionSubType: 1, title: '', promoUrl: '', releaseTime: '' }
    if(registrationPage.value)await router.replace({path:'/modules/zhihu/works',query:{planId:selectedPlan.value,keyword:route.query.keyword}})
    await load()
  } catch (e: any) { createError.value = e?.message ?? String(e) }
  finally { creating.value = false }
}

watch(registrationPage,value=>{if(value)void openCreate();else showCreate.value=false},{immediate:true})
let poll:ReturnType<typeof setInterval>|undefined
watch(()=>[route.query.planId,route.query.keyword],()=>{keywordFilter.value=String(route.query.keyword||'');page.value=1;void load()})
onMounted(()=>{void load();poll=setInterval(()=>{if(!document.hidden&&!loading.value&&!showCreate.value&&!showImport.value)void load()},15000)})
onUnmounted(()=>{loadVersion++;planSearchVersion++;if(poll)clearInterval(poll)})
</script>

<template>
  <div class="page-stack">
    <router-link to="/modules/zhihu/history" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">02 / 作品管理</p>
        <h1>{{registrationPage?'登记作品':'作品管理'}}</h1>
        <p>登记后自动提交知乎，无需管理员逐条审核；失败时可直接修改原表单。</p>
      </div>
      <div v-if="!registrationPage" class="page-actions">
        <select v-model="statusFilter" @change="page=1;load()">
          <option value="">全部状态</option>
          <option value="pending">已登记</option>
          <option value="active">已发布</option>
          <option value="rejected">已拒绝</option>
          <option value="ended">已结束</option>
        </select>
        <button v-if="!registrationPage" class="primary-action" @click="router.push('/modules/zhihu/works/new')">登记作品</button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <template v-if="!registrationPage"><form class="page-actions" @submit.prevent="page=1;load()"><label>查找关键词<input v-model.trim="keywordFilter" maxlength="128" placeholder="与关键词管理使用相同关键词" /></label><button type="submit" :disabled="loading">搜索</button><button type="button" :disabled="loading" @click="load">刷新</button><router-link v-if="selectedPlan" to="/modules/zhihu/works">查看全部作品</router-link></form>
    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">作品列表</span>
        <span class="toolbar-count">{{ total }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!works.length" class="empty-panel"><span>还没有登记作品。点击「登记作品」开始。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>标题</th><th>所属计划</th><th>媒体账号</th><th>分类</th><th>提交与审核结果</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="w in works" :key="w.id">
              <td><strong>{{ w.title || '未命名作品' }}</strong><br /><a :href="w.promoUrl" target="_blank" style="color: var(--ink-soft); font-size: 12px;">{{ w.promoUrl.slice(0, 48) }}</a></td>
              <td style="font-size: 13px;"><router-link v-if="w.keywordProjectId&&w.keywordAccountId" :to="{path:'/modules/zhihu/operations',query:{projectId:w.keywordProjectId,accountId:w.keywordAccountId,keyword:w.keyword,tab:'keywords'}}">{{w.keyword}}</router-link><span v-else>{{w.keyword??'—'}}</span></td>
              <td style="font-size: 13px;">{{ w.mediaType }}<br /><small style="color: var(--ink-soft);">{{ w.mediaAccount }}</small></td>
              <td style="font-size: 13px;">{{ TYPE_OPTIONS.find(t => t.value === w.compositionType)?.label ?? '其他' }} / {{ SUB_TYPES.find(s => s.value === w.compositionSubType)?.label ?? '—' }}</td>

              <td>{{ upstreamReview({...w,source:'composition'}).label }}<small style="display:block">{{ upstreamReview({...w,source:'composition'}).reason }}</small></td>
              <td><button @click="detail=w">查看详情</button> <button v-if="w.canEdit" @click="openEdit(w)">修改并重新提交</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    <nav class="page-actions" aria-label="作品分页"><button :disabled="page===1||loading" @click="page--;load()">上一页</button><span>第 {{page}} 页，共 {{total}} 条作品</span><button :disabled="page*pageSize>=total||loading" @click="page++;load()">下一页</button></nav>
    </article>

    </template>
    <Teleport to="body" :disabled="registrationPage">
      <div v-if="showCreate" :class="registrationPage ? 'registration-page' : 'dialog-overlay'" @click.self="!registrationPage && cancelRegistration()">
        <div class="dialog-card" role="dialog" :aria-label="editingId?'修改作品':'登记作品'" :style="{width:registrationPage?'min(760px, 100%)':'min(520px, 92vw)'}">
          <div class="dialog-header">
            <h3>{{editingId?'修改作品':'作品信息'}}</h3>
            <button v-if="!editingId" type="button" class="work-batch-button" :disabled="creating" @click="showCreate = false; importInitialFile = undefined; importInitialOptions = undefined; showImport = true; loadPlans()">批量上传</button>
            <button type="button" class="dialog-close" @click="cancelRegistration">×</button>
          </div>
          <div class="dialog-body">
            <p v-if="createError" role="alert" style="color: var(--clay)">{{ createError }}</p>
            <div class="form-field">
              <label for="work-plan">所属计划</label>
              <input v-if="editingId" :value="works.find(w=>w.id===editingId)?.keyword||form.planId" readonly /><SearchableSelect v-else id="work-plan" v-model="form.planId" :options="planOptions" :loading="plansLoading" placeholder="输入关键词、渠道或计划编号搜索" />
              <small v-if="plansError" role="alert">{{ plansError }} <button type="button" @click="loadPlans">重新加载</button></small>
              <small v-else-if="!editingId">可按关键词、渠道或计划编号搜索，共 {{ plans.length }} 条可选计划</small>
            </div>
            <div class="form-field">
              <label for="work-mediaType">媒体类型</label>
              <select id="work-mediaType" v-model="form.mediaType">
                <option v-for="m in MEDIA_TYPES" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>
            <div class="form-field">
              <label for="work-mediaAccount">媒体账号</label>
              <input id="work-mediaAccount" v-model="form.mediaAccount" placeholder="发布作品的媒体账号名" />
            </div>
            <div class="form-field">
              <label>作品分类</label>
              <div style="display: flex; gap: 10px;">
                <select aria-label="作品类型" v-model="form.compositionType" style="flex: 1;" @change="form.compositionSubType = subTypeOptions[0]?.value ?? 11">
                  <option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
                <select aria-label="作品子分类" v-model="form.compositionSubType" style="flex: 1;">
                  <option v-for="s in subTypeOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
                </select>
              </div>
            </div>
            <div class="form-field">
              <label for="work-title">标题（可选）</label>
              <input id="work-title" v-model="form.title" maxlength="255" />
            </div>
            <div class="form-field">
              <label for="work-promoUrl">推广链接</label>
              <input id="work-promoUrl" v-model="form.promoUrl" type="url" placeholder="https://" />
            </div>
            <div class="form-field">
              <label for="work-releaseTime">发布时间</label>
              <input id="work-releaseTime" v-model="form.releaseTime" type="datetime-local" />
            </div>
          </div>
          <div class="dialog-footer">
            <button class="ghost-aurora" @click="cancelRegistration">取消</button>
            <button class="primary-action" :disabled="creating || plansLoading || !!plansError || !form.planId" @click="submitCreate">{{ creating ? '提交中...' : editingId?'保存并重新提交':'确认登记' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
    <WorkImportDrafts :api="apis.story" :refresh-key="draftsVersion" @resume="resumeImport" />
    <WorkImportDialog v-if="showImport" :api="apis.story" :plans="plans" :initial-plan-id="form.planId" :initial-file="importInitialFile" :initial-options="importInitialOptions" @close="showImport = false; if(registrationPage) showCreate = true" @imported="page = 1; load(); draftsVersion++" @saved="draftsVersion++" />
  </div>
<WorkDetail :work="detailRecord" :http="http" :scope="detailScope" @close="detail=null" />
</template>

<style scoped>
.work-batch-button { margin-left: auto; margin-right: 14px; padding: 7px 13px; border: 1px solid var(--line, #d6d2cc); border-radius: 2px; background: transparent; color: var(--ink, #20282d); font-size: 12px; font-weight: 600; cursor: pointer; }
.work-batch-button:hover { background: var(--paper, #f2f0ec); border-color: var(--ink-soft, #807b73); }
.work-batch-button:disabled { opacity: .5; cursor: wait; }
</style>

<style scoped>.registration-page{max-width:760px}.registration-page .dialog-card{max-height:none;box-shadow:none;border:1px solid var(--line);border-radius:12px}.registration-page .dialog-body{max-height:none}.registration-page .dialog-close{display:none}</style>
