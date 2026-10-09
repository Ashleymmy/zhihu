<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {DataGrid,type DataGridRow} from '@zhihu-koc/shared-components'
import {errorText,requestKey,type EngineContext} from './context'
const props=defineProps<{context:EngineContext;batchId?:string;keywordId?:string}>()
const emit=defineEmits<{changed:[]}>()
interface Work {bindingId:string;keyword:string;executorName:string;verificationStatus:string;evidenceId:string|null;workUrl:string|null;description:string|null;status:string|null;reason:string|null;canSubmit:boolean;canReview:boolean;canResolve:boolean}
const grid=ref<InstanceType<typeof DataGrid>>(),list=ref<Work[]>([]),selected=ref<Work|null>(null),page=ref(1),total=ref(0),busy=ref(false),error=ref(''),formError=ref(''),url=ref(''),description=ref(''),reject=ref(false),reason=ref('')
const rows=computed<DataGridRow[]>(()=>list.value.map(work=>({id:work.bindingId,title:work.keyword,
 status:{key:work.verificationStatus==='disputed'?'disputed':work.status??'missing',label:work.verificationStatus==='disputed'?'作品有争议':work.status==='pending'?'作品待核验':work.status==='rejected'?'作品已退回':'还没有登记作品',tone:work.status==='pending'?'warning':'danger',description:'补齐并核验后，相关报表自动更新。'},
 cells:{executor:work.executorName},next:work.verificationStatus==='disputed'?{actor:'运营',text:'核实作品归属',action:{key:'detail',label:work.canResolve?'核实作品争议':'查看作品'}}:{actor:work.status==='pending'?'团长或运营':work.executorName,text:work.status==='pending'?'核验作品':'补登记作品',action:{key:'detail',label:work.canReview?'核验作品':work.status==='pending'?'查看作品':'补登记作品'}},viewKeys:['all']})))
async function load(){busy.value=true;error.value='';try{const result=await props.context.http.get<{list:Work[];total:number}>('/evidence/historical-tasks',{...props.context.scope,...(props.batchId?{batchId:props.batchId}:{}),...(props.keywordId?{keywordId:props.keywordId}:{}),page:page.value,pageSize:25});list.value=result.list;total.value=result.total;if(selected.value)selected.value=list.value.find(work=>work.bindingId===selected.value?.bindingId)??null}catch(e){error.value=errorText(e)}finally{busy.value=false}}
function inspect(row:DataGridRow){selected.value=list.value.find(work=>work.bindingId===row.id)??null;url.value='';description.value='';reason.value='';reject.value=false;formError.value=''}
async function save(accept?:boolean){if(!selected.value)return;busy.value=true;formError.value='';try{
 const work=selected.value;
 if(work.canResolve)await props.context.http.post('/evidence-bindings/'+work.bindingId+'/dispute',{...props.context.scope,resolve:true,reason:reason.value,requestKey:requestKey()})
 else if(accept===undefined)await props.context.http.post('/evidence',{...props.context.scope,bindingId:work.bindingId,url:url.value,description:description.value,requestKey:requestKey()})
 else await props.context.http.post('/evidence/'+work.evidenceId+'/review',{...props.context.scope,accept,reason:accept?'已核对历史作品和执行人':reason.value,requestKey:requestKey()})
 await load();emit('changed')
 }catch(e){formError.value=errorText(e)}finally{busy.value=false}}
watch(()=>[props.context.scope.projectId,props.context.scope.accountId,props.batchId,props.keywordId],()=>{page.value=1;selected.value=null;void load()},{immediate:true})
</script>
<template>
 <section v-if="list.length||error" class="historical-works">
  <h3>历史作品待处理</h3>
  <p v-if="error" role="alert">{{error}} <button @click="load">再试一次</button></p>
  <DataGrid ref="grid" title="历史作品待处理" title-label="关键词" :rows="rows" :columns="[{key:'executor',label:'执行人'}]" :busy="busy" @inspect="inspect" @action="grid?.inspect($event.row)">
   <template #detail>
    <div v-if="selected" class="historical-form">
     <p>执行人：{{selected.executorName}}</p>
     <p v-if="formError" class="form-error" role="alert">{{formError}}</p>
     <template v-if="selected.evidenceId">
      <a :href="selected.workUrl??''" target="_blank" rel="noopener noreferrer">打开原作品 ↗</a><p>{{selected.description}}</p>
      <p v-if="selected.reason">{{selected.reason}}</p>
     </template>
     <template v-if="selected.verificationStatus==='disputed'"><p>下一步：运营核实作品归属，解除争议后继续核验。</p><form v-if="selected.canResolve" @submit.prevent="save()"><label>核实结果<input v-model="reason" required maxlength="500" /></label><button class="primary" :disabled="busy">解除争议</button></form></template>
     <template v-else-if="selected.status==='pending'">
      <form v-if="selected.canReview" @submit.prevent="save(!reject)">
       <template v-if="reject"><label>哪里需要补充<input v-model="reason" required maxlength="500" /></label><button class="primary" :disabled="busy">退回补充</button><button type="button" @click="reject=false">取消</button></template>
       <template v-else><button class="primary" :disabled="busy">核验通过</button><button type="button" :disabled="busy" @click="reject=true">退回补充</button></template>
      </form>
      <p v-else>下一步：团长或运营核验作品，通过后自动更新金额。</p>
     </template>
     <form v-else-if="selected.canSubmit" @submit.prevent="save()">
      <label>作品链接<input v-model="url" type="url" required maxlength="2048" placeholder="粘贴已发布作品的链接" /></label>
      <label>作品名称<input v-model="description" required maxlength="1000" /></label>
      <button class="primary" :disabled="busy">{{busy?'正在保存…':'保存作品'}}</button>
     </form>
     <p v-else>这项任务已停止新增作品，运营核对任务状态后继续。</p>
    </div>
   </template>
  </DataGrid>
  <div v-if="total>25" class="pagination"><button :disabled="busy||page===1" @click="page--;load()">上一页</button><span>第 {{page}} 页，共 {{total}} 项</span><button :disabled="busy||page*25>=total" @click="page++;load()">下一页</button></div>
 </section>
</template>
<style scoped>
.historical-works{margin-top:20px}.historical-form{display:grid;gap:16px;overflow-wrap:anywhere}.historical-form p{margin:0}.historical-form form{display:flex;gap:12px;flex-wrap:wrap}.historical-form label{display:grid;gap:8px;width:100%}.historical-form input{box-sizing:border-box;width:100%;min-height:44px;padding:10px;font:inherit;border:1px solid var(--line,#dce3e5);border-radius:8px}.historical-form button,.pagination button{min-height:44px;padding:10px 16px;border:1px solid var(--line,#dce3e5);border-radius:8px;font:inherit;cursor:pointer}.historical-form button.primary{background:#195e62;color:white;border-color:#195e62}.historical-form button:disabled{opacity:.5;cursor:wait}.historical-form a{color:#195e62}.form-error{color:#a02f39}.pagination{display:flex;align-items:center;gap:12px;margin-top:16px}
</style>
