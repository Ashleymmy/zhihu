<script setup lang="ts">
import {ref,watch} from 'vue'
import {DetailDrawer} from '@zhihu-koc/shared-components'
import {errorText,requestKey,type EngineContext} from './context'
import type {RiskCase} from './report-analysis'
const props=defineProps<{context:EngineContext;item:RiskCase|null}>()
const emit=defineEmits<{close:[];saved:[]}>()
const reason=ref(''),busy=ref(false),error=ref('')
watch(()=>props.item,()=>{reason.value='';error.value=''})
async function save(decision:'accepted'|'excluded'){
 if(!props.item||!reason.value.trim()||busy.value)return;busy.value=true;error.value=''
 try{await props.context.http.post('/attributions/'+props.item.factId+'/risk-review',{...props.context.scope,expectedRevisionId:props.item.revisionId,decision,reason:reason.value,requestKey:requestKey()});emit('saved')}
 catch(e){error.value=errorText(e)}finally{busy.value=false}
}
</script>
<template>
 <DetailDrawer :open="!!item" title="核实报表风险" @close="emit('close')">
  <form class="risk-form" @submit.prevent="save('accepted')">
   <strong>{{item?.keyword}}</strong><p>知乎标记：{{item?.riskAssessment||'需要核实'}}</p>
   <p>核实没问题后可继续确认；确实有问题则保留记录、停止计费。已确认过的金额交给财务核对更正。</p>
   <p v-if="error" class="risk-error" role="alert">{{error}}</p>
   <label>核实说明<textarea v-model="reason" required maxlength="500" rows="3" placeholder="填写核实依据或不计费的原因" /></label>
   <div class="risk-actions"><button class="primary" :disabled="busy||!reason.trim()">核实没问题</button><button type="button" :disabled="busy||!reason.trim()" @click="save('excluded')">确实有问题，不计费</button><button type="button" :disabled="busy" @click="emit('close')">暂时跳过</button></div>
  </form>
 </DetailDrawer>
</template>
<style scoped>
.risk-form{display:grid;gap:16px;overflow-wrap:anywhere}.risk-form p{margin:0}.risk-form label{display:grid;gap:8px}.risk-form textarea{width:100%;box-sizing:border-box;padding:10px;font:inherit;border:1px solid var(--line,#dce3e5);border-radius:8px}.risk-actions{display:flex;flex-wrap:wrap;gap:10px}.risk-actions button{min-height:44px;padding:10px 14px;border:1px solid var(--line,#dce3e5);border-radius:8px;font:inherit;cursor:pointer}.risk-actions .primary{background:#195e62;color:#fff;border-color:#195e62}.risk-actions button:disabled{opacity:.5;cursor:wait}.risk-error{color:#a02f39}
</style>
