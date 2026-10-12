<script setup lang="ts">
import {computed,inject,nextTick,ref} from 'vue'
import type {PeriodState} from '../composables/usePeriodState'
import type {BillEntry} from '../../bill-entry'
import BillDetails from '../../BillDetails.vue'
import Issues from '../../Issues.vue'
import AgencySettings from '../../AgencySettings.vue'
import AssignExecutor from '../../AssignExecutor.vue'
import ExecutionFollowUp from '../../ExecutionFollowUp.vue'
import RiskReview from '../../RiskReview.vue'
import type {RiskCase} from '../../report-analysis'
import {RateSettings} from '@zhihu-koc/shared-components'
import Modal from './Modal.vue'
import {errorText,requestKey} from '../../context'
const state=inject<PeriodState>('financeState')!,issues=ref<InstanceType<typeof Issues>>()
const navigate=inject<(path:string)=>void>('financeNavigate',()=>{})
const agency=ref(false),assignment=ref<BillEntry|null>(null),execution=ref<BillEntry|null>(null),risk=ref<RiskCase|null>(null),rates=ref(false),metric=ref('new_user')
const visible=computed(()=>[...new Map(state.blockedEntries.value.map(e=>[e.factId||e.id,e])).values()] as BillEntry[])
const unlinked=computed(()=>state.exceptions.value.filter(e=>!visible.value.some(b=>b.factId?b.factId===e.factId:b.keyword===(e.keyword||e.normalizedJson?.keyword)&&b.date===e.normalizedJson?.date)))
const replyTarget=ref<(typeof state.objections.value)[number]|null>(null),reply=ref(''),busy=ref(false),error=ref('')
let key=requestKey()
async function changed(){await state.loadPeriod();await issues.value?.reload()}
async function match(e:{keyword?:string|null;normalizedJson?:{keyword?:string}}){await nextTick();await issues.value?.inspectKeyword(e.keyword||e.normalizedJson?.keyword||'')}
function openReply(o:(typeof state.objections.value)[number]){replyTarget.value=o;reply.value='';error.value='';key=requestKey()}
async function respond(){if(!replyTarget.value||busy.value)return;busy.value=true;error.value='';try{await state.context.http.post('/objections/'+replyTarget.value.id+'/reply',{...state.context.scope,reply:reply.value,requestKey:key});replyTarget.value=null;await state.loadPeriod()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
</script>
<template><div>
 <div class="banner" :class="{warn:state.todoCount.value>0}"><div class="grow"><b>{{state.todoCount.value?'本期还有 '+state.todoCount.value+' 项待处理':'本期待办已处理完'}}</b><div class="small muted">{{state.todoCount.value?'按记录中的原因补齐资料，系统会更新结果。':'可以继续核对金额。'}}</div></div><button v-if="!state.todoCount.value" class="primary" :disabled="state.loading.value||!!state.error.value" @click="state.gotoStep(3)">去核对与确认 →</button></div>
 <div v-if="state.objections.value.length" class="todo-group rise"><header><b>成员金额疑问</b><span class="small muted">财务核对后回复</span></header><div v-for="o in state.objections.value" :key="o.id" class="todo"><div class="body"><b>{{o.displayName}} · {{o.keyword}}</b><p class="small muted">{{o.businessDate}} · {{o.detail}}</p></div><div class="actions"><button @click="openReply(o)">回复疑问</button></div></div></div>
 <BillDetails :context="state.context" :entries="visible" layout="todo" :admin-duty="state.context.adminDuty||'all'" :can-set-rates="state.context.adminDuty!=='operations'" :busy="state.loading.value" @assign="assignment=$event" @agency="agency=true" @risk="risk={factId:$event.factId,revisionId:$event.revisionId,keyword:$event.keyword,riskAssessment:$event.riskAssessment||''}" @rates="metric=$event.metricType;rates=true" @followup="execution=$event" @changes="issues?.inspectFact($event.factId)" @match="match"/>
 <div v-if="unlinked.length" class="todo-group rise"><header><b>报表资料待核对</b></header><div v-for="e in unlinked" :key="e.id" class="todo"><div class="body"><b>{{e.keyword||e.normalizedJson?.keyword||'报表记录'}}</b><p>{{e.reason}}</p><p class="small muted">下一步：{{e.next}}</p></div><div class="actions"><button @click="match(e)">查看处理详情</button></div></div></div>
 <Issues ref="issues" :context="state.context" headless @navigate="navigate" @changed="state.loadPeriod()"/>
 <AgencySettings :http="state.context.http" :scope="state.context.scope" :open="agency" @close="agency=false" @saved="agency=false;changed()"/>
 <AssignExecutor v-if="assignment?.keywordId" :context="state.context" :keyword-id="assignment.keywordId" :keyword="assignment.keyword" :from-date="assignment.retroFromDate" @close="assignment=null" @saved="assignment=null;changed()"/>
 <ExecutionFollowUp v-if="execution" :context="state.context" :item="execution" @navigate="navigate" @close="execution=null" @changed="changed"/>
 <RiskReview :context="state.context" :item="risk" @close="risk=null" @saved="risk=null;changed()"/>
 <RateSettings :http="state.context.coreHttp" :project-id="state.context.scope.projectId" module-id="zhihu" :open="rates" :initial-metric-type="metric" @close="rates=false" @published="rates=false;changed()"/>
 <Modal :open="!!replyTarget" title="回复金额疑问" :busy="busy" @close="replyTarget=null"><h3>回复金额疑问</h3><p>{{replyTarget?.detail}}</p><label>回复内容<textarea v-model="reply" rows="3" maxlength="1000"/></label><p v-if="error" role="alert">{{error}}</p><div class="footer"><button :disabled="busy" @click="replyTarget=null">取消</button><button class="primary" :disabled="busy||!reply.trim()" @click="respond">回复并继续核对</button></div></Modal>
</div></template>
