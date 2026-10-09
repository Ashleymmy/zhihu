<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'
import {DetailDrawer} from '@zhihu-koc/shared-components'
import {upstreamReview} from './work-status'
import {errorText,requestKey,type EngineContext} from './context'
export interface ExecutionItem {keywordId:string;keyword:string;bindingId?:string;executorName?:string;reasonCode:string;next:string;retroFromDate?:string;legacyMode?:string}
interface Work {id:string;url:string;title:string|null;publishedAt:string|null;ownerName:string;syncStatus:string;status:string;syncError:string|null;zhihuStatusJson:unknown;canReview:boolean}
interface Progress {planId:string;bindingId:string|null;executorName:string|null;fromDate:string|null;verificationStatus:string|null;canSubmit:boolean;canResolve:boolean;works:Work[];evidence:{id:string;url:string;description:string;status:string;reason:string|null;canReview:boolean}[]}
const props=defineProps<{context:EngineContext;item:ExecutionItem}>()
const emit=defineEmits<{close:[];changed:[];navigate:[path:string]}>()
const busy=ref(false),error=ref(''),saved=ref(false),notice=ref(''),fromDate=ref(props.item.retroFromDate??''),url=ref(''),description=ref(''),progress=ref<Progress|null>(null)
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const disputeReason=ref('')
const canRecord=computed(()=>props.context.role==='admin'&&props.context.adminDuty!=='finance'&&!!props.item.bindingId&&['BINDING_MISSING','PERIOD_AMBIGUOUS'].includes(props.item.reasonCode))
const checkLabel=computed(()=>progress.value?.verificationStatus==='passed'?'已核对执行归属与作品':progress.value?.verificationStatus==='disputed'?'作品归属有争议':'执行记录待核对')
const workStatus=(w:Work)=>upstreamReview({source:'composition',...w,failureReason:w.syncError})
async function load(){progress.value=await props.context.http.get<Progress>('/keywords/'+props.item.keywordId+'/execution-progress',props.context.scope)}
async function run(action:()=>Promise<void>){busy.value=true;error.value='';try{await action()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
onMounted(()=>run(load))
async function save(){await props.context.http.post('/keywords/'+props.item.keywordId+'/execution-history',{...props.context.scope,bindingId:props.item.bindingId,fromDate:fromDate.value,url:url.value,description:description.value,requestKey:requestKey()});saved.value=true;notice.value='历史执行已保存，相关报表已自动更新。';await load();emit('changed')}
async function review(work:Work){await props.context.http.post('/keywords/'+props.item.keywordId+'/review-existing-work',{...props.context.scope,bindingId:progress.value!.bindingId,compositionId:work.id,requestKey:requestKey()});notice.value='已核验原作品，金额和待办已自动更新。';await load();emit('changed')}
async function reviewEvidence(id:string){await props.context.http.post('/evidence/'+id+'/review',{...props.context.scope,accept:true,reason:'已核对原作品与当前执行人',requestKey:requestKey()});notice.value='已核验原作品，金额和待办已自动更新。';await load();emit('changed')}
async function register(){await props.context.http.post('/evidence',{...props.context.scope,bindingId:progress.value!.bindingId,url:url.value,description:description.value,requestKey:requestKey()});notice.value='作品已登记，相关报表已更新。';await load();emit('changed')}
async function resolveDispute(){await props.context.http.post('/evidence-bindings/'+progress.value!.bindingId+'/dispute',{...props.context.scope,resolve:true,reason:disputeReason.value,requestKey:requestKey()});notice.value='核实结果已保存，金额和待办已自动更新。';await load();emit('changed')}
function task(){emit('close');emit('navigate','/tasks?'+new URLSearchParams({...props.context.scope,moduleId:'zhihu',taskId:props.item.keywordId}))}
</script>
<template>
 <DetailDrawer :open="true" :title="item.keyword+' · 执行与作品'" @close="emit('close')">
  <div class="execution-followup">
   <p v-if="progress">执行人：{{progress.executorName||'尚未指定'}}<span v-if="progress.fromDate"> · 从 {{progress.fromDate}} 开始</span></p>
   <strong v-if="progress">{{checkLabel}}</strong>
   <form v-if="progress?.canResolve" @submit.prevent="run(resolveDispute)"><label>作品归属核实结果<input v-model="disputeReason" required maxlength="500" /></label><button :disabled="busy">解除争议并更新报表</button></form>
   <p v-if="item.next&&progress?.verificationStatus!=='passed'">下一步：{{item.next}}</p>
   <p v-if="notice" role="status">{{notice}}</p><p v-if="error" role="alert">{{error}}</p>
   <h3>已有作品</h3>
   <ul v-if="progress?.works.length" class="existing-works"><li v-for="work in progress.works" :key="work.id">
    <strong>{{work.title||'已登记作品'}}</strong><span>{{work.ownerName}} · {{work.publishedAt||'未填写发布时间'}}</span>
    <a :href="work.url" target="_blank" rel="noopener noreferrer">打开原作品</a><span>{{workStatus(work).label}}</span><small v-if="workStatus(work).reason">{{workStatus(work).reason}}</small>
    <button v-if="work.canReview" :disabled="busy" @click="run(()=>review(work))">确认此作品属于当前执行人</button>
    <button v-if="canRecord&&!saved" @click="url=work.url;description=work.title||'沿用已登记的作品';fromDate=work.publishedAt?.slice(0,10)||fromDate">使用此作品补充历史执行</button>
   </li></ul>
   <ul v-if="progress?.evidence.length" class="existing-works"><li v-for="work in progress.evidence.filter(e=>!progress!.works.some(w=>w.url===e.url))" :key="work.id"><strong>{{work.description}}</strong><a :href="work.url" target="_blank" rel="noopener noreferrer">打开原作品</a><span>{{work.status==='passed'?'作品已核验':work.status==='rejected'?'作品已退回':'作品待核验'}}</span><p v-if="work.reason">{{work.reason}}</p><button v-if="work.canReview" :disabled="busy" @click="run(()=>reviewEvidence(work.id))">核验通过并更新报表</button></li></ul>
   <p v-if="progress&&!progress.works.length&&!progress.evidence.length">当前执行人还没有作品记录。下一步：{{progress.executorName||'执行人'}}：登记已经发布的作品。</p>
   <form v-if="progress?.canSubmit&&!progress.works.length&&!progress.evidence.length&&!canRecord" @submit.prevent="run(register)">
    <label>已发布的作品链接<input v-model="url" type="url" maxlength="2048" required /></label>
    <label>作品名称或说明<input v-model="description" maxlength="1000" required /></label>
    <button class="primary" :disabled="busy">登记作品并更新报表</button>
   </form>
   <form v-if="canRecord&&!saved" @submit.prevent="run(save)">
    <h3>补充历史执行</h3>
    <label>实际开始日期<input v-model="fromDate" type="date" :max="today" required /></label>
    <label>历史作品链接<input v-model="url" type="url" maxlength="2048" required /></label>
    <label>作品说明<textarea v-model="description" maxlength="1000" required /></label>
    <button class="primary" :disabled="busy">{{busy?'正在保存…':'保存历史执行并更新报表'}}</button>
   </form>
   <button v-if="context.adminDuty!=='finance'" @click="task">查看任务与登记作品</button>
   <button :disabled="busy" @click="run(async()=>{await load();emit('changed');notice='已刷新执行记录和财务结果。'})">{{busy?'正在读取…':'刷新处理结果'}}</button>
  </div>
 </DetailDrawer>
</template>
<style scoped>
.execution-followup,.execution-followup form,.execution-followup label,.existing-works,.existing-works li{display:grid;gap:12px}.execution-followup p,.execution-followup h3{margin:0;overflow-wrap:anywhere}.existing-works{list-style:none;padding:0;margin:0}.existing-works li{border:1px solid var(--line,#ddd);border-radius:6px;padding:12px;overflow-wrap:anywhere}.execution-followup input,.execution-followup textarea{box-sizing:border-box;width:100%;min-width:0;padding:10px;min-height:44px;font:inherit;border:1px solid var(--line,#ddd);background:var(--paper,#fff);color:inherit;border-radius:6px}.execution-followup button{min-height:44px;padding:10px;font:inherit;border:1px solid var(--line,#ddd);border-radius:6px;cursor:pointer}.execution-followup .primary{background:#195e62;color:#fff}.execution-followup button:disabled{opacity:.5}
</style>
