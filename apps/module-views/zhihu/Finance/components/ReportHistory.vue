<script setup lang="ts">
import {computed,inject,onBeforeUnmount,ref,watch} from 'vue'
import type {PeriodState} from '../composables/usePeriodState'
import type {ImportBatch} from '../composables/useFinanceApi'
import {errorText,requestKey} from '../../context'
import Modal from './Modal.vue'
const props=defineProps<{period?:string;disabled?:boolean}>()
const state=inject<PeriodState>('financeState')!
const emit=defineEmits<{resume:[batch:ImportBatch];analyze:[batch:ImportBatch];busy:[value:boolean]}>()
interface Removal{id:string;fileName:string;reviewHash:string;rows:number;removed:number;restored:number;retained:number;corrections:number;period:{from:string;to:string}|null}
const list=ref<ImportBatch[]>([]),page=ref(1),total=ref(0),archived=ref(false),month=ref(props.period||'')
const error=ref(''),loadError=ref(''),notice=ref(''),busy=ref(false),loading=ref(false),target=ref<Removal|null>(null),targetBatch=ref<ImportBatch|null>(null),needsReview=ref(false)
const blocked=computed(()=>busy.value||props.disabled||state.confirmBusy.value)
let key=requestKey(),generation=0,disposed=false
const removalLabel=(b:ImportBatch|null)=>b?.status==='preview'?'删除上传记录':'撤销并移除'
const statusText=(b:ImportBatch)=>b.status==='preview'?'未导入':b.jobStatus==='failed'?'处理失败':b.status==='committed'?'处理中':'已导入'
const dateText=(b:ImportBatch)=>b.periodFrom?`${b.periodFrom} 至 ${b.periodTo||b.periodFrom}`:'未识别出有效业务日期'
async function load(){
 const n=++generation;loading.value=true;loadError.value=''
 try{
  const r=await state.context.http.get<{list:ImportBatch[];total:number}>('/imports',{...state.context.scope,page:page.value,pageSize:10,archived:String(archived.value),...(month.value?{period:month.value}:{})})
  if(disposed||n!==generation)return
  if(page.value>1&&!r.list.length&&r.total<(page.value-1)*10+1){page.value=Math.max(1,Math.ceil(r.total/10));await load();return}
  list.value=r.list;total.value=r.total
 }catch(e){if(!disposed&&n===generation){loadError.value=errorText(e);list.value=[]}}
 finally{if(!disposed&&n===generation)loading.value=false}
}
async function run(fn:()=>Promise<void>){if(blocked.value)return;busy.value=true;error.value='';try{await fn()}catch(e){if(!disposed)error.value=errorText(e)}finally{if(!disposed)busy.value=false}}
async function download(b:ImportBatch){const blob=await state.api.getImportFile(b.id),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=b.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function previewRemoval(b:ImportBatch){
 const result=await state.context.http.get<Removal>('/imports/'+b.id+'/withdrawal',state.context.scope)
 if(disposed)return
 target.value=result;targetBatch.value=b;needsReview.value=false;key=requestKey()
}
async function remove(){
 if(!target.value||needsReview.value)return
 const removed=target.value,id=removed.id,isPreview=targetBatch.value?.status==='preview'
 try{await state.context.http.post('/imports/'+id+'/withdrawal',{...state.context.scope,reviewHash:removed.reviewHash,requestKey:key})}
 catch(e){if(typeof e==='object'&&e&&'status'in e&&e.status===409)needsReview.value=true;throw e}
 if(disposed)return
 target.value=null;targetBatch.value=null
 notice.value=isPreview?'已删除未导入的上传记录，可以重新上传正确文件。':removed.corrections?'已撤销并移除。已确认账目保留，更正金额需要重新核对确认。':'已撤销并移除，这份报表对应的业绩和未确认金额已重新计算。'
 if(state.activeImport.value?.id===id){state.activeImport.value=null;state.importing.value=false}
 await load();await state.loadPeriod()
}
async function archive(b:ImportBatch){await state.context.http.post('/imports/'+b.id+'/archive',{...state.context.scope,archived:!archived.value,requestKey:requestKey()});notice.value=archived.value?'已恢复记录。':'已隐藏记录，金额仍然保留；可切换到已隐藏记录进行撤销。';await load()}
function filter(){page.value=1;notice.value='';void load()}
function close(){if(!blocked.value){target.value=null;targetBatch.value=null;error.value='';needsReview.value=false}}
watch(()=>props.period,p=>{month.value=p||'';filter()},{immediate:true})
watch(busy,value=>emit('busy',value))
onBeforeUnmount(()=>{disposed=true;generation++})
</script>
<template>
 <section class="card import-history" aria-label="上传报表管理">
  <div class="report-heading"><h2>上传记录</h2><p class="small muted">按报表撤销错误数据，核对后可重新上传。跨月文件会同时影响其中的所有日期。</p></div>
  <div class="report-filters">
   <label>业务月份<input v-model="month" type="month" :disabled="blocked" @change="filter" /></label>
   <button :disabled="blocked||loading" @click="month='';filter()">全部月份</button>
   <button :disabled="blocked||loading" @click="archived=!archived;filter()">{{archived?'返回有效上传记录':'查看已隐藏记录'}}</button>
   <button :disabled="blocked||loading" @click="load">刷新记录</button>
  </div>
  <p v-if="archived" class="banner warn">这些记录只是被隐藏，业绩和金额仍然有效。传错了请使用“撤销并移除”。</p>
  <p v-if="loadError" role="alert">{{loadError}} <button :disabled="blocked||loading" @click="load">重新加载</button></p>
  <p v-if="error&&!target" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
  <p v-if="loading" role="status">正在读取上传记录…</p>
  <ul class="import-history-list" :aria-busy="loading">
   <li v-for="b in list" :key="b.id" :data-report-id="b.id">
    <div class="report-info"><b>{{b.fileName}}</b><p class="small muted">{{b.reportKind==='activation'?'拉活':'拉新'}} · {{statusText(b)}} · {{b.rowCount}} 行</p><p class="small">业务日期：{{dateText(b)}}</p><p class="small muted">上传于 {{new Date(b.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}}</p></div>
    <div class="report-actions">
     <button v-if="b.status==='preview'" :disabled="blocked||loading" @click="emit('resume',b)">继续预览</button>
     <button v-else :disabled="blocked||loading" @click="emit('analyze',b)">查看处理结果</button>
     <button class="report-remove" :disabled="blocked||loading" @click="run(()=>previewRemoval(b))">{{removalLabel(b)}}</button>
     <details class="more-actions"><summary>更多</summary><div class="menu-actions"><button :disabled="blocked" @click="run(()=>download(b))">下载原文件</button><button :disabled="blocked" @click="run(()=>archive(b))">{{archived?'恢复记录':'隐藏记录（保留金额）'}}</button></div></details>
    </div>
   </li>
  </ul>
  <div v-if="!loading&&!loadError&&!list.length" class="empty"><p>{{month?'这个月份没有'+(archived?'已隐藏的':'有效的')+'上传记录，可查看全部月份。':archived?'没有已隐藏的上传记录。':'没有有效的上传记录，可返回账期列表上传正确报表。'}}</p><button v-if="month" :disabled="blocked" @click="month='';filter()">查看全部月份</button></div>
  <div v-if="total>10" class="row-actions"><button :disabled="blocked||loading||page===1" @click="page--;load()">上一页</button><span>第 {{page}} / {{Math.ceil(total/10)}} 页，共 {{total}} 份</span><button :disabled="blocked||loading||page*10>=total" @click="page++;load()">下一页</button></div>
  <Modal :open="!!target" :busy="blocked" :title="targetBatch?.status==='preview'?'删除这份上传记录':'撤销这份报表'" @close="close">
   <h3>{{targetBatch?.status==='preview'?'删除这份上传记录':'撤销这份报表'}}</h3>
   <p><b>{{target?.fileName}}</b> · {{target?.rows}} 行</p>
   <p v-if="target?.period">涉及日期：{{target.period.from}} 至 {{target.period.to}}。本次操作影响整份文件。</p>
   <p v-if="targetBatch?.status==='preview'">这份报表尚未确认导入，删除上传记录不会改变账目。</p>
   <template v-else>
    <dl class="removal-impact"><div><dt>撤回未确认业绩</dt><dd>{{target?.removed}} 条</dd></div><div><dt>恢复其他报表数据</dt><dd>{{target?.restored}} 条</dd></div><div><dt>仍有其他有效来源</dt><dd>{{target?.retained}} 条</dd></div><div><dt>已确认账目需更正</dt><dd>{{target?.corrections}} 条</dd></div></dl>
    <p>撤回这份报表的业绩和未确认金额；其他有效报表会保留。撤销后可重新上传。</p>
    <p v-if="target?.corrections" class="banner warn">已确认账目和实际发放记录不会删除。系统生成更正后，需要返回账期重新核对确认。</p>
   </template>
   <p v-if="error" role="alert">{{error}}</p>
   <div class="footer"><button :disabled="blocked" @click="close">取消</button><button v-if="needsReview" class="primary" :disabled="blocked" @click="run(()=>previewRemoval(targetBatch!))">重新核对影响</button><button v-else class="primary" :disabled="blocked||loading" @click="run(remove)">{{busy?'正在处理…':targetBatch?.status==='preview'?'确认删除上传记录':'确认撤销并移除'}}</button></div>
  </Modal>
 </section>
</template>
<style scoped>
h2{margin:0}.report-heading{margin-bottom:18px}.report-filters,.report-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.report-filters{align-items:end;margin-bottom:14px}.report-filters label{display:grid;gap:6px;font-size:13px}ul{list-style:none;padding:0}li{display:flex;gap:18px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:20px 0;border-bottom:1px solid var(--line)}.report-info{flex:1 1 280px;min-width:0}.report-info p{margin:6px 0}b{overflow-wrap:anywhere}.report-remove{color:var(--danger,#a72f34)}summary{cursor:pointer}.more-actions{position:relative}.more-actions>summary{padding:8px 12px}.menu-actions{display:grid;gap:6px;position:absolute;right:0;z-index:3;background:white;border:1px solid var(--line);padding:8px;border-radius:8px;min-width:180px}[role=alert]{color:var(--danger)}.removal-impact{display:grid;gap:10px}.removal-impact>div{display:flex;justify-content:space-between;gap:12px}.removal-impact dd{margin:0;font-weight:600}@media(max-width:600px){.report-actions{width:100%;gap:8px}.report-actions button{padding:9px 10px}.report-info{flex-basis:100%}.report-filters label{width:100%}.report-filters input{width:100%;box-sizing:border-box}.removal-impact>div{flex-wrap:wrap}}
</style>
