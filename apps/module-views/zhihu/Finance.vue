<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import Issues from './Issues.vue'
import {CashWallet} from '@zhihu-koc/shared-components'
import { errorText, requestKey, type EngineContext } from './context'
const props=defineProps<{context:EngineContext; wallet?:boolean}>()
const emit=defineEmits<{issues:[]}>()
interface Entry {id:string;keyword:string;date:string;orders:string|null;payerName:string;payeeName:string;payeeId:string;parentId:string|null;role:string;amount:string;status:string;kind:string;ownPayable:boolean;ownReceivable:boolean;blocked:string;ready:boolean}
interface Group {payeeId:string;name:string;confirmed:string;pending:string;total:string;blockers:string[];ready:number}
interface View {summary:{records:number;orders:string;issues:number;receivable:string;confirmedReceivable:string;pendingReceivable:string;payable:string;confirmedPayable:string;pendingPayable:string;retained:string};entries:Entry[];groups:Group[];reviewHash:string;needsReview:boolean;withdrawal:{enabled:boolean;message:string}}
interface Batch {id:string;fileName:string;status:string;lastError?:string}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const period=reactive({from:today.slice(0,7)+'-01',to:today})
const view=ref<View|null>(null),busy=ref(false),error=ref(''),errorHelp=ref(''),errorAction=ref('none'),notice=ref(''),file=ref<File|null>(null),progress=ref(''),history=ref<Batch[]>([])
const walletVersion=ref(0)
const confirming=ref(false),checked=ref(false),selected=ref(''),detailPage=ref(1)
const money=(v:string|undefined)=>Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:4})
const admin=computed(()=>props.context.role==='admin'&&props.context.adminDuty!=='operations'),creator=computed(()=>props.context.role==='creator')
const visible=computed(()=>view.value?.entries.filter(e=>props.wallet?e.ownReceivable:e.ownPayable)??[])
const details=computed(()=>visible.value.filter(e=>!selected.value||e.payeeId===selected.value||(props.context.role==='admin'&&e.parentId===selected.value)))
const detailRows=computed(()=>details.value.slice((detailPage.value-1)*20,detailPage.value*20))
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,polling=false
function post(path:string,data:object={}){return props.context.http.post(path,{...props.context.scope,...data,requestKey:requestKey()})}
async function refresh(){view.value=await props.context.http.get<View>('/workbench',{...props.context.scope,...period});detailPage.value=1}
async function load(){await refresh();if(admin.value)history.value=(await props.context.http.get<{list:Batch[]}>('/imports',{...props.context.scope,page:1,pageSize:5})).list}
function showError(e:unknown){
 const message=errorText(e);error.value=message;errorHelp.value='';errorAction.value='none';
 if(message.includes('历史数据')||message.includes('旧引擎')||message.includes('切换边界')){error.value='这份报表属于历史周期';errorHelp.value='当前财务做账只接收新归因规则生效后的数据，请到历史邮件 / Excel 导入页面处理。';errorAction.value='legacy';}
 else if(message.includes('上传文件不符合')||message.includes('Excel')){error.value='Excel 文件暂时无法读取';errorHelp.value='请确认文件后缀为 .xlsx，并保留日期、渠道名称、关键词、搜索量或订单量等表头；如果文件来自 WPS，请先另存为 Excel 工作簿后再上传。';}
 else if(message.includes('无法识别')){errorHelp.value='请按行号检查日期、渠道名称、关键词和订单量；空白行可以保留，修正后重新上传。';}
}
function openLegacy(){window.location.href='/admin/modules/zhihu/data-import'}
async function run(work:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';errorHelp.value='';errorAction.value='none';try{await work()}catch(e){showError(e)}finally{busy.value=false}}
async function track(id:string){
 if(disposed||polling)return
 polling=true
 try{
  const b=await props.context.http.get<{status:string;counts:{processingStatus:string;total:number}[]}>('/imports/'+id,{...props.context.scope,page:1,pageSize:1})
  const pending=b.counts.filter(c=>c.processingStatus==='pending').reduce((n,c)=>n+c.total,0)
  if(pending===0){progress.value='';notice.value='报表已分析完成，人员归属和金额已更新。';await load()}
  else{progress.value='正在分析报表，剩余 '+pending+' 条…';timer=setTimeout(()=>{void track(id)},2000)}
 }catch(e){progress.value='';showError(new Error('分析进度暂时无法读取，请刷新查看：'+errorText(e)))}
 finally{polling=false}
}
async function upload(){
 if(!file.value)return
 const form=new FormData();form.append('file',file.value);form.append('projectId',props.context.scope.projectId);form.append('accountId',props.context.scope.accountId)
 progress.value='正在读取报表并计算…';notice.value=''
 try{
  const r=await props.context.http.postForm<{id:string;from:string;to:string;duplicate:boolean}>('/workbench/import',form)
  period.from=r.from;period.to=r.to
  if(r.duplicate)notice.value='这份报表已经上传，已为你打开原来的结果，不会重复计账。'
  await load();await track(r.id)
 }catch(e){progress.value='';throw e}
}
async function confirm(){
 if(!view.value||!checked.value)return
 const r=await post('/workbench/confirm',{...period,reviewHash:view.value.reviewHash,acknowledged:true}) as {confirmed:number;waiting:number}
 confirming.value=false;checked.value=false
 notice.value='已核对本期金额，确认 '+r.confirmed+' 条账单。'+(r.waiting?'其余账单待作品审核或数据问题处理完成后再确认。':'')
 await refresh();walletVersion.value++
}
function exportBill(){
 if(!view.value)return
 const cell=(s:unknown)=>'"'+String(s??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"'
 const rows=props.wallet?[['日期','关键词','付款方','收入（元）','状态'],...visible.value.map(e=>[e.date,e.keyword,e.payerName,e.amount,e.status==='confirmed'?'已确认':'待确认'])]
 :[['收款人','已确认应付（元）','待确认应付（元）','合计（元）','待办'],...view.value.groups.map(g=>[g.name,g.confirmed,g.pending,g.total,g.blockers.join('；')])]
 const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})
 const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=(props.wallet?'收入明细':'财务对账单')+'_'+period.from+'_'+period.to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
onMounted(()=>run(async()=>{await load();const pending=history.value.find(b=>b.status==='committed');if(pending)await track(pending.id)}))
onUnmounted(()=>{disposed=true;if(timer)clearTimeout(timer)})
</script>
<template>
 <section class="work-section">
  <div v-if="admin && !wallet" class="upload-box">
   <div><h2>上传知乎报表，自动计算每个人的金额</h2><p>系统会读取报表中的日期、渠道、关键词、搜索量和订单量，再按已生效的单价计算金额。</p></div>
   <ol class="upload-steps"><li>选择知乎导出的 .xlsx 文件</li><li>点击“上传并自动分析”</li><li>查看识别结果和待处理原因，确认无误后再核对账单</li></ol>
   <p class="upload-tip">支持含有“日期 / 渠道名称 / 关键词”以及“搜索量”或“订单量”表头的报表。历史周期请使用“历史邮件 / Excel 导入”。</p>
   <form @submit.prevent="run(upload)"><label>选择 Excel 文件<input type="file" accept=".xlsx" required :disabled="busy||!!progress" @change="file=($event.target as HTMLInputElement).files?.[0]??null" /></label><button class="primary" :disabled="busy||!!progress||!file">{{progress?'正在分析…':'上传并自动分析'}}</button></form>
  </div>
  <div v-if="error" role="alert" class="engine-error"><strong>{{error}}</strong><span v-if="errorHelp">{{errorHelp}}</span><button v-if="errorAction==='legacy'" type="button" @click="openLegacy">打开历史邮件 / Excel 导入</button></div><p v-if="notice" role="status">{{notice}}</p><p v-if="progress" role="status">{{progress}}</p>
  <form class="period-filter" @submit.prevent="run(refresh)"><label>开始日期<input type="date" v-model="period.from" required /></label><label>结束日期<input type="date" v-model="period.to" required /></label><button :disabled="busy">查看账单</button></form>
  <div v-if="view" class="metric-grid">
   <article><span>{{wallet?'已确认收入':'应付合计'}}</span><strong>¥{{money(wallet?view.summary.confirmedReceivable:view.summary.payable)}}</strong></article>
   <article><span>{{wallet?'待确认收入':'已确认应付'}}</span><strong>¥{{money(wallet?view.summary.pendingReceivable:view.summary.confirmedPayable)}}</strong></article>
   <article><span>{{wallet&&!creator?'本人应得收入':'订单数'}}</span><strong>{{wallet&&!creator?'¥'+money(view.summary.retained):view.summary.orders}}</strong></article>
  </div>
   <div v-if="view && !wallet" class="analysis-result"><strong>已读取 {{view.summary.records}} 条有效业务记录</strong><span>订单数：{{view.summary.orders}} · 当前应付：¥{{money(view.summary.payable)}}</span><span v-if="view.summary.issues">还有 {{view.summary.issues}} 项需要处理，未处理前不会计入应付金额。</span></div>

   <div v-if="view?.summary.issues && admin" class="attention"><strong>{{view.summary.issues}} 项数据需要运营处理</strong><span>这些记录暂时不会进入应付金额，处理完成后请刷新账单。</span><span>下方“报表问题”可查看具体原因。</span></div>
  <div v-if="view && !wallet" class="work-card">
   <div class="section-heading"><div><h2>{{admin?'本期财务账单':'团队应付账单'}}</h2><p>{{admin?'按团长（含团队达人）和独立达人汇总，便于核对和做账。':'只需核对你应付给团队达人的金额。'}}</p></div>
    <div class="engine-actions"><button :disabled="!view.groups.length||busy" @click="exportBill">导出对账单</button><button v-if="admin" class="primary" :disabled="busy||!view.entries.some(e=>e.ready)&&!(admin&&view.needsReview&&view.summary.records>0)" @click="confirming=true;checked=false">核对并确认账单</button></div>
   </div>
   <div class="engine-table"><table><thead><tr><th>收款人</th><th>合计（元）</th><th>已确认</th><th>待确认</th><th>下一步</th><th></th></tr></thead><tbody><tr v-for="g in view.groups" :key="g.payeeId"><td>{{g.name}}</td><td>{{money(g.total)}}</td><td>{{money(g.confirmed)}}</td><td>{{money(g.pending)}}</td><td>{{g.blockers.join('；')||(g.ready?'可以确认':'已核对完成')}}</td><td><button @click="selected=g.payeeId;detailPage=1">看明细</button></td></tr></tbody></table></div>
   <p class="empty-state" v-if="!view.groups.length">{{admin?'还没有账单，请先上传报表。':'财务上传报表后，这里会自动显示团队账单。'}}</p>
  </div>
  <div v-if="admin && confirming && view" class="confirm-box" role="region" aria-label="核对账单"><h2>确认本期账单</h2><p>{{period.from}} 至 {{period.to}}，本期应付合计 <strong>¥{{money(view.summary.payable)}}</strong>。</p><p>审核完成的账单会被确认；有待办的账单继续等待处理。此操作不会发起银行转账。</p><label class="check-label"><input type="checkbox" v-model="checked" />我已核对报表、人员和计算金额</label><div class="engine-actions"><button class="primary" :disabled="!checked||busy" @click="run(confirm)">确认核对结果</button><button :disabled="busy" @click="confirming=false">返回检查</button></div></div>
  <details class="work-card" :open="wallet"><summary>{{wallet?'我的收入明细':'查看关键词与金额明细'}}</summary><div class="engine-actions"><button v-if="selected" @click="selected='';detailPage=1">查看全部人员</button><button v-if="wallet" :disabled="!visible.length" @click="exportBill">导出收入明细</button></div>
   <div class="engine-table"><table><thead><tr><th>日期</th><th>关键词</th><th>{{wallet?'付款方':'收款人'}}</th><th>金额（元）</th><th>状态</th></tr></thead><tbody><tr v-for="e in detailRows" :key="e.id"><td>{{e.date}}</td><td>{{e.keyword}}<small v-if="e.kind==='adjustment'">金额更正</small></td><td>{{wallet?e.payerName:e.payeeName}}</td><td>{{money(e.amount)}}</td><td>{{e.status==='confirmed'?'已确认':e.blocked||'待财务确认'}}</td></tr></tbody></table></div>
   <p class="empty-state" v-if="!details.length">暂无收入记录。报表处理完成后会自动显示。</p><div class="engine-actions" v-if="details.length>20"><button :disabled="detailPage===1" @click="detailPage--">上一页</button><span>第 {{detailPage}} 页</span><button :disabled="detailPage*20>=details.length" @click="detailPage++">下一页</button></div>
  </details>
  <div v-if="wallet&&context.role==='leader'&&view" class="work-card"><h2>团队收益分布</h2><p>团长账目包含团队达人产生的金额，下面按成员列出明细，便于你安排团队内部分配。</p><div class="engine-table"><table><thead><tr><th>收款人</th><th>本期应得（元）</th><th>待办</th></tr></thead><tbody><tr v-for="g in view.groups" :key="g.payeeId"><td>{{g.name}}</td><td>{{money(g.total)}}</td><td>{{g.blockers.join('；')||'等待财务处理'}}</td></tr></tbody></table></div></div>
  <details v-if="admin&&!wallet" class="work-card"><summary>报表问题与更正</summary><Issues :context="context" /></details>
  <CashWallet :key="walletVersion" v-if="wallet||admin" :http="context.coreHttp" :scope="{...context.scope,moduleId:'zhihu'}" />
  <details v-if="admin&&!wallet" class="work-card"><summary>最近上传记录</summary><ul class="plain-list"><li v-for="b in history" :key="b.id"><span>{{b.fileName}}</span><span>{{b.status==='processed'?'已分析':b.status==='committed'?'分析中':'待处理'}}</span><button v-if="b.lastError||b.status==='committed'" :disabled="busy" @click="run(async()=>{await post('/imports/'+b.id+'/process');await track(b.id)})">继续分析</button></li></ul><p v-if="!history.length">尚未上传报表。</p></details>
 </section>
</template>



<style scoped>
.upload-steps{display:flex;gap:24px;flex-wrap:wrap;margin:18px 0 10px;padding:0 0 0 20px;color:#31575c}
.upload-steps li{padding-right:12px}
.upload-tip{font-size:13px;margin:8px 0 18px;color:#637078}
.analysis-result{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-top:18px;padding:16px 18px;border:1px solid #c6dfdd;border-radius:10px;background:#f2faf9;color:#31575c}
.analysis-result strong{color:#194f54}
.engine-error{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.engine-error span{color:#7a3d42}
.engine-error button{margin-left:auto}
</style>
