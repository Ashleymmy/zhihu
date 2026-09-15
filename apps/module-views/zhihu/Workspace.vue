<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch} from 'vue'
import type {HttpClient} from '@zhihu-koc/shared-services/core'
import {StaffManager} from '@zhihu-koc/shared-components'
import Keywords from './Keywords.vue'
import Prices from './Prices.vue'
import Finance from './Finance.vue'
import Works from './Works.vue'
import Issues from './Issues.vue'
import Channels from './Channels.vue'
import {errorText,type EngineOptions,type Option} from './context'
const props=defineProps<{http:HttpClient;coreHttp:HttpClient;role:string;userId:string;parentId?:string|null;adminDuty?:string;section?:string;activeTab?:string;initialProjectId?:string;initialAccountId?:string}>()
const emit=defineEmits<{navigate:[path:string]}>()
const projects=ref<Option[]>([]),accounts=ref<Option[]>([]),error=ref(''),loading=ref(false),ready=ref(false),tab=ref('keywords')
const scope=reactive({projectId:'',accountId:''})
const options=ref<EngineOptions>({tasks:[],channels:[],mappings:[],users:[]})
const section=computed(()=>props.section||'operations'),admin=computed(()=>props.role==='admin')
const title=computed(()=>section.value==='finance'?'财务做账':section.value==='wallet'?'收入与提现':admin.value?'运营管理':props.role==='leader'?'团队业务':'我的关键词')
const intro=computed(()=>section.value==='finance'?'上传报表，核对金额，办理付款。':section.value==='wallet'?'查看自己的收入、可提现余额和收款进度。':admin.value?'管理渠道、人员、关键词与审核待办。':props.role==='leader'?'分发关键词、管理团队单价和审核作品。':'选择关键词，提交作品，查看审核结果。')
const context=computed(()=>({http:props.http,coreHttp:props.coreHttp,scope:{...scope},role:props.role,userId:props.userId,parentId:props.parentId??null,adminDuty:props.adminDuty??'all',options:options.value}))
const tabs=computed(()=>[{key:'keywords',label:'关键词'}, {key:'works',label:props.role==='creator'?'审核进度':'作品审核'},...(props.role==='creator'?[]:[{key:'prices',label:'定价规则'},{key:'people',label:'人员与权限'}]),...(admin.value?[{key:'channels',label:'渠道与任务'},{key:'issues',label:'数据待办'}]:[])])
watch([()=>props.activeTab,tabs],()=>{tab.value=tabs.value.some(t=>t.key===props.activeTab)?props.activeTab!:'keywords'},{immediate:true})
let generation=0
async function refreshOptions(){const version=++generation;ready.value=false;loading.value=true;error.value='';try{const result=await props.http.get<EngineOptions>('/attribution-options',{...scope});if(version===generation){options.value=result;ready.value=true}}catch(e){if(version===generation)error.value=errorText(e)}finally{if(version===generation)loading.value=false}}
watch(()=>scope.projectId,async id=>{
 const version=++generation;ready.value=false;accounts.value=[];scope.accountId='';if(!id)return;loading.value=true;error.value=''
 try{
  const list=await props.coreHttp.get<(Option&{moduleId:string;status:string})[]>('/projects/'+id+'/integrations')
  if(version!==generation)return
  accounts.value=list.filter(a=>a.moduleId==='zhihu'&&a.status==='active')
  const requested=id===props.initialProjectId?props.initialAccountId:''
  let saved='';try{saved=localStorage.getItem('zhihu-account-'+props.userId+'-'+id)||''}catch{}
  let chosen=accounts.value.find(a=>a.id===requested)||accounts.value.find(a=>a.id===saved)
  if(!chosen&&accounts.value.length>1){
   const details=await Promise.all(accounts.value.map(async a=>({account:a,options:await props.http.get<EngineOptions>('/attribution-options',{projectId:id,accountId:a.id})})))
   if(version!==generation)return
   chosen=details.find(d=>d.options.mappings.length>0)?.account
  }
  scope.accountId=(chosen||accounts.value[0])?.id??''
  try{localStorage.setItem('zhihu-project-'+props.userId,id)}catch{}
 }catch(e){if(version===generation)error.value=errorText(e)}finally{if(version===generation)loading.value=false}
})
watch(()=>scope.accountId,id=>{if(id){try{localStorage.setItem('zhihu-account-'+props.userId+'-'+scope.projectId,id)}catch{}void refreshOptions()}})
onMounted(async()=>{try{projects.value=await props.coreHttp.get<Option[]>('/projects');let saved='';try{saved=localStorage.getItem('zhihu-project-'+props.userId)||''}catch{}scope.projectId=projects.value.find(p=>p.id===props.initialProjectId)?.id??projects.value.find(p=>p.id===saved)?.id??projects.value[projects.value.length-1]?.id??''}catch(e){error.value=errorText(e)}})
</script>
<template><section class="engine page-stack">
<header class="business-heading"><div><p class="business-eyebrow">知乎业务</p><h1>{{title}}</h1><p>{{intro}}</p></div><div class="project-picker"><label v-if="projects.length>1">业务项目<select v-model="scope.projectId"><option v-for="p in projects" :key="p.id" :value="p.id">{{p.name}}</option></select></label><span v-else>{{projects[0]?.name}}</span><label v-if="accounts.length>1">接入账号<select v-model="scope.accountId"><option v-for="a in accounts" :key="a.id" :value="a.id">{{a.name}}</option></select></label></div></header>
<p v-if="error" role="alert" class="engine-error">{{error}}</p><p v-if="loading" role="status">正在加载业务资料…</p>
<div v-if="!ready&&!loading&&!error" class="work-card empty-state"><h2>还没有可以使用的项目</h2><p>{{admin?'请先关联知乎接入账号并添加项目成员。':'请联系运营人员，将你加入业务项目并分配关键词。'}}</p><button v-if="admin&&adminDuty!=='finance'" @click="emit('navigate','/projects')">管理项目接入</button></div>
<template v-if="ready">
 <Finance v-if="section==='finance'||section==='wallet'" :key="scope.projectId+'-'+scope.accountId+'-'+section" :context="context" :wallet="section==='wallet'" @issues="emit('navigate','/modules/zhihu/operations?tab=issues')" />
 <template v-else><nav class="work-tabs" aria-label="工作事项"><button v-for="t in tabs" :key="t.key" :class="{active:tab===t.key}" :aria-current="tab===t.key?'page':undefined" @click="tab=t.key">{{t.label}}</button></nav>
 <Keywords v-if="tab==='keywords'" :key="scope.projectId+'-'+scope.accountId" :context="context" @refresh="refreshOptions" />
 <Works v-if="tab==='works'" :key="scope.projectId+'-'+scope.accountId" :context="context" />
 <Prices v-if="tab==='prices'&&role!=='creator'" :key="scope.projectId+'-'+scope.accountId" :context="context" />
 <Channels v-if="tab==='channels'&&admin" :context="context" @refresh="refreshOptions" @projects="emit('navigate','/projects')" />
 <Issues v-if="tab==='issues'&&admin" :context="context" />
 <template v-if="tab==='people'&&role!=='creator'"><div class="work-card"><h2>{{admin?'团长与达人':'团队成员'}}</h2><p>按姓名管理成员，项目授权决定可以参与哪些业务。</p><div class="engine-actions"><button class="primary" @click="emit('navigate','/team')">管理{{admin?'团长与达人':'团队成员'}}</button><button v-if="admin" @click="emit('navigate','/projects')">项目成员与授权</button></div></div><StaffManager v-if="admin&&(adminDuty??'all')==='all'" :http="coreHttp" /></template>
 </template>
