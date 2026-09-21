<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch,onUnmounted} from 'vue'
import {fetchAllPages} from '@zhihu-koc/shared-services'
import {errorText,requestKey,type EngineContext} from './context'
import {keywordProgress,type KeywordSummary} from './keyword-progress'
const props=defineProps<{context:EngineContext;initialSearch?:string}>(),emit=defineEmits<{refresh:[]}>()
interface Word{allocationReady:number;planStatus?:string;hasUpstreamPlan?:number;readOnly?:number;planId:string;taskName?:string;compositionCount?:number;ownerName?:string;id:string;keyword:string;taskId:string;lifecycleStatus:string;upstreamStatus:string;syncStatus:string;syncError:string|null;priorityEnded:number;bindingId:string|null;executorId:string|null;leaderId:string|null;releaseStatus:string;usedEverAt:string|null;verificationStatus:string;executorName?:string}
const list=ref<Word[]>([]),total=ref(0),page=ref(1),search=ref(props.initialSearch??''),busy=ref(false),error=ref(''),notice=ref(''),createOpen=ref(false)
const selected=ref<Word|null>(null),action=ref(''),target=ref(''),reason=ref(''),work=reactive({url:'',description:''}),operationKey=ref(requestKey())
const form=reactive({keyword:'',taskId:props.context.options.tasks[0]?.id||'',mappingId:props.context.options.mappings[0]?.id||'',channelId:props.context.options.channels[0]?.id||'',landingUrl:'',popularizeType:0})
const prices=ref<{taskId:string;payeeId:string;price:string;priceStatus:string;startDay:string;endDay:string|null}[]>([])
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const admin=computed(()=>props.context.role==='admin')
const summary=ref<KeywordSummary|null>(null),readAt=ref('')
const members=computed(()=>props.context.options.users.filter(u=>action.value==='distribute'?u.role==='leader'||u.role==='creator':u.id===selected.value?.leaderId||u.role==='creator'&&u.parentId===selected.value?.leaderId))
watch(()=>[props.context.options.tasks,props.context.options.mappings],()=>{
 if(!form.taskId) form.taskId=props.context.options.tasks[0]?.id||''
 if(!form.mappingId) form.mappingId=props.context.options.mappings[0]?.id||''
 if(!form.channelId) form.channelId=props.context.options.channels[0]?.id||''
},{deep:true})
watch(()=>props.initialSearch,value=>{search.value=value??'';page.value=1;void run(async()=>{})})
function price(w:Word){const p=prices.value.find(p=>p.taskId===w.taskId&&p.payeeId===props.context.userId&&p.priceStatus==='published'&&p.startDay<=today&&(!p.endDay||p.endDay>today));return p?'¥'+Number(p.price)+' / 单':'等待设置单价'}
async function load(){const r=await props.context.http.get<{list:Word[];total:number;summary?:KeywordSummary;readAt?:string}>('/keywords',{...props.context.scope,page:page.value,pageSize:25,search:search.value});list.value=r.list;total.value=r.total;summary.value=r.summary??null;readAt.value=r.readAt??''}
async function run(fn:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await fn();await load()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
function post(path:string,data:object={},key:string=requestKey()){return props.context.http.post(path,{...props.context.scope,...data,requestKey:key})}
function choose(w:Word,a:string){selected.value=w;action.value=a;target.value='';reason.value='';work.url='';work.description='';operationKey.value=requestKey()}
async function perform(){const w=selected.value;if(!w)return;
 if(action.value==='work'){if(!w.usedEverAt)await post('/bindings/'+w.bindingId+'/activate',{},operationKey.value+'-use');await post('/evidence',{bindingId:w.bindingId,url:work.url,description:work.description||'已使用关键词 '+w.keyword},operationKey.value+'-work');notice.value='作品已提交，审核结果会显示在“审核进度”中。'}
 else if(action.value==='distribute')await post('/keywords/'+w.id+'/distribute',{targetId:target.value},operationKey.value)
 else await post('/bindings/'+w.bindingId+'/'+action.value,{executorId:target.value||undefined,reason:reason.value||undefined},operationKey.value)
 selected.value=null
}
let poll:ReturnType<typeof setInterval>|undefined
onMounted(()=>{poll=setInterval(()=>{if(!document.hidden&&!busy.value&&!selected.value)void run(async()=>{})},15000)})
onUnmounted(()=>{if(poll)clearInterval(poll)})
onMounted(()=>run(async()=>{prices.value=await fetchAllPages(params=>props.context.http.get<{list:typeof prices.value;total:number}>('/price-agreements',{...props.context.scope,...params}))}))
</script>
<template><section class="work-card"><div class="section-heading"><div><h2>{{admin?'本地关键词管理':context.role==='leader'?'团队关键词':'我的关键词'}}</h2><p>{{admin?'创建的关键词先进入词库：前 30 分钟团长优先领取，之后独立达人也可以领取。':context.role==='leader'?'领取后分发给团队成员，也可以自己使用。':'从这里提交作品，系统会自动记录关键词归属。'}}</p></div><button v-if="admin" class="primary" @click="createOpen=!createOpen">创建关键词</button></div>
<p v-if="context.options.integrationMode==='simulation'" class="engine-note">当前是本地联测账号，关键词和作品用于测试，不会提交到真实知乎。</p>
<form v-if="createOpen&&admin" class="confirm-box" @submit.prevent="run(async()=>{await post('/keywords',{...form,mappingId:form.mappingId||undefined,channelId:form.channelId||undefined});createOpen=false;form.keyword='';notice=context.options.integrationMode==='simulation'?'联测关键词已保存，准备完成后即可领取。前 30 分钟仅团长可见，之后向独立达人开放。':'关键词已进入词库，等待知乎同步成功后领取。前 30 分钟仅团长可见，之后向独立达人开放。'})"><label>推广任务<select v-model="form.taskId" required><option v-for="t in context.options.tasks" :key="t.id" :value="t.id">{{t.name}}</option></select></label><label v-if="context.options.mappings.length">渠道<select v-model="form.mappingId" required :disabled="!context.options.mappings.length"><option value="" disabled>请选择渠道</option><option v-for="m in context.options.mappings" :key="m.id" :value="m.id">{{m.channelName}}</option></select></label><label v-else>渠道<select v-model="form.channelId" required><option value="" disabled>请选择渠道</option><option v-for="c in context.options.channels" :key="c.id" :value="c.id">{{c.name}}</option></select></label><p v-if="!context.options.channels.length" class="engine-note">当前项目还没有接入渠道，请在“渠道与任务”中完成接入。</p><label>关键词<input v-model="form.keyword" required maxlength="128" /></label><label>推广内容链接<input v-model="form.landingUrl" type="url" required maxlength="1024" /></label><button class="primary" :disabled="busy||!form.taskId||(!form.mappingId&&!form.channelId)">创建</button><button type="button" @click="createOpen=false">取消</button></form>
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
<div class="engine-table"><table><thead><tr><th>关键词 / 任务</th><th v-if="context.role!=='creator'">使用人</th><th v-else>适用单价</th><th>进度</th><th>操作</th></tr></thead><tbody><tr v-for="w in list" :key="w.id"><td>{{w.keyword}}<small>{{w.taskName||context.options.tasks.find(t=>t.id===w.taskId)?.name}}</small></td><td v-if="context.role!=='creator'">{{w.readOnly?(w.ownerName||'原计划归属'):w.executorId?context.options.users.find(u=>u.id===w.executorId)?.displayName||'项目成员':w.leaderId?(context.options.users.find(u=>u.id===w.leaderId)?.displayName||'团长')+'待分发':'尚未分发'}}</td><td v-else>{{price(w)}}</td><td>{{w.readOnly?(w.compositionCount?'已有作品，保留原归属':'历史计划，保留原归属'):keywordProgress(w)}}<small v-if="context.options.integrationMode==='simulation'">本地联测，未提交知乎</small><small v-if="w.usedEverAt">{{w.verificationStatus==='passed'?'作品已通过':w.verificationStatus==='disputed'?'作品有争议':'等待作品审核'}}</small><small v-if="w.allocationReady">{{w.priorityEnded?'团长、独立达人可领取':'团长优先领取中（创建后 30 分钟）'}}</small><small v-if="w.syncStatus==='failed'">{{admin?w.syncError||'请检查知乎接入后重试同步':'请联系管理员核对知乎接入'}}</small><small v-if="w.compositionCount">关联作品 {{w.compositionCount}} 条</small></td><td><router-link v-if="w.compositionCount" :to="{path:'/modules/zhihu/works',query:{planId:w.planId,keyword:w.keyword}}">查看关联作品</router-link><div v-if="!w.readOnly" class="engine-actions">
<button v-if="admin&&w.allocationReady" class="primary" :disabled="busy" @click="choose(w,'distribute')">分发给成员</button>
<button v-if="admin&&w.syncStatus==='failed'&&!w.usedEverAt" :disabled="busy" @click="run(()=>post('/keywords/'+w.id+'/retry-upstream'))">重试同步</button>
<button v-if="!admin&&w.allocationReady&&(context.role==='leader'||!context.parentId&&w.priorityEnded)" class="primary" :disabled="busy" @click="run(()=>post('/keywords/'+w.id+'/claim'))">领取关键词</button>
<button v-if="w.bindingId&&!w.usedEverAt&&w.leaderId&&(admin||w.leaderId===context.userId)" :disabled="busy" @click="choose(w,'assign')">分发给达人</button>
<button v-if="w.bindingId&&w.executorId===context.userId&&w.lifecycleStatus!=='retired'" class="primary" :disabled="busy" @click="choose(w,'work')">{{w.usedEverAt?'提交 / 补充作品':'提交作品并开始使用'}}</button>
<details v-if="w.bindingId"><summary>更多</summary><button v-if="!w.usedEverAt&&w.releaseStatus!=='requested'" :disabled="busy" @click="choose(w,'request-release')">退回未使用关键词</button><button v-if="admin&&w.releaseStatus==='requested'" :disabled="busy" @click="choose(w,'release')">审核退回</button><button v-if="w.usedEverAt&&w.lifecycleStatus!=='retired'" :disabled="busy" @click="choose(w,'stop')">停止使用</button></details>
</div></td></tr></tbody></table></div><p v-if="!list.length" class="empty-state">{{admin?'还没有关键词，请先创建。':context.role==='creator'?context.parentId?'还没有团长分发给你的关键词。':'暂时没有可领取的关键词；新词前 30 分钟仅对团长开放。':'暂时没有可领取或已分发的关键词。'}}</p>
<form v-if="selected" class="confirm-box" @submit.prevent="run(perform)"><h2>{{selected.keyword}}</h2><template v-if="action==='work'"><label>作品链接<input v-model="work.url" type="url" required maxlength="2048" /></label><label>补充说明（可选）<input v-model="work.description" maxlength="1000" /></label></template><label v-else-if="action==='assign'||action==='distribute'">分发给<select v-model="target" required><option value="">选择成员</option><option v-for="u in members" :key="u.id" :value="u.id">{{u.displayName}}（{{u.role==='leader'?'团长':'达人'}}）</option></select></label><template v-else><p>{{action==='stop'?'停止后保留历史归属和收入，请确认不再新增使用。':'未使用的关键词经运营审核后可以重新分发。'}}</p><label>原因<input v-model="reason" required maxlength="500" /></label></template><button class="primary" :disabled="busy">{{action==='work'?'提交作品':'确认'}}</button><button type="button" @click="selected=null">取消</button></form>
<div class="engine-actions" v-if="total>25"><button :disabled="page===1||busy" @click="page--;run(load)">上一页</button><span>第 {{page}} 页，本地共 {{total}} 条</span><button :disabled="page*25>=total||busy" @click="page++;run(load)">下一页</button></div>
</section></template>

<style scoped>
.keyword-source{padding:16px;margin:16px 0;border:1px solid var(--line,#dce3e5);border-radius:8px;background:var(--paper,#fff)}
.keyword-source p{margin:8px 0;line-height:1.6}.keyword-source button{margin-top:12px}
</style>
