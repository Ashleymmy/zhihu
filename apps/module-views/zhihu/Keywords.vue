<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch,onUnmounted,nextTick} from 'vue'
import {fetchAllPages} from '@zhihu-koc/shared-services'
import {ActionDialog} from '@zhihu-koc/shared-components'
import {errorText,requestKey,type EngineContext} from './context'
import {keywordProgress,type KeywordSummary} from './keyword-progress'
const props=defineProps<{context:EngineContext;initialSearch?:string;initialCreate?:boolean}>(),emit=defineEmits<{refresh:[];navigate:[path:string]}>()
interface Word{mappingId?:string;landingUrl?:string;popularizeType?:number;ownershipConflict?:number;canEditFailed?:number;canCopyFailed?:number;canDeleteFailed?:number;allocationReady:number;usageReady?:number;hasUsageHistory?:number;planStatus?:string;hasUpstreamPlan?:number;readOnly?:number;planId:string;taskName?:string;compositionCount?:number;ownerName?:string;id:string;keyword:string;taskId:string;lifecycleStatus:string;upstreamStatus:string;syncStatus:string;syncError:string|null;priorityEnded:number;bindingId:string|null;executorId:string|null;leaderId:string|null;releaseStatus:string;usedEverAt:string|null;verificationStatus:string;executorName?:string}
const list=ref<Word[]>([]),total=ref(0),page=ref(1),search=ref(props.initialSearch??''),busy=ref(false),error=ref(''),notice=ref(''),createOpen=ref(!!props.initialCreate)
const editForm=reactive({taskId:'',mappingId:'',landingUrl:''})
const selected=ref<Word|null>(null),action=ref(''),target=ref(''),reason=ref(''),editKeyword=ref(''),operationKey=ref(requestKey())
const form=reactive({keyword:'',taskId:props.context.options.tasks[0]?.id||'',mappingId:props.context.options.mappings[0]?.id||'',channelId:props.context.options.channels[0]?.id||'',landingUrl:'',popularizeType:0})
const prices=ref<{versionId:string;taskId:string;payeeId:string;price:string;priceStatus:string;startDay:string;endDay:string|null}[]>([])
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const admin=computed(()=>props.context.role==='admin')
const hasTeamLeader=computed(()=>props.context.options.hasTeamLeader??!!props.context.parentId)
const createKey=ref(requestKey())
const createForm=ref<HTMLElement|null>(null)
function revealCreate(){if(createOpen.value)void nextTick(()=>createForm.value?.scrollIntoView({block:'center',behavior:'smooth'}))}
watch(createOpen,revealCreate)
onMounted(revealCreate)
function openCreate(){createOpen.value=!createOpen.value;if(createOpen.value)createKey.value=requestKey()}
async function createWord(){await post('/keywords',{...form,mappingId:form.mappingId||undefined,channelId:form.channelId||undefined},createKey.value);createOpen.value=false;form.keyword='';notice.value=admin.value?'关键词已进入公共词库，等待同步就绪后领取或分发。':props.context.role==='leader'?'关键词已归属你的团队，等待知乎创建成功后分配或使用。':'关键词已绑定本人，等待同步就绪后登记作品。'}
const summary=ref<KeywordSummary|null>(null),readAt=ref('')
const members=computed(()=>props.context.options.users.filter(u=>action.value==='distribute'?u.role==='leader'||u.role==='creator':u.id===selected.value?.leaderId||u.role==='creator'&&u.parentId===selected.value?.leaderId))
watch(()=>[props.context.options.tasks,props.context.options.mappings],()=>{
 if(!form.taskId) form.taskId=props.context.options.tasks[0]?.id||''
 if(!form.mappingId) form.mappingId=props.context.options.mappings[0]?.id||''
 if(!form.channelId) form.channelId=props.context.options.channels[0]?.id||''
},{deep:true})
watch(()=>props.initialCreate,value=>{if(value&&!createOpen.value)openCreate()})
watch(()=>props.initialSearch,value=>{search.value=value??'';page.value=1;void run(async()=>{})})
function price(w:Word){const p=prices.value.find(p=>p.taskId===w.taskId&&p.payeeId===props.context.userId&&p.priceStatus==='published'&&p.startDay<=today&&(!p.endDay||p.endDay>today));return p?'¥'+Number(p.price)+' / 单':'等待设置单价'}
async function load(){const r=await props.context.http.get<{list:Word[];total:number;summary?:KeywordSummary;readAt?:string}>('/keywords',{...props.context.scope,page:page.value,pageSize:25,search:search.value});list.value=r.list;total.value=r.total;summary.value=r.summary??null;readAt.value=r.readAt??''}
async function run(fn:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await fn();await load()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
function post(path:string,data:object={},key:string=requestKey()){return props.context.http.post(path,{...props.context.scope,...data,requestKey:key})}
function choose(w:Word,a:string){
 if(a==='work'){emit('navigate','/modules/zhihu/works/new?'+new URLSearchParams({planId:w.planId,keyword:w.keyword,...props.context.scope}));return}
 Object.assign(editForm,{taskId:w.taskId,mappingId:w.mappingId||'',landingUrl:w.landingUrl||''});editKeyword.value=w.keyword;selected.value=w;action.value=a;target.value='';reason.value='';error.value='';operationKey.value=requestKey()
}
async function perform(){const w=selected.value;if(!w)return;
 if(['edit-retry','copy-retry','delete-failed'].includes(action.value)) {
  await post('/keywords/'+w.id+'/'+action.value,action.value==='delete-failed'?{}:{keyword:editKeyword.value.trim(),...editForm,popularizeType:0},operationKey.value);
  notice.value=action.value==='delete-failed'?'错误记录已从关键词列表移除，历史归属和作品保留。':'修改已提交，等待知乎创建成功后再使用。'
 }
 else if(action.value==='distribute')await post('/keywords/'+w.id+'/distribute',{targetId:target.value},operationKey.value)
 else await post('/bindings/'+w.bindingId+'/'+action.value,{executorId:target.value||undefined,reason:reason.value||undefined},operationKey.value)
 selected.value=null
}
let poll:ReturnType<typeof setInterval>|undefined
onMounted(()=>{poll=setInterval(()=>{if(!document.hidden&&!busy.value&&!selected.value)void run(async()=>{})},15000)})
onUnmounted(()=>{if(poll)clearInterval(poll)})
onMounted(()=>run(async()=>{prices.value=await fetchAllPages(params=>props.context.http.get<{list:typeof prices.value;total:number}>('/price-agreements',{...props.context.scope,...params}),100,row=>row.versionId)}))
</script>
<template><section class="work-card"><div class="section-heading"><div><h2>{{admin?'本地关键词管理':context.role==='leader'?'团队关键词':'我的关键词'}}</h2><p>{{admin?'创建的关键词先进入词库：前 30 分钟团长优先领取，之后独立达人也可以领取。':context.role==='leader'?'创建或领取关键词后分发给团队成员，也可以分配给自己使用。':'可自主创建关键词，创建后自动归属本人；关键词一经使用不可转给他人。'}}</p></div><button class="primary" :disabled="busy" @click="openCreate">创建关键词</button></div>
<p v-if="context.options.integrationMode==='simulation'" class="engine-note">当前是本地联测账号，关键词和作品用于测试，不会提交到真实知乎。</p>
<form ref="createForm" v-if="createOpen" class="confirm-box" @submit.prevent="run(createWord)"><label>推广任务<select v-model="form.taskId" required><option v-for="t in context.options.tasks" :key="t.id" :value="t.id">{{t.name}}</option></select></label><label v-if="context.options.mappings.length">渠道<select v-model="form.mappingId" required :disabled="!context.options.mappings.length"><option value="" disabled>请选择渠道</option><option v-for="m in context.options.mappings" :key="m.id" :value="m.id">{{m.channelName}}</option></select></label><label v-else>渠道<select v-model="form.channelId" required><option value="" disabled>请选择渠道</option><option v-for="c in context.options.channels" :key="c.id" :value="c.id">{{c.name}}</option></select></label><p v-if="!context.options.channels.length" class="engine-note">当前项目还没有接入渠道，请在“渠道与任务”中完成接入。</p><label>关键词<input v-model="form.keyword" required maxlength="128" /></label><label>推广内容链接<input v-model="form.landingUrl" type="url" required maxlength="1024" /></label><button class="primary" :disabled="busy||!form.taskId||(!form.mappingId&&!form.channelId)">创建</button><button type="button" @click="createOpen=false">取消</button></form>
<div v-if="admin" class="keyword-source" role="note">
<strong>{{context.options.integrationMode==='simulation'?'本地联测词库':'本地业务词库'}}</strong>
<p>汇总当前项目与账号下的新旧推广计划，并关联已有作品。历史计划保留原归属，每个计划只显示一次。</p>
<p v-if="context.options.integrationMode!=='simulation'">官方计划总数：暂不可读取。尚未接通知乎官方计划查询，本地数量不能作为知乎全部计划数量。</p>
<div v-if="summary" class="engine-actions" aria-label="本地提交统计">
<span>本地记录 {{total}}</span><span>创建成功 {{summary.created}}</span><span>待提交 {{summary.pending}}</span><span>提交中 / 结果待确认 {{summary.submitting}}</span><span>提交失败 {{summary.failed}}</span><span v-if="summary.simulated">联测记录 {{summary.simulated}}</span><span v-if="summary.unknown">待核实 {{summary.unknown}}</span>
</div><small>知乎创建成功后，未分配的关键词即可领取或由管理员分发；这不等同于知乎审核通过。</small>
<small v-if="readAt">本地数据读取时间：{{new Date(readAt).toLocaleString('zh-CN')}}</small>
<button type="button" :disabled="busy" @click="run(load)">刷新本地记录</button>
</div>
<form @submit.prevent="page=1;run(load)"><label>查找关键词<input v-model="search" placeholder="输入关键词" /></label><button :disabled="busy">搜索</button></form><p v-if="error" role="alert" class="engine-error">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
<div class="engine-table"><table><thead><tr><th>关键词 / 任务</th><th v-if="context.role!=='creator'">使用人</th><th v-else>适用单价</th><th>进度</th><th>操作</th></tr></thead><tbody><tr v-for="w in list" :key="w.id"><td>{{w.keyword}}<small>{{w.taskName||context.options.tasks.find(t=>t.id===w.taskId)?.name}}</small></td><td v-if="context.role!=='creator'">{{w.readOnly?(w.ownerName||'原计划归属'):w.executorId?context.options.users.find(u=>u.id===w.executorId)?.displayName||'项目成员':w.leaderId?(context.options.users.find(u=>u.id===w.leaderId)?.displayName||'团长')+'待分发':'尚未分发'}}</td><td v-else>{{price(w)}}</td><td>{{w.syncStatus==='failed'||w.ownershipConflict?keywordProgress(w):w.readOnly?(w.compositionCount?'已有作品，保留原归属':'历史计划，保留原归属'):keywordProgress(w)}}<small v-if="context.options.integrationMode==='simulation'">本地联测，未提交知乎</small><small v-if="w.usedEverAt && w.syncStatus!=='failed'">{{w.verificationStatus==='disputed'?'作品有争议':'已登记作品，查看提交结果'}}</small><small v-if="w.allocationReady">{{w.priorityEnded?'团长、独立达人可领取':'团长优先领取中（创建后 30 分钟）'}}</small><small v-if="w.syncError">{{w.syncError||'请联系管理员核对知乎接入'}}</small><small v-if="w.compositionCount">关联作品 {{w.compositionCount}} 条</small></td><td><router-link v-if="w.compositionCount" :to="{path:'/modules/zhihu/works',query:{planId:w.planId,keyword:w.keyword}}">查看关联作品</router-link><div class="engine-actions"><button v-if="w.canEditFailed" :disabled="busy" @click="choose(w,'edit-retry')">编辑并重试</button><button v-if="w.canCopyFailed" :disabled="busy" @click="choose(w,'copy-retry')">沿用信息新建</button><button v-if="w.canDeleteFailed" :disabled="busy" @click="choose(w,'delete-failed')">删除错误记录</button></div><div v-if="!w.readOnly" class="engine-actions">
<button v-if="admin&&w.allocationReady" class="primary" :disabled="busy" @click="choose(w,'distribute')">分发给成员</button>
<button v-if="admin&&w.syncStatus==='failed'&&!w.usedEverAt&&!w.canEditFailed&&!w.canDeleteFailed" :disabled="busy" @click="run(()=>post('/keywords/'+w.id+'/retry-upstream'))">重试同步</button>
<button v-if="!admin&&w.allocationReady&&(context.role==='leader'||!hasTeamLeader&&w.priorityEnded)" class="primary" :disabled="busy" @click="run(()=>post('/keywords/'+w.id+'/claim'))">领取关键词</button>
<button v-if="w.usageReady&&w.bindingId&&!w.usedEverAt&&!w.hasUsageHistory&&w.leaderId&&(admin||w.leaderId===context.userId)" :disabled="busy" @click="choose(w,'assign')">分发给达人</button>
<button v-if="w.usageReady&&w.bindingId&&w.executorId===context.userId&&(w.syncStatus==='synced'||w.syncStatus==='simulated')&&w.lifecycleStatus!=='retired'" class="primary" :disabled="busy" @click="choose(w,'work')">{{w.usedEverAt?'提交 / 补充作品':'提交作品并开始使用'}}</button>
<details v-if="w.bindingId"><summary>更多</summary><button v-if="!w.usedEverAt&&!w.hasUsageHistory&&w.releaseStatus!=='requested'" :disabled="busy" @click="choose(w,'request-release')">退回未使用关键词</button><button v-if="admin&&!w.hasUsageHistory&&w.releaseStatus==='requested'" :disabled="busy" @click="choose(w,'release')">审核退回</button><button v-if="w.usedEverAt&&w.lifecycleStatus!=='retired'" :disabled="busy" @click="choose(w,'stop')">停止使用</button></details>
</div></td></tr></tbody></table></div><p v-if="!list.length" class="empty-state">{{admin?'还没有关键词，请先创建。':context.role==='creator'?hasTeamLeader?'还没有关键词，可以自主创建，也可以等待团长分发。':'还没有关键词，可以自主创建或领取就绪的公共词。':'还没有关键词，可以自主创建或领取就绪的公共词。'}}</p>
<ActionDialog :open="!!selected" :title="selected ? (action==='assign'||action==='distribute'?'分配关键词 · ':action==='edit-retry'?'编辑并重试 · ':action==='copy-retry'?'沿用信息新建 · ':action==='delete-failed'?'删除错误记录 · ':'处理关键词 · ')+selected.keyword : '关键词操作'" :busy="busy" @close="selected=null">
 <form v-if="selected" @submit.prevent="run(perform)"><p v-if="error" role="alert">{{error}}</p><label v-if="action==='assign'||action==='distribute'">分配给<select v-model="target" required><option value="">选择成员</option><option v-for="u in members" :key="u.id" :value="u.id">{{u.displayName}}（{{u.role==='leader'?'团长':'达人'}}）</option></select></label><template v-else-if="action==='edit-retry'||action==='copy-retry'"><label>关键词<input v-model="editKeyword" required maxlength="128" /></label><label>推广任务<select v-model="editForm.taskId" required><option v-for="t in context.options.tasks" :key="t.id" :value="t.id">{{t.name}}</option></select></label><label>渠道<select aria-label="渠道" v-model="editForm.mappingId" required><option v-for="m in context.options.mappings" :key="m.id" :value="m.id">{{m.channelName}}</option></select></label><label>推广内容链接<input v-model="editForm.landingUrl" type="url" required maxlength="1024" /></label><p>已填入上次信息，以上内容都可以修改。提交后自动发送知乎。</p><p v-if="action==='copy-retry'">原词已有使用记录或已停用，本次创建新词；原归属及作品保留。</p></template><p v-else-if="action==='delete-failed'">确认从关键词列表移除此错误记录并停止后续使用？已有归属、作品和订单保留供追溯，不会重新开放领取。</p><template v-else><p>{{action==='stop'?'停止后保留历史归属和收入，请确认不再新增使用。':'未使用的关键词经运营审核后可以重新分发。'}}</p><label>原因<input v-model="reason" required maxlength="500" /></label></template><div class="dialog-actions"><button type="button" :disabled="busy" @click="selected=null">取消</button><button class="primary" :disabled="busy">{{busy?'正在保存…':'确认'}}</button></div></form>
</ActionDialog>
<div class="engine-actions" v-if="total>25"><button :disabled="page===1||busy" @click="page--;run(load)">上一页</button><span>第 {{page}} 页，本地共 {{total}} 条</span><button :disabled="page*25>=total||busy" @click="page++;run(load)">下一页</button></div>
</section></template>

<style scoped>
.keyword-source{padding:16px;margin:16px 0;border:1px solid var(--line,#dce3e5);border-radius:8px;background:var(--paper,#fff)}
.keyword-source p{margin:8px 0;line-height:1.6}.keyword-source button{margin-top:12px}
.engine-table th:last-child,.engine-table td:last-child{text-align:right;width:1%;min-width:220px;padding-right:12px}.engine-table td:last-child .engine-actions{justify-content:flex-end;flex-wrap:wrap}.engine-table td:last-child> a{display:block;margin-bottom:8px}.engine-table td:last-child details{text-align:right}.engine-table table{width:100%}
</style>
