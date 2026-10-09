<script setup lang="ts">
import { computed, ref } from 'vue'
import { ActionDialog } from '@zhihu-koc/shared-components'
import { errorText, executorOptions, requestKey, type EngineContext } from './context'
const props=defineProps<{context:EngineContext;keywordId:string;keyword:string;fromDate?:string}>()
const emit=defineEmits<{close:[];saved:[name:string]}>()
const executorId=ref(''),fromDate=ref(props.fromDate||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())),busy=ref(false),error=ref('')
const members=computed(()=>executorOptions(props.context))
const key=requestKey()
async function save(){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  const result=await props.context.http.post<{executorName:string}>('/keywords/'+props.keywordId+'/assign-retro',{...props.context.scope,executorId:executorId.value,fromDate:fromDate.value,requestKey:key})
  emit('saved',result.executorName)
 }catch(e){error.value=errorText(e)}finally{busy.value=false}
}
</script>
<template>
 <ActionDialog :open="true" :title="'指定执行人 · '+keyword" :busy="busy" @close="emit('close')">
  <form @submit.prevent="save">
   <p v-if="error" role="alert">{{error}}</p>
   <label>执行人<select aria-label="执行人" v-model="executorId" required><option value="" disabled>选择人员</option><option v-for="member in members" :key="member.id" :value="member.id">{{member.displayName}}（{{member.id===context.userId&&context.role==='admin'?'本人执行':member.role==='leader'?'团长':member.parentId?'达人':'独立达人'}}）</option></select></label>
   <label>从这天起的订单算给 TA<input v-model="fromDate" type="date" required /></label>
   <div class="dialog-actions"><button type="button" :disabled="busy" @click="emit('close')">取消</button><button class="primary" :disabled="busy||!executorId||!fromDate">{{busy?'正在保存…':'确定'}}</button></div>
  </form>
 </ActionDialog>
</template>
