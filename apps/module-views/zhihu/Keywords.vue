<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch,onUnmounted,nextTick} from 'vue'

import {ActionDialog} from '@zhihu-koc/shared-components'
import {errorText,executorOptions,requestKey,type EngineContext} from './context'
import {keywordProgress,type KeywordSummary} from './keyword-progress'
import NovelInfo from './NovelInfo.vue'
import AssignExecutor from './AssignExecutor.vue'
const props=defineProps<{context:EngineContext;initialView?:'all'|'available'|'owned';initialSearch?:string;initialCreate?:boolean}>(),emit=defineEmits<{refresh:[];navigate:[path:string]}>()
interface Word{canAssignRetro?:number;retroFromDate?:string;novelTitle?:string;novelUrl?:string;novelUrlOverride?:string;canEditNovel?:number;mappingId?:string;landingUrl?:string;popularizeType?:number;ownershipConflict?:number;canEditFailed?:number;canCopyFailed?:number;canDeleteFailed?:number;allocationReady:number;usageReady?:number;hasUsageHistory?:number;planStatus?:string;hasUpstreamPlan?:number;readOnly?:number;planId:string;taskName?:string;compositionCount?:number;ownerName?:string;id:string;keyword:string;taskId:string;lifecycleStatus:string;upstreamStatus:string;syncStatus:string;syncError:string|null;priorityEnded:number;bindingId:string|null;executorId:string|null;leaderId:string|null;releaseStatus:string;usedEverAt:string|null;verificationStatus:string;executorName?:string}
const list=ref<Word[]>([]),total=ref(0),page=ref(1),search=ref(props.initialSearch??''),busy=ref(false),error=ref(''),notice=ref(''),createOpen=ref(!!props.initialCreate)
const assignment=ref<Word|null>(null)
async function assigned(name:string){assignment.value=null;notice.value='已指定给 '+name+'，相关金额已重新计算。';await run(load)}
const editForm=reactive({taskId:'',mappingId:'',landingUrl:'',novel:{title:'',url:''}})
const selected=ref<Word|null>(null),action=ref(''),target=ref(''),reason=ref(''),editKeyword=ref(''),operationKey=ref(requestKey())
const form=reactive({keyword:'',taskId:props.context.options.tasks[0]?.id||'',mappingId:props.context.options.mappings[0]?.id||'',channelId:props.context.options.channels[0]?.id||'',landingUrl:'',popularizeType:0,novel:{title:'',url:''}})
const admin=computed(()=>props.context.role==='admin')
const hasTeamLeader=computed(()=>props.context.options.hasTeamLeader??!!props.context.parentId)
const createKey=ref(requestKey())
const createForm=ref<HTMLElement|null>(null)
function revealCreate(){if(createOpen.value)void nextTick(()=>createForm.value?.scrollIntoView({block:'center',behavior:'smooth'}))}
watch(createOpen,revealCreate)
onMounted(revealCreate)
function openCreate(){createOpen.value=!createOpen.value;if(createOpen.value)createKey.value=requestKey()}
async function createWord(){await post('/keywords',{...form,mappingId:form.mappingId||undefined,channelId:form.channelId||undefined},createKey.value);createOpen.value=false;form.keyword='';form.landingUrl='';form.novel={title:'',url:''};notice.value=admin.value?'关键词已进入公共词库，等待同步就绪后领取或分发。':props.context.role==='leader'?'关键词已归属你的团队，等待知乎创建成功后分配或使用。':'关键词已绑定本人，等待同步就绪后登记作品。'}
const summary=ref<KeywordSummary|null>(null)
const members=computed(()=>action.value==='distribute'?executorOptions(props.context):props.context.options.users.filter(u=>u.id===selected.value?.leaderId||u.role==='creator'&&u.parentId===selected.value?.leaderId))
watch(()=>[props.context.options.tasks,props.context.options.mappings],()=>{
 if(!form.taskId) form.taskId=props.context.options.tasks[0]?.id||''
 if(!form.mappingId) form.mappingId=props.context.options.mappings[0]?.id||''
 if(!form.channelId) form.channelId=props.context.options.channels[0]?.id||''
},{deep:true})
watch(()=>props.initialCreate,value=>{if(value&&!createOpen.value)openCreate()})
watch(()=>props.initialSearch,value=>{search.value=value??'';page.value=1;void run(async()=>{})})
function canRequestRelease(w:Word){return !w.usedEverAt&&!Number(w.hasUsageHistory)&&w.releaseStatus!=='requested'}
function canApproveRelease(w:Word){return admin.value&&!Number(w.hasUsageHistory)&&w.releaseStatus==='requested'}
function canStop(w:Word){return !!w.usedEverAt&&w.lifecycleStatus!=='retired'}
function hasMoreActions(w:Word){return !!w.bindingId&&(canRequestRelease(w)||canApproveRelease(w)||canStop(w))}
const newUserPrice=computed(()=>{const price=props.context.options.currentNewUserPrice;return price!==null&&price!==undefined?'¥'+price.replace(/(\.\d{2})0+$/,'$1')+' / 单':'待财务完善'})
async function load(){const r=await props.context.http.get<{list:Word[];total:number;summary?:KeywordSummary;readAt?:string}>('/keywords',{...props.context.scope,page:page.value,pageSize:25,search:search.value,view:props.initialView??'all'});list.value=r.list;total.value=r.total;summary.value=r.summary??null}
async function run(fn:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await fn();await load()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
function post(path:string,data:object={},key:string=requestKey()){return props.context.http.post(path,{...props.context.scope,...data,requestKey:key})}
function choose(w:Word,a:string){
 if(a==='work'){emit('navigate','/modules/zhihu/works/new?'+new URLSearchParams({planId:w.planId,keyword:w.keyword,...props.context.scope}));return}
 Object.assign(editForm,{taskId:w.taskId,mappingId:w.mappingId||'',landingUrl:w.landingUrl||'',novel:{title:w.novelTitle||'',url:(a==='novel'?w.novelUrl:w.novelUrlOverride)||''}});editKeyword.value=w.keyword;selected.value=w;action.value=a;target.value='';reason.value='';error.value='';operationKey.value=requestKey()
}
async function openFailed(){
 for(let candidatePage=1;candidatePage<=Math.ceil(total.value/25);candidatePage++){
  const result=await props.context.http.get<{list:Word[];total:number}>('/keywords',{...props.context.scope,page:candidatePage,pageSize:25,search:search.value,view:props.initialView??'all'});
  const failed=result.list.find(w=>w.syncStatus==='failed'&&(w.canEditFailed||w.canCopyFailed));
  if(failed){page.value=candidatePage;list.value=result.list;choose(failed,failed.canEditFailed?'edit-retry':'copy-retry');return}
 }
 notice.value='暂无可重试的失败记录，状态已刷新。'
}
async function perform(){const w=selected.value;if(!w)return;
 if(action.value==='novel'){await post('/keywords/'+w.id+'/novel',{novel:editForm.novel},operationKey.value);notice.value='小说资料已保存'}
 else if(['edit-retry','copy-retry','delete-failed'].includes(action.value)) {
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
onMounted(()=>run(async()=>{}))
</script>
<template><section class="work-card"><div class="section-heading"><div><h2>{{admin?'关键词管理':context.role==='leader'?'团队关键词':'我的关键词'}}</h2><p>{{admin?'创建的关键词先进入词库：前 30 分钟团长优先领取，之后独立达人也可以领取。':context.role==='leader'?'创建或领取关键词后分发给团队成员，也可以分配给自己使用。':'可自主创建关键词，创建后自动归属本人；关键词一经使用不可转给他人。'}}</p></div><button class="primary" :disabled="busy" @click="openCreate">创建关键词</button></div>
<p v-if="context.options.integrationMode==='simulation'" class="engine-note">当前是本地联测账号，关键词和作品用于测试，不会提交到真实知乎。</p>
<form ref="createForm" v-if="createOpen" class="confirm-box" @submit.prevent="run(createWord)"><label>推广活动<select v-model="form.taskId" required><option v-for="t in context.options.tasks" :key="t.id" :value="t.id">{{t.name}}</option></select></label><label v-if="context.options.mappings.length">渠道<select v-model="form.mappingId" required :disabled="!context.options.mappings.length"><option value="" disabled>请选择渠道</option><option v-for="m in context.options.mappings" :key="m.id" :value="m.id">{{m.channelName}}</option></select></label><label v-else>渠道<select v-model="form.channelId" required><option value="" disabled>请选择渠道</option><option v-for="c in context.options.channels" :key="c.id" :value="c.id">{{c.name}}</option></select></label><p v-if="!context.options.channels.length" class="engine-note">当前项目还没有接入渠道，请在“渠道与任务”中完成接入。</p><label>关键词<input v-model="form.keyword" required maxlength="128" /></label><label>小说原名（选填）<input v-model="form.novel.title" maxlength="128" placeholder="填写对应小说的原始书名" /></label><label>小说原文链接<input v-model="form.landingUrl" type="url" required maxlength="1024" /></label><button class="primary" :disabled="busy||!form.taskId||(!form.mappingId&&!form.channelId)">创建</button><button type="button" @click="createOpen=false">取消</button></form>
<div v-if="summary?.failed" class="keyword-failures" role="status"><span>{{summary.failed}} 个关键词提交知乎失败</span><button type="button" :disabled="busy" @click="run(openFailed)">重试</button></div>
<form @submit.prevent="page=1;run(load)"><label>查找关键词或小说<input v-model="search" placeholder="输入关键词或小说原名" /></label><button :disabled="busy">搜索</button></form><p v-if="error" role="alert" class="engine-error">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
<div class="engine-table"><table><thead><tr><th>关键词 / 小说</th><th v-if="context.role!=='creator'">使用人</th><th v-else>拉新单价</th><th>进度</th><th>操作</th></tr></thead><tbody><tr v-for="w in list" :key="w.id"><td>{{w.keyword}}<small>{{w.taskName||context.options.tasks.find(t=>t.id===w.taskId)?.name}}</small><NovelInfo :title="w.novelTitle" :url="w.novelUrl||w.landingUrl" /><button v-if="w.canEditNovel" type="button" class="novel-edit" :disabled="busy" @click="choose(w,'novel')">编辑小说资料</button></td><td v-if="context.role!=='creator'" data-label="使用人">{{w.readOnly?(w.ownerName||'原计划归属'):w.executorId?context.options.users.find(u=>u.id===w.executorId)?.displayName||'项目成员':w.leaderId?(context.options.users.find(u=>u.id===w.leaderId)?.displayName||'团长')+'待分发':'没有执行人'}}</td><td v-else data-label="拉新单价">{{newUserPrice}}</td><td data-label="进度">{{w.syncStatus==='failed'||Number(w.ownershipConflict)===1?keywordProgress(w):w.readOnly?(w.compositionCount?'已有作品，保留原归属':'历史计划，保留原归属'):w.canAssignRetro?'没有执行人':keywordProgress(w)}}<small v-if="context.options.integrationMode==='simulation'">本地联测，未提交知乎</small><small v-if="w.compositionCount">已登记 {{w.compositionCount}} 个作品<span v-if="w.verificationStatus==='disputed'"> · 作品有争议</span></small><small v-if="w.allocationReady">{{w.priorityEnded?'团长、独立达人可领取':'团长优先领取中（创建后 30 分钟）'}}</small><small v-if="w.syncError">{{w.syncError||'请联系管理员核对知乎接入'}}</small></td><td><router-link v-if="w.compositionCount" :to="{path:'/modules/zhihu/works',query:{planId:w.planId,keyword:w.keyword}}">查看关联作品</router-link><div class="engine-actions"><button v-if="w.canEditFailed" :disabled="busy" @click="choose(w,'edit-retry')">编辑并重试</button><button v-if="w.canCopyFailed" :disabled="busy" @click="choose(w,'copy-retry')">沿用信息新建</button><button v-if="w.canDeleteFailed" :disabled="busy" @click="choose(w,'delete-failed')">删除错误记录</button></div><div v-if="!w.readOnly" class="engine-actions">
<button v-if="w.canAssignRetro" :disabled="busy" @click="assignment=w">指定执行人</button>
<button v-if="admin&&context.adminDuty!=='finance'&&w.allocationReady" :disabled="busy" @click="run(()=>post('/keywords/'+w.id+'/claim'))">我来执行</button><button v-if="admin&&w.allocationReady" class="primary" :disabled="busy" @click="choose(w,'distribute')">分发给成员</button>
<button v-if="admin&&w.syncStatus==='failed'&&!w.usedEverAt&&!w.canEditFailed&&!w.canDeleteFailed" :disabled="busy" @click="run(()=>post('/keywords/'+w.id+'/retry-upstream'))">重试同步</button>
<button v-if="!admin&&w.allocationReady&&(context.role==='leader'||!hasTeamLeader&&w.priorityEnded)" class="primary" :disabled="busy" @click="run(()=>post('/keywords/'+w.id+'/claim'))">领取关键词</button>
<button v-if="w.usageReady&&w.bindingId&&!w.usedEverAt&&!Number(w.hasUsageHistory)&&w.leaderId&&(admin||w.leaderId===context.userId)" :disabled="busy" @click="choose(w,'assign')">分配使用人</button>
<button v-if="w.usageReady&&w.bindingId&&w.executorId===context.userId&&(w.syncStatus==='synced'||w.syncStatus==='simulated')&&w.lifecycleStatus!=='retired'" class="primary" :disabled="busy" @click="choose(w,'work')">{{w.usedEverAt?'提交 / 补充作品':'提交作品并开始使用'}}</button>
<details v-if="hasMoreActions(w)"><summary>更多</summary><button v-if="canRequestRelease(w)" :disabled="busy" @click="choose(w,'request-release')">退回未使用关键词</button><button v-if="canApproveRelease(w)" :disabled="busy" @click="choose(w,'release')">审核退回</button><button v-if="canStop(w)" :disabled="busy" @click="choose(w,'stop')">停止使用</button></details>
</div></td></tr></tbody></table></div><p v-if="!list.length" class="empty-state">{{admin?'还没有关键词，请先创建。':context.role==='creator'?hasTeamLeader?'还没有关键词，可以自主创建，也可以等待团长分发。':'还没有关键词，可以自主创建或领取就绪的公共词。':'还没有关键词，可以自主创建或领取就绪的公共词。'}}</p>
<AssignExecutor v-if="assignment" :context="context" :keyword-id="assignment.id" :keyword="assignment.keyword" :from-date="assignment.retroFromDate" @close="assignment=null" @saved="assigned" />
<ActionDialog :open="!!selected" :title="selected ? (action==='novel'?'编辑小说资料 · ':action==='assign'||action==='distribute'?'分配关键词 · ':action==='edit-retry'?'编辑并重试 · ':action==='copy-retry'?'沿用信息新建 · ':action==='delete-failed'?'删除错误记录 · ':'处理关键词 · ')+selected.keyword : '关键词操作'" :busy="busy" @close="selected=null">
 <form v-if="selected" @submit.prevent="run(perform)"><p v-if="error" role="alert">{{error}}</p><label v-if="action==='assign'||action==='distribute'">分配给<select v-model="target" required><option value="">选择成员</option><option v-for="u in members" :key="u.id" :value="u.id">{{u.displayName}}（{{u.id===context.userId?'本人':u.role==='leader'?'团长':'达人'}}）</option></select></label><template v-else-if="action==='novel'"><label>小说原名<input v-model="editForm.novel.title" maxlength="128" placeholder="填写对应小说的原始书名" /></label><label>小说原文链接<input v-model="editForm.novel.url" type="url" maxlength="1024" placeholder="粘贴可阅读原文的链接" /></label><p>保存后，使用该关键词的成员可查看和复制原文链接。</p></template><template v-else-if="action==='edit-retry'||action==='copy-retry'"><label>关键词<input v-model="editKeyword" required maxlength="128" /></label><label>推广活动<select v-model="editForm.taskId" required><option v-for="t in context.options.tasks" :key="t.id" :value="t.id">{{t.name}}</option></select></label><label>渠道<select aria-label="渠道" v-model="editForm.mappingId" required><option v-for="m in context.options.mappings" :key="m.id" :value="m.id">{{m.channelName}}</option></select></label><label>推广内容链接<input v-model="editForm.landingUrl" type="url" required maxlength="1024" /></label><label>小说原名（选填）<input v-model="editForm.novel.title" maxlength="128" /></label><label>小说原文链接（选填）<input v-model="editForm.novel.url" type="url" maxlength="1024" placeholder="留空则使用上方推广内容链接" /></label><p>已填入上次信息，以上内容都可以修改。提交后自动发送知乎。</p><p v-if="action==='copy-retry'">原词已有使用记录或已停用，本次创建新词；原归属及作品保留。</p></template><p v-else-if="action==='delete-failed'">确认从关键词列表移除此错误记录并停止后续使用？已有归属、作品和订单保留供追溯，不会重新开放领取。</p><template v-else><p>{{action==='stop'?'停止后保留历史归属和收入，请确认不再新增使用。':'未使用的关键词经运营审核后可以重新分发。'}}</p><label>原因<input v-model="reason" required maxlength="500" /></label></template><div class="dialog-actions"><button type="button" :disabled="busy" @click="selected=null">取消</button><button class="primary" :disabled="busy">{{busy?'正在保存…':'确认'}}</button></div></form>
</ActionDialog>
<div class="engine-actions" v-if="total>25"><button :disabled="page===1||busy" @click="page--;run(load)">上一页</button><span>第 {{page}} 页，本地共 {{total}} 条</span><button :disabled="page*25>=total||busy" @click="page++;run(load)">下一页</button></div>
</section></template>

<style scoped>
.novel-edit{margin-top:8px;font-size:13px;padding:5px 8px}
.keyword-failures{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0;padding:12px 16px;background:#fff1ed;color:#964639;border-radius:8px}
.engine-table table{width:100%;min-width:760px;table-layout:fixed}
.engine-table th:first-child{width:38%}.engine-table th:nth-child(2){width:15%}.engine-table th:nth-child(3){width:25%}
.engine-table th,.engine-table td{white-space:normal;overflow-wrap:anywhere;vertical-align:top}
.engine-table th:last-child,.engine-table td:last-child{text-align:right;padding-right:12px}.engine-table td:last-child .engine-actions{justify-content:flex-end;flex-wrap:wrap}.engine-table td:last-child> a{display:block;margin-bottom:8px}.engine-table td:last-child details{text-align:right}.engine-table button{max-width:100%;white-space:normal}
@media(max-width:700px){
 .engine-table{overflow:visible}
 .engine-table table,.engine-table tbody{display:block;width:100%;min-width:0!important}
 .engine-table thead{display:none}
 .engine-table tbody{display:grid;gap:12px}
 .engine-table tr{display:block;border:1px solid var(--line,#dce3e5);border-radius:10px;padding:10px;min-width:0}
 .engine-table td{display:block;width:100%!important;box-sizing:border-box;border:0;padding:6px 0;min-width:0}
 .engine-table td[data-label]::before{content:attr(data-label);display:block;font-size:12px;color:var(--ink-soft,#637078);margin-bottom:4px}
 .engine-table td:last-child{text-align:left;padding-right:0}
 .engine-table td:last-child .engine-actions{justify-content:flex-start}
 .engine-table td:last-child details{text-align:left}
}
</style>