</template></section></template>
<style>
.engine{width:100%;max-width:none;margin:0;color:var(--ink,#1b3035)}.business-heading,.section-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}.business-heading h1{font-size:28px;margin:4px 0 8px}.business-heading p,.section-heading p,.engine-note,.work-card>p{color:var(--ink-soft,#637078)}.business-eyebrow{font-size:12px;letter-spacing:.12em}.project-picker{display:flex;gap:14px;align-items:center}.work-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:6px;background:var(--paper,#fff);border:1px solid var(--line,#dce3e5);border-radius:12px}.engine button{padding:9px 15px;border:1px solid var(--line,#dce3e5);border-radius:8px;background:var(--paper,#fff);color:inherit;cursor:pointer}.engine button.primary,.work-tabs button.active{background:#195e62;color:#fff;border-color:#195e62}.work-tabs button{border-color:transparent}.engine button:disabled{opacity:.45;cursor:not-allowed}.engine form{display:flex;gap:16px;flex-wrap:wrap;align-items:end}.engine label{display:flex;flex-direction:column;gap:7px;flex:1;min-width:160px}.engine input,.engine select,.engine textarea{box-sizing:border-box;width:100%;min-height:40px;padding:9px 10px;border:1px solid var(--line,#c8d3d7);border-radius:7px;background:var(--paper,#fff);color:inherit}.engine textarea{min-height:90px}.work-card,.engine-panel,.service-note{padding:24px;border:1px solid var(--line,#dce3e5);border-radius:12px;background:var(--paper,#fff);margin-top:18px}.engine h2{font-size:19px;margin:0 0 12px}.work-card summary{cursor:pointer;font-weight:600;padding-bottom:12px}.engine-table{overflow:auto;margin:18px 0 12px}.engine table{width:100%;border-collapse:collapse;text-align:left}.engine th,.engine td{padding:13px 12px;border-bottom:1px solid var(--line,#e3e8ea);white-space:nowrap}.engine th{font-size:12px;color:var(--ink-soft,#637078)}.engine td .cell-note,.engine .cell-note{white-space:normal;max-width:360px;font-size:12px;color:var(--ink-soft,#637078)}.engine-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.engine-error{padding:12px;border-radius:8px;color:#a02f39;background:#fff1f1}.empty-state{text-align:center;padding:28px;color:var(--ink-soft,#637078)}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:20px}.metric-grid article{padding:22px;background:var(--paper,#fff);border:1px solid var(--line,#dce3e5);border-radius:12px}.metric-grid span{display:block;font-size:13px;color:var(--ink-soft,#637078)}.metric-grid strong{display:block;font-size:28px;margin-top:10px}.upload-box{padding:28px;background:#eef6f5;border:1px solid #c6dfdd;border-radius:14px}.upload-box p{color:#49666b}.period-filter{margin-top:20px}.period-filter label{flex:0 1 180px}.confirm-box{padding:24px;margin:20px 0;border:2px solid #8eb8b9;border-radius:12px;background:var(--paper,#fff)}.confirm-box h2,.confirm-box p{width:100%}.engine .check-label{flex-direction:row;align-items:center;margin:16px 0}.engine .check-label input{width:18px;min-height:18px}.attention{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:18px;padding:18px;background:#fff8e8;border-radius:12px}.plain-list{list-style:none;padding:0}.plain-list li{display:flex;justify-content:space-between;gap:16px;padding:12px 0}.engine small{display:block;margin-top:5px;color:var(--ink-soft,#637078)}.engine button:focus-visible,.engine input:focus-visible,.engine select:focus-visible{outline:2px solid #247c82;outline-offset:3px}@media(max-width:700px){.work-card,.upload-box,.engine-panel{padding:18px}.business-heading h1{font-size:24px}.engine label{min-width:130px}.project-picker{width:100%}.engine .metric-grid strong{font-size:24px}}

/* Keep grid items and long account names within the available page width. */
.engine {
  min-width: 0;
  max-width: 100%;
  grid-template-columns: minmax(0, 1fr);
}
.engine > *, .engine .work-card, .engine .engine-panel, .engine .engine-table {
  min-width: 0;
  max-width: 100%;
}
.engine .business-heading > *, .engine .section-heading > * {
  min-width: 0;
  max-width: 100%;
}
.engine .project-picker { min-width: 0; max-width: 100%; flex-wrap: wrap; }
.engine label { min-width: min(160px, 100%); }
.engine input, .engine select, .engine textarea { min-width: 0; max-width: 100%; }
.engine .check-label input { flex: 0 0 18px; }
.engine .plain-list li { flex-wrap: wrap; }
.engine .plain-list li > span { min-width: 0; overflow-wrap: anywhere; }
.engine h1, .engine h2, .engine p, .engine .engine-error { overflow-wrap: anywhere; }
.engine .engine-table { overscroll-behavior-x: contain; }
@media (max-width: 700px) {
  .engine .business-heading, .engine .section-heading { gap: 12px; }
  .engine .project-picker { width: 100%; gap: 12px; }
  .engine .project-picker label { flex: 1 1 100%; min-width: 0; }
  .engine .work-card, .engine .engine-panel, .engine .service-note,
  .engine .upload-box, .engine .confirm-box { padding: 14px; }
  .engine .confirm-box { width: 100%; box-sizing: border-box; }
  .engine form { gap: 12px; }
  .engine form > label { flex: 1 1 100%; min-width: 0; }
  .engine button { min-height: 44px; max-width: 100%; white-space: normal; }
  .engine input, .engine select, .engine textarea { font-size: 16px; }
  .engine .engine-actions { gap: 8px; }
  .engine .work-tabs { gap: 6px; }
  .engine .work-tabs button { flex: 1 1 auto; }
  .engine .metric-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .engine .metric-grid article { min-width: 0; padding: 16px; }
  .engine .metric-grid strong { overflow-wrap: anywhere; }
  .engine .engine-table { width: 100%; overflow-x: auto; }
  .engine table { min-width: 560px; }
  .engine th, .engine td { padding: 10px; white-space: normal; overflow-wrap: anywhere; }
  .engine .plain-list li { gap: 8px; }
  .engine .plain-list li > span:first-child { flex: 1 1 100%; }
}



</style>
