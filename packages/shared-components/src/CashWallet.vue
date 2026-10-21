<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch} from 'vue'
import ActionDialog from './ActionDialog.vue'
import {createRequestKey} from '@zhihu-koc/shared-utils'
import {cashAmount as amount,cashUnits} from './platform-earnings'
interface Http{get<T>(path:string,params?:object):Promise<T>;post<T>(path:string,data?:unknown):Promise<T>;postForm<T>(path:string,data:FormData):Promise<T>;getBlob(path:string):Promise<Blob>}
interface Scope{projectId:string;accountId:string;moduleId:string}
interface Withdrawal{id:string;userId:string;displayName:string;amount:string;status:string;receiverName:string;bankName:string;bankAccount:string;payMethod:string|null;payAccount:string|null;paymentVersion:number;paidBy:string|null;remark:string;createdAt:string;paymentReference:string;paidOn:string;proofName:string;policyVersion?:string;feeAmount?:string;netAmount?:string;tier?:string;reviewDeadline?:string;settlementDeadline?:string;settlementMonth?:string;invoiceRequired?:boolean;invoiceVersion?:number;invoiceStatus?:string;invoiceName?:string;invoiceReason?:string;invoiceInstructions?:string}
interface Policy{enabled:boolean;version:string;lines:string[];details:string[];dailyAmountLimit?:string;todayAmount?:string;remainingAmount?:string;appliedDay?:string}
interface Quote{amount:string;feeAmount:string;netAmount:string;policyVersion:string;quoteToken:string;tier:string;reviewDeadline:string;settlementDeadline:string;settlementMonth:string|null;invoiceRequired:boolean}
interface View{balance:{confirmed:string;held:string;available:string;offset:string;paid:string;processing:string}|null;withdrawals:Withdrawal[];total:number;funding:{amount:string;hash:string};canManage:boolean;withdrawalPolicy?:Policy}
const props=defineProps<{http:Http;scope:Scope}>()
const emit=defineEmits<{updated:[]}>()
const view=ref<View|null>(null),page=ref(1),busy=ref(false),error=ref(''),notice=ref(''),applyOpen=ref(false),fundOpen=ref(false),reference=ref(''),request=ref(createRequestKey())
const applicant=reactive({amount:'',receiverName:'',payMethod:'wechat',payAccount:''})
const policy=ref<Policy|null>(null),quote=ref<Quote|null>(null),rulesAccepted=ref(false),invoiceFile=ref<File|null>(null),invoiceInstructions=ref(''),attention=ref('all')
watch(()=>applicant.amount,()=>{quote.value=null;rulesAccepted.value=false})
const selected=ref<Withdrawal|null>(null),action=ref(''),reason=ref(''),proof=ref<File|null>(null),ack=ref(false),actionKey=ref(createRequestKey())
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const payment=reactive({reference:'',paidOn:today,remark:'',payMethod:'wechat',payAccount:''})
const history=ref<{action:string;reason:string;createdAt:string;afterJson:unknown}[]|null>(null)
let paymentBody:FormData|null=null
const labels:Record<string,string>={pending:'待审核',approved:'审核通过，待打款',paid:'已打款',rejected:'已退回',cancelled:'已撤回'}
const invoiceLabels:Record<string,string>={pending:'待财务核验',accepted:'已核验',rejected:'请补充发票'}
const modalOpen=computed(()=>fundOpen.value||applyOpen.value||!!selected.value)
const modalTitle=computed(()=>fundOpen.value?'确认款项可用':applyOpen.value?'申请提现':({pay:'登记已线下发放',amend:'更正发放资料',void:'撤销发放标记',history:'登记与更正记录',reject:'退回申请',cancel:'撤回申请'}[action.value]||'提现详情'))
function closeDialog(){if(busy.value)return;fundOpen.value=false;applyOpen.value=false;selected.value=null;error.value=''}
const methods:Record<string,string>={wechat:'微信',alipay:'支付宝',bank:'银行卡'}
async function exportPayments(){
 const rows=await props.http.get<(Withdrawal&{projectName:string})[]>('/finance/payment-sheet',props.scope)
 if(!rows.length){notice.value='目前没有待发放申请。';return}
 const cell=(v:string|undefined)=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"'
 const csv=[['申请单号','业务项目','申请人','收款人','收款方式','收款账号','申请金额（元）','手续费（元）','实付金额（元）','状态','审核截止','最迟结算日','发票'],...rows.map(r=>[r.id,r.projectName,r.displayName,r.receiverName,methods[r.payMethod??'']||r.bankName,r.payAccount||r.bankAccount,r.amount,r.feeAmount||'0',r.netAmount??r.amount,labels[r.status],r.reviewDeadline,r.settlementDeadline,r.invoiceRequired?(invoiceLabels[r.invoiceStatus||'']||'待提供'):'无需提供'])].map(r=>r.map(cell).join(',')).join('\r\n')
 const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='待发放单_'+today+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 notice.value='发放单已导出，实际转账后登记即可。'
}
async function load(){policy.value=await props.http.get<Policy>('/finance/withdrawal-policy');view.value=await props.http.get<View>('/finance',{...props.scope,page:page.value,attention:attention.value});policy.value=view.value.withdrawalPolicy||policy.value;emit('updated')}
async function run(fn:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await fn()}catch(e){error.value=typeof e==='object'&&e&&'message'in e?String(e.message):'操作未完成，请重试'}finally{busy.value=false}}
function openApply(){error.value='';applyOpen.value=true;request.value=createRequestKey();quote.value=null;rulesAccepted.value=false}
async function apply(){
 if(policy.value?.enabled&&!quote.value){quote.value=await props.http.get<Quote>('/finance/withdrawal-quote',{...props.scope,amount:applicant.amount});return}
 if(policy.value?.enabled&&!rulesAccepted.value)throw new Error('请核对手续费、到账金额和提现规则')
 try{await props.http.post('/finance/withdrawals',{...props.scope,...applicant,requestKey:request.value,...(policy.value?.enabled?{policyVersion:quote.value?.policyVersion,quoteToken:quote.value?.quoteToken}:{})})}catch(e){if(typeof e==='object'&&e&&'code'in e&&Number(e.code)===40910){quote.value=null;rulesAccepted.value=false;policy.value=await props.http.get<Policy>('/finance/withdrawal-policy');throw new Error('提现规则或日期已更新，请重新核对到账金额并确认')}throw e}applyOpen.value=false;notice.value='提现申请已提交，可在记录中查看处理期限和进度。';await load()
}
async function release(){if(!view.value)return;await props.http.post('/finance/funding',{...props.scope,hash:view.value.funding.hash,reference:reference.value,requestKey:actionKey.value});fundOpen.value=false;notice.value='款项已开放，相关人员可以申请提现。';await load()}
function choose(w:Withdrawal,a:string){error.value='';selected.value=w;action.value=a;reason.value='';proof.value=null;invoiceFile.value=null;invoiceInstructions.value=w.invoiceInstructions||'';payment.reference=w.paymentReference||'';payment.paidOn=w.paidOn||today;payment.remark=w.remark||'';payment.payMethod=w.payMethod||'wechat';payment.payAccount=w.payAccount||w.bankAccount||'';ack.value=false;actionKey.value=createRequestKey();paymentBody=null;history.value=null}
async function review(){if(!selected.value)return;await props.http.post('/finance/withdrawals/'+selected.value.id+'/review',{...props.scope,action:action.value,reason:reason.value});notice.value='申请已更新。';selected.value=null;await load()}
async function pay(){
 if(!selected.value||!ack.value)return
 if(!paymentBody){const form=new FormData();for(const [key,v] of Object.entries({...props.scope,...payment,requestKey:actionKey.value,acknowledged:'true',...(selected.value.policyVersion?{policyVersion:selected.value.policyVersion,netAmount:selected.value.netAmount??selected.value.amount}:{})}))form.append(key,v);if(proof.value)form.append('proof',proof.value);paymentBody=form}
 try{await props.http.postForm('/finance/withdrawals/'+selected.value.id+'/pay',paymentBody)}catch(e){
  // A definite validation failure can be corrected in place. Keep the exact
  // payload only when the outcome is unknown, so a retry cannot change it.
  const status=typeof e==='object'&&e&&'status'in e?Number(e.status):0
  if(status>=400&&status<500){paymentBody=null;actionKey.value=createRequestKey()}
  throw e
 }
 selected.value=null;paymentBody=null;notice.value='已登记线下发放，系统未发起转账。';await load()
}
async function correct(){if(!selected.value)return;await props.http.post('/finance/withdrawals/'+selected.value.id+'/correct',{...props.scope,...payment,requestKey:actionKey.value,expectedVersion:selected.value.paymentVersion,action:action.value,reason:reason.value});notice.value=action.value==='void'?'已撤销发放标记，申请恢复待发放；线下款项未退回。':'已更正发放资料，原记录保留。';selected.value=null;await load()}
async function inspectHistory(w:Withdrawal){choose(w,'history');const r=await props.http.get<{list:NonNullable<typeof history.value>}>('/finance/withdrawals/'+w.id+'/history',props.scope);history.value=r.list}
async function download(w:Withdrawal){const blob=await props.http.getBlob('/finance/withdrawals/'+w.id+'/proof?'+new URLSearchParams({...props.scope}));const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=w.proofName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function saveInvoiceInstructions(){if(!selected.value)return;await props.http.post('/finance/withdrawals/'+selected.value.id+'/invoice-instructions',{...props.scope,instructions:invoiceInstructions.value});selected.value=null;await load()}
async function uploadInvoice(){if(!selected.value||!invoiceFile.value)throw new Error('请选择发票文件');const form=new FormData();for(const [k,v] of Object.entries(props.scope))form.append(k,v);form.append('expectedVersion',String(selected.value.invoiceVersion||0));form.append('proof',invoiceFile.value);await props.http.postForm('/finance/withdrawals/'+selected.value.id+'/invoice',form);selected.value=null;await load()}
async function reviewInvoice(decision:string){if(!selected.value)return;await props.http.post('/finance/withdrawals/'+selected.value.id+'/invoice-review',{...props.scope,expectedVersion:selected.value.invoiceVersion,action:decision,reason:reason.value});selected.value=null;await load()}
async function downloadInvoice(w:Withdrawal){const blob=await props.http.getBlob('/finance/withdrawals/'+w.id+'/invoice?'+new URLSearchParams({...props.scope}));const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=w.invoiceName||'发票';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
onMounted(()=>run(load))
</script>
<template>
  <section class="cash-box">
    <div class="cash-heading">
      <div><h2>{{view?.canManage?'提现审核与付款':'我的提现'}}</h2><p>{{view?.canManage?'核对申请与费用，实际转账后登记付款。':'查看本人的可提现余额与付款进度。'}}</p></div>
      <div class="cash-actions"><button v-if="view?.canManage" :disabled="busy" @click="run(exportPayments)">导出待发放单</button><button :disabled="busy" @click="run(load)">刷新</button></div>
    </div>
    <p v-if="error&&!modalOpen" class="cash-error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
    <section v-if="policy?.enabled" class="cash-rules"><h3>提现规则</h3><p v-for="line in policy.lines" :key="line">{{line}}</p><details><summary>完整规则与处理方式</summary><p v-for="line in policy.details" :key="line">{{line}}</p></details></section>
    <template v-if="view">
      <div v-if="view.balance" class="cash-metrics"><article><span>可提现</span><strong>¥{{amount(view.balance.available)}}</strong></article><article><span>待开放款项</span><strong>¥{{amount(view.balance.held)}}</strong></article><article><span>提现申请处理中</span><strong>¥{{amount(view.balance.processing)}}</strong></article><article><span>已实际打款</span><strong>¥{{amount(view.balance.paid)}}</strong></article></div>
      <p v-if="view.balance&&cashUnits(view.balance.offset)>0n" class="cash-error">有 ¥{{amount(view.balance.offset)}} 待抵扣，请在收益明细查看更正记录。</p>
      <p v-if="policy?.enabled&&!view.canManage" class="cash-muted">今日限额 ¥{{amount(policy.dailyAmountLimit)}} · 已申请 ¥{{amount(policy.todayAmount)}} · 剩余额度 ¥{{amount(policy.remainingAmount)}}（北京时间）</p>
      <button v-if="!view.canManage" class="cash-primary primary" :disabled="busy||cashUnits(view.balance?.available)<100n||(policy?.enabled&&cashUnits(policy.remainingAmount)<100n)" @click="openApply">申请提现</button>
      <p v-if="view.balance&&cashUnits(view.balance.available)<100n" class="cash-muted">账单确认且财务开放款项后，即可申请提现。</p>
      <div v-if="view.canManage&&cashUnits(view.funding.amount)>0n" class="cash-attention"><span>已确认、待开放款项：<strong>¥{{amount(view.funding.amount)}}</strong></span><button :disabled="busy" @click="error='';fundOpen=true;reference='';actionKey=createRequestKey()">登记款项可用</button></div>
      <div v-if="view.canManage" class="cash-actions"><label>处理期限 <select v-model="attention" :disabled="busy" @change="page=1;run(load)"><option value="all">全部</option><option value="due">3 天内到期</option><option value="overdue">已超期</option></select></label></div>
      <div class="cash-table"><table><thead><tr><th v-if="view.canManage">申请人</th><th>申请时间</th><th>金额（元）</th><th>收款资料</th><th>进度与期限</th><th>操作</th></tr></thead><tbody>
        <tr v-for="w in view.withdrawals" :key="w.id">
          <td v-if="view.canManage" data-label="申请人">{{w.displayName}}</td><td data-label="申请时间">{{new Date(w.createdAt).toLocaleDateString('zh-CN')}}</td>
          <td data-label="金额（元）"><div>申请 {{amount(w.amount)}}</div><template v-if="w.policyVersion"><small>手续费 {{amount(w.feeAmount||'0')}}</small><strong>{{w.status==='paid'?'实际打款':'预计到账'}} {{amount(w.netAmount??w.amount)}}</strong></template></td>
          <td data-label="收款资料"><details><summary>{{w.receiverName||w.displayName}} · {{methods[w.payMethod||'']||w.bankName||'未填写'}}</summary>{{w.payAccount||w.bankAccount||'收款账号未填写'}}</details></td>
          <td data-label="进度与期限">{{labels[w.status]||'处理中'}}<small>{{w.remark}}</small><small v-if="w.paidOn">发放日期：{{w.paidOn}}</small>
            <template v-if="w.policyVersion"><small>审核截止：{{w.reviewDeadline}} 18:00</small><small>最迟结算：{{w.settlementDeadline}}{{w.tier==='small'?' 18:00':''}}</small><small v-if="w.settlementMonth">结算月份：{{w.settlementMonth}}</small><small v-if="w.invoiceRequired">发票：{{invoiceLabels[w.invoiceStatus||'']||'待提供'}} · {{w.invoiceInstructions?'可查看开票要求':'财务：填写开票信息'}}</small><small v-if="w.invoiceReason" class="cash-error">{{w.invoiceReason}}</small><small v-if="['pending','approved'].includes(w.status)&&((w.status==='pending'&&(w.reviewDeadline||'')<today)||(w.settlementDeadline||'')<today)" class="cash-error">处理已超期，财务请优先跟进</small></template>
          </td>
          <td data-label="操作"><div class="cash-actions">
            <template v-if="view.canManage&&['pending','approved'].includes(w.status)">
              <button v-if="w.status==='pending'&&w.policyVersion" class="cash-primary primary" :disabled="busy" @click="choose(w,'approve')">审核通过</button>
              <button v-if="(!w.policyVersion||w.status==='approved')&&(!w.invoiceRequired||w.invoiceStatus==='accepted')" class="cash-primary primary" :disabled="busy" @click="choose(w,'pay')">登记已线下发放</button>
              <button v-if="w.status==='pending'" :disabled="busy" @click="choose(w,'reject')">退回</button>
            </template>
            <button v-if="w.invoiceRequired" :disabled="busy" @click="choose(w,'invoice')">{{view.canManage?'开票要求与核验':'查看要求 / 补充发票'}}</button>
            <template v-if="view.canManage&&w.status==='paid'"><button :disabled="busy" @click="choose(w,'amend')">更正发放资料</button><button :disabled="busy" @click="choose(w,'void')">撤销发放标记</button></template>
            <button v-if="!view.canManage&&w.status==='pending'" :disabled="busy" @click="choose(w,'cancel')">撤回申请</button><button v-if="w.proofName" :disabled="busy" @click="run(()=>download(w))">付款凭证</button><button v-if="w.paymentVersion>0" :disabled="busy" @click="run(()=>inspectHistory(w))">登记与更正记录</button>
          </div></td>
        </tr>
      </tbody></table></div><p v-if="!view.withdrawals.length" class="cash-empty">还没有提现申请。</p>
      <div v-if="view.total>25" class="cash-actions"><button :disabled="page===1||busy" @click="page--;run(load)">上一页</button><span>第 {{page}} 页</span><button :disabled="page*25>=view.total||busy" @click="page++;run(load)">下一页</button></div>
      <ActionDialog :open="modalOpen" :title="modalTitle" :busy="busy" @close="closeDialog"><p v-if="error" class="cash-error" role="alert">{{error}}</p>
        <form v-if="fundOpen" class="cash-dialog" @submit.prevent="run(release)"><p>资金备妥后，本次开放 ¥{{amount(view.funding.amount)}} 供成员申请提现。</p><label>单号或说明（选填）<input v-model="reference" maxlength="255" /></label><button class="cash-primary primary" :disabled="busy">确认款项可用</button><button type="button" :disabled="busy" @click="fundOpen=false">取消</button></form>
        <form v-if="applyOpen" class="cash-dialog" @submit.prevent="run(apply)">
          <div v-if="policy?.enabled" class="cash-rules"><p v-for="line in policy.lines" :key="line">{{line}}</p></div>
          <p v-if="policy?.enabled">今日剩余额度 ¥{{amount(policy.remainingAmount)}}，单笔不超过可提现余额及剩余额度。</p><label>提现金额（元）<input v-model="applicant.amount" inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" required :disabled="busy" /></label><label>收款方式<select v-model="applicant.payMethod" :disabled="busy"><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="bank">银行卡</option></select></label><label>收款账号<input v-model="applicant.payAccount" maxlength="128" required :disabled="busy" /></label><label>收款人姓名<input v-model="applicant.receiverName" maxlength="128" required :disabled="busy" /></label>
          <div v-if="quote&&policy?.enabled" class="cash-rules"><p>本次扣减余额 ¥{{amount(quote.amount)}} · 手续费 ¥{{amount(quote.feeAmount)}}</p><strong>预计到账 ¥{{amount(quote.netAmount)}}</strong><p>审核截止：{{quote.reviewDeadline}} 18:00；最迟结算：{{quote.settlementDeadline}}{{quote.tier==='small'?' 18:00':''}}</p><p v-if="quote.settlementMonth">在 {{quote.settlementMonth}} 月内结算，无固定打款日。</p><p v-if="quote.invoiceRequired">团长需向平台开具发票，可在原申请查看要求并补交。</p><label class="cash-check"><input v-model="rulesAccepted" type="checkbox" />已阅读提现规则，确认费用和到账金额</label></div>
          <button class="cash-primary primary" :disabled="busy">{{policy?.enabled?(quote?'确认申请提现':'核对到账金额'):'提交申请'}}</button><button type="button" :disabled="busy" @click="applyOpen=false">取消</button>
        </form>
        <form v-if="selected&&['approve','reject','cancel'].includes(action)" class="cash-dialog" @submit.prevent="run(review)"><p>{{selected.displayName}} · 申请 ¥{{amount(selected.amount)}} · 实付 ¥{{amount(selected.netAmount??selected.amount)}}</p><p v-if="action==='cancel'&&selected.policyVersion">撤回后释放未付款的占用金额及原申请日额度；跨日撤回不增加今日额度。</p><label>{{action==='reject'?'退回原因':'备注（选填）'}}<input v-model="reason" :required="action==='reject'" maxlength="500" /></label><button class="cash-primary primary" :disabled="busy">{{action==='approve'?'确认审核通过':'确认'}}</button><button type="button" :disabled="busy" @click="selected=null">取消</button></form>
        <form v-if="selected&&['pay','amend','void'].includes(action)" class="cash-dialog" @submit.prevent="run(action==='pay'?pay:correct)">
          <p>{{selected.displayName}} · 实付 <strong>¥{{amount(selected.netAmount??selected.amount)}}</strong></p><p>申请 ¥{{amount(selected.amount)}} · 手续费 ¥{{amount(selected.feeAmount||'0')}}</p>
          <p v-if="action==='void'">仅撤销系统中的发放标记，恢复待发放申请；不会退回微信或支付宝已转出的款项。</p>
          <template v-else><label>发放日期<input type="date" v-model="payment.paidOn" :max="today" required :disabled="busy||!!paymentBody"/></label><label>发放方式<select v-model="payment.payMethod" :disabled="busy||!!paymentBody"><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="bank">银行卡</option></select></label><label>收款账号<input v-model="payment.payAccount" maxlength="128" :disabled="busy||!!paymentBody"/></label><label>流水号（选填）<input v-model="payment.reference" maxlength="128" :disabled="busy||!!paymentBody"/></label><label>备注（选填）<input v-model="payment.remark" maxlength="500" :disabled="busy||!!paymentBody"/></label><label v-if="action==='pay'">凭证（图片或 PDF，最大 5 MB）<input type="file" accept=".png,.jpg,.jpeg,.pdf" :disabled="busy||!!paymentBody" @change="proof=($event.target as HTMLInputElement).files?.[0]??null" /></label></template>
          <label v-if="action!=='pay'">更正原因<input v-model="reason" required maxlength="500" /></label><label v-if="action==='pay'" class="cash-check"><input type="checkbox" v-model="ack" required />已实际转账，核对了实付金额、手续费和收款账户</label><button class="cash-primary primary" :disabled="busy||(action==='pay'&&!ack)">{{action==='pay'?'保存发放记录':'保存更正'}}</button><button type="button" :disabled="busy" @click="selected=null">取消</button>
        </form>
        <section v-if="selected&&action==='invoice'" class="cash-dialog">
          <h3>团长发票</h3><p>申请 ¥{{amount(selected.amount)}} · 最迟 {{selected.settlementDeadline}} 结算</p><p class="cash-instructions">{{selected.invoiceInstructions||'财务正在准备本笔开票信息，补充后将在这里展示。'}}</p><p v-if="selected.invoiceReason" class="cash-error">{{selected.invoiceReason}}</p>
          <button v-if="selected.invoiceName" :disabled="busy" @click="run(()=>downloadInvoice(selected!))">查看发票：{{selected.invoiceName}}</button>
          <template v-if="['pending','approved'].includes(selected.status)">
            <template v-if="view.canManage"><label>开票信息、票面要求与提交期限<textarea v-model="invoiceInstructions" maxlength="2000" :disabled="busy" /></label><button :disabled="busy" @click="run(saveInvoiceInstructions)">保存开票要求</button><template v-if="selected.invoiceName"><label>退回原因（退回必填）<input v-model="reason" maxlength="500" :disabled="busy" /></label><button class="cash-primary primary" :disabled="busy" @click="run(()=>reviewInvoice('accept'))">发票核验通过</button><button :disabled="busy" @click="run(()=>reviewInvoice('reject'))">退回补充</button></template></template>
            <template v-else-if="selected.invoiceStatus!=='accepted'"><label>发票文件（PNG / JPG / PDF，最大 5 MB）<input type="file" accept=".png,.jpg,.jpeg,.pdf" :disabled="busy" @change="invoiceFile=($event.target as HTMLInputElement).files?.[0]??null" /></label><button class="cash-primary primary" :disabled="busy||!invoiceFile" @click="run(uploadInvoice)">提交发票</button></template>
          </template><button :disabled="busy" @click="selected=null">关闭</button>
        </section>
        <section v-if="selected&&action==='history'" class="cash-dialog"><p v-for="(h,i) in history" :key="i">{{new Date(h.createdAt).toLocaleString('zh-CN')}} · {{h.action==='void'?'撤销发放标记':h.action==='amend'?'更正资料':'登记发放'}} · {{h.reason||'线下发放登记'}}</p><button @click="selected=null">关闭记录</button></section>
      </ActionDialog>
    </template>
  </section>
</template>
<style scoped>
.cash-rules{background:var(--bg,#f4f7f8);padding:16px;border-radius:10px;margin:16px 0;line-height:1.7;overflow-wrap:anywhere}.cash-rules p{margin:8px 0}.cash-rules h3{margin-top:0}.cash-instructions{white-space:pre-wrap}.cash-dialog textarea{min-height:140px;box-sizing:border-box;width:100%;resize:vertical;font:inherit;padding:10px;border:1px solid #b8c8ca;border-radius:6px}
.cash-box{min-width:0;padding:24px;border:1px solid var(--line,#dce2e5);border-radius:12px;background:var(--paper,#fff);margin-top:20px}.cash-heading,.cash-actions,.cash-attention{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.cash-heading h2{margin:0}.cash-heading p,.cash-muted{color:var(--ink-soft,#627078)}.cash-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:16px;margin:20px 0}.cash-metrics article{min-width:0;overflow-wrap:anywhere;background:var(--bg,#f4f7f8);padding:18px;border-radius:10px}.cash-metrics span,.cash-metrics strong,small{display:block}.cash-metrics strong{font-size:24px;margin-top:8px}.cash-box button{border:1px solid var(--line,#dce2e5);border-radius:8px;background:var(--paper,#fff);padding:9px 14px;cursor:pointer;color:inherit}.cash-box button.cash-primary{background:#195e62;color:white;border-color:#195e62}.cash-box button:disabled{opacity:.45;cursor:not-allowed}.cash-dialog{display:grid;gap:16px;margin:0;min-width:0}.cash-dialog .cash-check{display:flex;gap:10px;align-items:center}.cash-dialog .cash-check input{width:18px;flex:0 0 18px;min-height:18px}.cash-dialog h3,.cash-dialog p{width:100%;margin:0}.cash-dialog label{display:flex;flex:1 1 220px;gap:7px;flex-direction:column}.cash-dialog input,.cash-dialog select{box-sizing:border-box;padding:10px;border:1px solid #b8c8ca;border-radius:6px;width:100%;color:inherit;background:var(--paper,#fff)}.cash-dialog .cash-check{flex-direction:row;align-items:center;flex-basis:100%}.cash-check input{width:18px}.cash-table{overflow:auto;margin-top:20px}.cash-table table{width:100%;border-collapse:collapse;text-align:left}.cash-table td,.cash-table th{padding:12px;border-bottom:1px solid var(--line,#dce2e5);white-space:nowrap}small{color:var(--ink-soft,#627078);margin-top:6px}.cash-error{color:#a52c35}.cash-empty{padding:22px;color:var(--ink-soft,#627078);text-align:center}.cash-attention{padding:14px;background:#f3f7f5;margin-top:18px}
@media(max-width:650px){
.cash-box{padding:16px}.cash-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cash-metrics article{padding:12px}.cash-metrics strong{font-size:20px}.cash-heading>div{min-width:0}.cash-dialog{padding:0}.cash-dialog label{min-width:0;flex-basis:100%}.cash-table{overflow:visible}.cash-table table,.cash-table tbody{display:block}.cash-table thead{display:none}.cash-table tr{display:grid;gap:12px;padding:16px;border:1px solid var(--line,#dce2e5);border-radius:8px;margin-bottom:12px}.cash-table td{display:grid;gap:6px;min-width:0;padding:0;border:0;white-space:normal;overflow-wrap:anywhere}.cash-table td::before{content:attr(data-label);font-size:12px;color:var(--ink-soft,#627078)}.cash-table td:has(.cash-actions:empty){display:none}.cash-actions button{max-width:100%;white-space:normal}
}
</style>

