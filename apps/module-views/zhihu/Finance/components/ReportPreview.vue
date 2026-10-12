<script setup lang="ts">
import {ref} from 'vue'
import {ActionDialog} from '@zhihu-koc/shared-components'
import {moneyValue,cashText} from '../../bill-entry'
import {errorText,requestKey,type EngineContext} from '../../context'
const props=defineProps<{context:EngineContext}>()
const emit=defineEmits<{committed:[result:{id:string;from:string;to:string;duplicate:boolean}]}>()
interface Row {id:string;lineNumber:number;date:string;channel:string;keyword:string;orders:string|null;activations:string|null;settlement:string|null;error:string|null;status:string}
interface Preview {id:string;from:string;to:string;duplicate:boolean;previewHash:string;total:number;invalidRows:number;rows:Row[];status:string;reportType:'new_user'|'activation'}
const earningMoney=(value:string|null|undefined)=>value==null?'原表未提供':'¥'+cashText(moneyValue(value))
const dragging=ref(false),file=ref<File|null>(null),fileInput=ref<HTMLInputElement|null>(null)
const reportType=ref<'new_user'|'activation'>('new_user'),busy=ref(false),error=ref(''),open=ref(false),preview=ref<Preview|null>(null),page=ref(1),rows=ref<Row[]>([])
let previewKey=requestKey(),commitKey=requestKey()
function reset(){previewKey=requestKey();commitKey=requestKey();preview.value=null;rows.value=[];page.value=1;error.value=''}
async function run(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{await fn()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
function selectFile(selected?:File){if(busy.value||!selected)return;file.value=selected;reset();void run(inspect)}
function dropFile(event:DragEvent){dragging.value=false;if(busy.value)return;if(fileInput.value)fileInput.value.value='';selectFile(event.dataTransfer?.files?.[0])}
async function inspect(){
 if(!file.value)return
 const form=new FormData()
 for(const [k,v] of Object.entries({projectId:props.context.scope.projectId,accountId:props.context.scope.accountId,reportType:reportType.value,requestKey:previewKey}))form.append(k,v)
 form.append('file',file.value)
 preview.value=await props.context.http.postForm<Preview>('/workbench/import/preview',form)
 rows.value=preview.value.rows;page.value=1;open.value=true
}
async function changePage(next:number){
 if(!preview.value)return
 const r=await props.context.http.get<{rows:{id:string;lineNumber:number;normalizedJson:Row|string;errorText:string|null;processingStatus:string}[]}>('/imports/'+preview.value.id,{...props.context.scope,page:next,pageSize:100})
 rows.value=r.rows.map(r=>({...typeof r.normalizedJson==='string'?JSON.parse(r.normalizedJson):r.normalizedJson,id:r.id,lineNumber:r.lineNumber,error:r.errorText,status:r.processingStatus}));page.value=next
}
async function commit(){
 if(!preview.value)return
 await props.context.http.post('/workbench/import/'+preview.value.id+'/commit',{...props.context.scope,previewHash:preview.value.previewHash,requestKey:commitKey})
 open.value=false;emit('committed',preview.value)
}
async function resume(batch:{id:string;fileName:string;reportKind:string}){
 await run(async()=>{const blob=await props.context.http.getBlob('/imports/'+batch.id+'/file?'+new URLSearchParams({projectId:props.context.scope.projectId,accountId:props.context.scope.accountId}));file.value=new File([blob],batch.fileName,{type:blob.type});reportType.value=batch.reportKind==='activation'?'activation':'new_user';reset();await inspect()})
}
function chooseFile(kind?:string){if(busy.value)return;if(kind)reportType.value=kind==='activation'?'activation':'new_user';if(fileInput.value){fileInput.value.value='';fileInput.value.click()}}
defineExpose({resume,chooseFile})
</script>
<template>
 <section class="upload-step">
  <h2>上传与预览</h2><p>选择报表后先预览，核对无误再导入。</p>
  <fieldset class="typepick" :disabled="busy"><legend>报表类型</legend><label><input type="radio" v-model="reportType" value="new_user" @change="reset"/>拉新订单</label><label><input type="radio" v-model="reportType" value="activation" @change="reset"/>拉活</label></fieldset>
  <div class="drop" :class="{dragging}" :aria-busy="busy" @dragover.prevent="dragging=!busy" @dragleave.prevent="dragging=false" @drop.prevent="dropFile">
   <template v-if="busy"><p role="status">正在读取报表，请稍候…</p></template>
   <template v-else><h3>拖拽报表文件到这里，或</h3><p class="muted">支持 Excel 或 CSV，上传后先核对内容。</p><button type="button" class="primary" @click="chooseFile()">选择文件并分析</button></template>
   <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" hidden :disabled="busy" @change="selectFile(($event.target as HTMLInputElement).files?.[0])"/>
   <p v-if="file" class="selected-file">{{file.name}}</p>
  </div>
  <div v-if="file&&!busy&&!error" class="actions"><button @click="preview?open=true:run(inspect)">查看报表预览</button></div>
  <p v-if="error&&!open" role="alert">{{error}} <button :disabled="busy" @click="run(inspect)">重试预览</button></p>
  <ActionDialog :open="open" title="确认报表内容" :busy="busy" wide @close="open=false">
   <div v-if="preview" class="upload-preview">
    <h3>{{file?.name}}</h3><p>{{preview.reportType==='activation'?'拉活':'拉新'}} · {{preview.from}} 至 {{preview.to}}</p>
    <p>共 {{preview.total}} 行 · {{preview.invalidRows}} 行需要修正</p>
    <p v-if="preview.duplicate" class="duplicate">这份报表已存在，确认后不会重复计账。</p>
    <p class="muted">关闭预览不会导入。有效行正常处理，有问题的行会保留供修正。</p>
    <div class="preview-rows">
     <table><thead><tr><th>行号</th><th>日期</th><th>渠道名称</th><th>关键词</th><th>{{preview.reportType==='activation'?'拉活量':'订单量'}}</th><th v-if="preview.reportType==='activation'">补贴金额</th><th>读取结果</th></tr></thead>
      <tbody><tr v-for="r in rows" :key="r.id" :class="{invalid:!!r.error}" :data-line="r.lineNumber">
       <td data-label="行号">{{r.lineNumber}}</td><td data-label="日期">{{r.date||'未识别'}}</td><td data-label="渠道名称">{{r.channel||'未识别'}}</td><td data-label="关键词">{{r.keyword||'关键词未识别'}}</td>
       <td :data-label="preview.reportType==='activation'?'拉活量':'订单量'">{{(preview.reportType==='activation'?r.activations:r.orders)??'未提供'}} {{preview.reportType==='activation'?'个':'单'}}</td>
       <td v-if="preview.reportType==='activation'" data-label="补贴金额">{{earningMoney(r.settlement)}}</td>
       <td data-label="读取结果"><span :class="r.error?'row-error':'row-valid'">{{r.error||'可导入'}}</span></td>
      </tr></tbody>
     </table>
    </div>
    <div class="actions pagination" v-if="preview.total>100"><button :disabled="busy||page===1" @click="run(()=>changePage(page-1))">上一页</button><span>第 {{page}} 页</span><button :disabled="busy||page*100>=preview.total" @click="run(()=>changePage(page+1))">下一页</button></div>
    <p v-if="error" role="alert">{{error}}</p>
    <div class="dialog-actions"><button :disabled="busy" @click="open=false">返回检查</button><button class="primary" :disabled="busy||preview.total===0||preview.total===preview.invalidRows" @click="run(commit)">{{busy?'正在提交…':'确认导入有效行'}}</button></div>
   </div>
  </ActionDialog>
 </section>
</template>
<style scoped>
.upload-step{border:1px solid var(--line,#dce3e5);border-radius:12px;padding:22px;background:var(--paper,#fff);min-width:0}.upload-step h2{margin-top:0}.drop{margin-top:18px}.drop h3{margin:0 0 8px}.drop input[hidden]{display:none}.selected-file,.upload-preview h3{overflow-wrap:anywhere}.muted{color:var(--ink-soft,#637078)}fieldset{display:flex;gap:24px;border:0;padding:0;flex-wrap:wrap}fieldset label{display:flex;align-items:center;gap:8px}button{font:inherit;border:1px solid var(--line,#ccc);border-radius:8px;background:var(--paper,#fff);color:inherit;padding:10px 16px;cursor:pointer;min-height:44px}.primary{background:var(--primary,#195e62);color:#fff}button:disabled{opacity:.5}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px}.pagination{justify-content:center;margin-bottom:20px}.upload-preview h3{margin-top:0}.preview-rows{max-height:380px;overflow:auto;margin:20px 0;border:1px solid var(--line,#dce3e5);border-radius:10px}.preview-rows table{width:100%;border-collapse:collapse;table-layout:fixed;text-align:left;font-size:13px}.preview-rows th,.preview-rows td{padding:12px 10px;vertical-align:top;border-bottom:1px solid var(--line,#dce3e5);overflow-wrap:anywhere}.preview-rows th{position:sticky;top:0;background:#f2f5f4;font-weight:600}.preview-rows th:first-child{width:38px}.invalid{background:#fff1f1}.row-error,[role=alert]{color:#a02f39}.row-valid{color:#195e62}.duplicate{color:#926321}.dialog-actions{margin-top:20px}
@media(max-width:600px){.upload-step{padding:16px}.preview-rows{border:0;max-height:45dvh}.preview-rows table,.preview-rows tbody{display:block}.preview-rows thead{display:none}.preview-rows tr{display:grid;border:1px solid var(--line,#dce3e5);border-radius:8px;padding:12px;margin-bottom:12px;gap:8px}.preview-rows td{display:grid;grid-template-columns:65px minmax(0,1fr);gap:10px;border:0;padding:0}.preview-rows td::before{content:attr(data-label);color:#637078}}
</style>
