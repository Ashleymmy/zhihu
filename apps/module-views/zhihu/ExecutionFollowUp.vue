<script setup lang="ts">
import {computed,nextTick,onMounted,ref} from 'vue'
import {DetailDrawer} from '@zhihu-koc/shared-components'
import HistoricalWorks from './HistoricalWorks.vue'
import {errorText,requestKey,type EngineContext} from './context'
export interface ExecutionItem {keywordId:string;keyword:string;bindingId?:string;executorName?:string;reasonCode:string;next:string;retroFromDate?:string;legacyMode?:string}
const props=defineProps<{context:EngineContext;item:ExecutionItem}>()
const emit=defineEmits<{close:[];changed:[];navigate:[path:string]}>()
const busy=ref(false),error=ref(''),saved=ref(false),notice=ref(''),fromDate=ref(props.item.retroFromDate??''),url=ref(''),description=ref('')
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const reviewing=ref(props.context.adminDuty!=='finance'&&props.item.legacyMode==='historical_registered'&&props.item.reasonCode.startsWith('WORK_')),reviewHost=ref<HTMLElement|null>(null)
onMounted(()=>{void nextTick(()=>reviewHost.value?.scrollIntoView({block:'start'}))})
const canRecord=computed(()=>props.context.role==='admin'&&props.context.adminDuty!=='finance'&&!!props.item.bindingId&&['BINDING_MISSING','PERIOD_AMBIGUOUS'].includes(props.item.reasonCode))
async function save(){busy.value=true;error.value='';try{await props.context.http.post('/keywords/'+props.item.keywordId+'/execution-history',{...props.context.scope,bindingId:props.item.bindingId,fromDate:fromDate.value,url:url.value,description:description.value,requestKey:requestKey()});saved.value=true;reviewing.value=true;notice.value='历史执行已保存，相关报表已自动更新。请在下方核验作品。';emit('changed');await nextTick();reviewHost.value?.scrollIntoView({block:'start'})}catch(e){error.value=errorText(e)}finally{busy.value=false}}
function refreshed(){notice.value='作品处理结果已保存，金额和待办已自动更新。';emit('changed')}
function task(){emit('close');emit('navigate','/tasks?'+new URLSearchParams({...props.context.scope,moduleId:'zhihu',taskId:props.item.keywordId}))}
</script>
<template>
 <DetailDrawer v-if="!reviewing" :open="true" :title="item.keyword+' · 执行进度'" @close="emit('close')">
  <div class="execution-followup">
   <p v-if="item.executorName">执行人：{{item.executorName}}</p><p v-if="!saved">下一步：{{item.next}}</p>
   <p v-if="notice" role="status">{{notice}}</p><p v-if="error" role="alert">{{error}}</p>
   <form v-if="canRecord&&!saved" @submit.prevent="save">
    <p>已经执行过的，补齐实际开始日期和原作品；保存后自动处理此前的报表。</p>
    <label>实际开始日期<input v-model="fromDate" type="date" :max="today" required /></label>
    <label>历史作品链接<input v-model="url" type="url" maxlength="2048" required /></label>
    <label>作品说明<textarea v-model="description" maxlength="1000" required /></label>
    <button class="primary" :disabled="busy">{{busy?'正在保存…':'保存历史执行并更新报表'}}</button>
   </form>
   <button v-if="context.adminDuty!=='finance'" @click="task">查看任务与作品</button>
   <button :disabled="busy" @click="emit('changed');notice='已请求刷新，请查看明细中的最新状态。'">刷新处理结果</button>
  </div>
 </DetailDrawer>
 <section v-if="reviewing" ref="reviewHost" class="work-card execution-followup"><h3>{{item.keyword}} · 作品核验</h3><p v-if="notice" role="status">{{notice}}</p><HistoricalWorks v-if="context.adminDuty!=='finance'" :context="context" :keyword-id="item.keywordId" @changed="refreshed" /><button @click="emit('close')">收起执行进度</button></section>
</template>
<style scoped>
.execution-followup,.execution-followup form,.execution-followup label{display:grid;gap:12px}.execution-followup p{margin:0;overflow-wrap:anywhere}.execution-followup input,.execution-followup textarea{box-sizing:border-box;width:100%;min-width:0;padding:10px;min-height:44px;font:inherit;border:1px solid var(--line,#ddd);background:var(--paper,#fff);color:inherit;border-radius:6px}.execution-followup button{min-height:44px;padding:10px;font:inherit;border:1px solid var(--line,#ddd);border-radius:6px;cursor:pointer}.execution-followup .primary{background:#195e62;color:#fff}.execution-followup button:disabled{opacity:.5}
</style>
