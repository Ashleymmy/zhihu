<script setup lang="ts">
import {computed,inject,ref,watch} from 'vue'
import type {PeriodState} from '../composables/usePeriodState'
import {fmtMoney,fmtPrice,moneyValue,cashText,type BillEntry} from '../composables/useFinanceApi'
import Modal from './Modal.vue'
import TraceDrawer from './TraceDrawer.vue'
const state=inject<PeriodState>('financeState')!,toast=inject<(text:string)=>void>('financeToast')!
const entries=computed(()=>state.workbench.value?.entries??[]),summary=computed(()=>state.workbench.value?.summary)
// Workbench groups are team totals; this panel names actual recipients.
const rawMoney=(n:bigint)=>{const a=n<0n?-n:n;return(n<0n?'-':'')+String(a/10000n)+'.'+String(a%10000n).padStart(4,'0')}
const groups=computed(()=>{const people=new Map<string,BillEntry[]>();for(const e of entries.value.filter(e=>e.ownPayable&&!e.internal&&e.payeeId)){const rows=people.get(e.payeeId)??[];rows.push(e);people.set(e.payeeId,rows)}return [...people].map(([payeeId,rows])=>({payeeId,name:rows[0]!.payeeName,total:rawMoney(rows.reduce((n,e)=>n+moneyValue(e.amount??'0'),0n)),confirmed:rawMoney(rows.reduce((n,e)=>n+moneyValue(e.confirmedAmount),0n)),pending:rawMoney(rows.reduce((n,e)=>n+moneyValue(e.pendingAmount),0n)),blockers:[...new Set(rows.filter(e=>!e.ready&&e.status!=='confirmed'&&e.reason).map(e=>e.reason))]}))})
const metrics=[{key:'newUser' as const,name:'拉新',unit:'单'},{key:'activation' as const,name:'拉活',unit:'个'}]
const metricOf=(key:'newUser'|'activation')=>summary.value?.byType[key]
const hasTypeData=(key:'newUser'|'activation')=>!!metricOf(key)?.records||entries.value.some(e=>e.metricType===(key==='newUser'?'new_user':'activation'))
const moneyOrMissing=(v:string|null|undefined)=>v==null?'原表未提供':fmtMoney(v)
const totalPayable=computed(()=>cashText(moneyValue(state.totalPayable.value)))
const page=ref(1),pageSize=20,expanded=ref<string|null>(null),seen=ref<Set<string>>(new Set())
const visibleEntries=computed(()=>entries.value.slice((page.value-1)*pageSize,page.value*pageSize)),seenCount=computed(()=>seen.value.size)
watch(entries,()=>{page.value=Math.min(page.value,Math.max(1,Math.ceil(entries.value.length/pageSize)))})
function toggleFact(e:BillEntry){expanded.value=expanded.value===e.id?null:e.id;if(expanded.value)seen.value.add(e.id)}
function factTags(e:BillEntry){const tags=[];if(e.kind==='adjustment')tags.push({cls:'badge warn',label:'差额调整'});if(e.amount===null)tags.push({cls:'badge warn',label:'待计算'});if(e.riskReview?.decision)tags.push({cls:'badge info',label:'风险已核实'});return tags}
function quantityText(e:BillEntry){return (e.metricType==='activation'?'拉活 ':'拉新 ')+(e.quantity??e.orders??'—')+(e.metricType==='activation'?' 个':' 单')}
const readyEntries=computed(()=>entries.value.filter(e=>e.ready&&e.ownPayable&&!e.internal)),readyGroups=computed(()=>new Set(readyEntries.value.map(e=>e.payeeId))),readyTotal=computed(()=>readyEntries.value.reduce((n,e)=>n+moneyValue(e.pendingAmount),0n))
const canConfirm=computed(()=>readyEntries.value.length>0&&!state.loading.value&&!state.error.value&&!['pending','failed'].includes(state.confirmation.value?.status??''))
const confirmOpen=ref(false),acknowledged=ref(false),progressOpen=ref(false)
const progress=state.confirmation,confirming=state.confirmBusy
const progressPercent=computed(()=>progress.value?.total?Math.min(100,Math.round((progress.value.confirmed+progress.value.skipped)/progress.value.total*100)):0)
function askConfirm(){if(!canConfirm.value)return;acknowledged.value=false;confirmOpen.value=true}
async function doConfirm(){if(!acknowledged.value)return;try{await state.confirm();confirmOpen.value=false;if(progress.value?.status!=='done')progressOpen.value=true;else toast('账单已确认，后续线下转账后登记发放')}catch{}}
async function retryJob(){try{await state.retryConfirmation()}catch(e:any){toast(e?.message||'重试失败')}}
watch(()=>progress.value?.status,status=>{if(status==='done')progressOpen.value=false})
</script>
<template>
  <div>
    <div class="banner">
      <div class="grow">
        <b>确认前，先给你足够的证据。</b>
        <div class="small muted">核对报表数量、计费规则与收款人，确认后计入收入。</div>
      </div>
    </div>

    <div class="review-grid">
      <!-- 左栏：对账面板（拉新/拉活分组） -->
      <div class="card" style="margin: 0">
        <h3>对账面板</h3>
        <template v-for="m in metrics" :key="m.key">
          <section v-if="hasTypeData(m.key)">
            <h4 style="margin: 12px 0 4px; font-size: 13px">{{ m.name }}</h4>
            <div class="recon-item"><span>报表数量</span><b class="num">{{ metricOf(m.key)?.quantity }} {{ m.unit }}</b></div>
            <div class="recon-item"><span>计费数量</span><b class="num">{{ metricOf(m.key)?.billableQuantity }} {{ m.unit }}</b></div>
            <div class="recon-item"><span>待处理数量</span><b class="num">{{ metricOf(m.key)?.pendingQuantity }} {{ m.unit }}</b></div>
            <div class="recon-item"><span>不计费数量</span><b class="num">{{ metricOf(m.key)?.excludedQuantity }} {{ m.unit }}</b></div>
            <div class="recon-item"><span>报表结算</span><b class="num">{{ moneyOrMissing(metricOf(m.key)?.reportedSettlement) }}</b></div>
            <p v-if="metricOf(m.key)?.reportedSettlementMissing" class="small muted">
              {{ metricOf(m.key)?.reportedSettlementMissing }} 条未提供报表金额
            </p>
            <div class="recon-item">
              <span>成员应付{{ metricOf(m.key)?.unpricedRecords ? '已算出' : '' }}</span>
              <b class="num">{{ moneyOrMissing(metricOf(m.key)?.payable) }}</b>
            </div>
            <p v-if="metricOf(m.key)?.unpricedRecords" class="small muted">另有 {{ metricOf(m.key)?.unpricedRecords }} 条待计算</p>
          </section>
        </template>
        <div class="recon-item" style="margin-top: 8px"><span>应付合计</span><b class="num">¥{{ totalPayable ?? '—' }}</b></div>
        <div class="recon-item">
          <span>对账结果</span>
          <span class="small muted">按各成员单价计算，请逐项核对</span>
        </div>
        <hr class="hr" />
        <div class="small muted">
          抽查覆盖：已查看 {{ seenCount }} / {{ entries.length }} 条明细。可展开查看原表来源和金额计算。
        </div>
        <p v-if="summary?.staffAmount && moneyValue(summary.staffAmount)!==0n" class="small muted" style="margin-top: 8px">
          内部业绩 {{ fmtMoney(summary.staffAmount) }}，不计入成员应付。
        </p>
      </div>

      <!-- 中栏：事实卡片 -->
      <div>
        <div
          v-for="(e, i) in visibleEntries"
          :key="e.id"
          class="fact rise"
          :style="{ '--d': `${Math.min(i, 12) * 30}ms` }"
        >
          <button type="button" class="fact-head" :aria-expanded="expanded===e.id" @click="toggleFact(e)">
            <b>{{ e.keyword }}</b>
            <span v-for="t in factTags(e)" :key="t.label" :class="t.cls">{{ t.label }}</span>
            <span class="small muted">{{ e.date }} · {{ quantityText(e) }} · {{ e.payeeName }}</span>
            <span class="right small" style="color: var(--primary)">{{ expanded === e.id ? '收起 ▲' : '追溯来源 ▼' }}</span>
          </button>
          <div v-if="expanded === e.id" class="detail">
            <div class="drill"><div class="layer"><TraceDrawer :context="state.context" :entry="e"/></div><div class="arrow">↓</div><div class="layer"><b>金额计算</b><template v-if="e.calculation">{{e.calculation.quantity}} × {{fmtPrice(e.calculation.unitPrice)}} = {{fmtMoney(e.calculation.beforeRiskAmount)}}</template><p>本条应付：{{e.amount===null?'待计算':fmtMoney(e.amount)}} · 待确认：{{fmtMoney(e.pendingAmount)}}</p><p v-if="e.reason">{{e.reason}}</p></div></div>
          </div>
        </div>
        <div v-if="entries.length>pageSize" class="row-actions"><button :disabled="page===1" @click="page--">上一页</button><span>第 {{page}} 页 · 共 {{entries.length}} 条</span><button :disabled="page*pageSize>=entries.length" @click="page++">下一页</button></div><div v-if="!entries.length" class="empty">本期还没有明细数据。</div>
      </div>

      <!-- 右栏：本期财务账单 -->
      <div class="card" style="margin: 0">
        <h3>本期财务账单</h3>
        <p class="small muted">按收款人核对，确认后生成可结算收入。</p>
        <div v-for="g in groups" :key="g.payeeId" class="confirm-row">
          <div>
            <b>{{ g.name }}</b>
            <div class="small muted">合计 {{ fmtMoney(g.total) }}</div>
            <div class="small muted">已确认 {{ fmtMoney(g.confirmed) }} · 待确认 {{ fmtMoney(g.pending) }}</div>
            <p v-if="g.blockers.length" class="small" style="color: var(--warn); margin: 2px 0 0">{{ g.blockers.join('；') }}</p>
          </div>
        </div>
        <div v-if="!groups.length" class="empty">本期尚无成员应付，请查看明细中的原因。</div>
        <hr class="hr" />
        <button v-if="canConfirm" class="primary" style="width: 100%" @click="askConfirm">
          核对并确认账单（{{ readyGroups.size }} 人 · ¥{{ cashText(readyTotal) }}）
        </button>
        <div v-else class="small muted" style="text-align: center">没有可确认内容时这里不会出现确认按钮</div>
        <hr class="hr" />
        <div class="small muted">确认 = 计入成员「待到账」，并保留确认记录。此操作不发起银行转账。</div>
      </div>
    </div>

    <!-- 二次确认弹窗（输入「确认」二字） -->
    <Modal :open="confirmOpen" :busy="confirming" @close="confirmOpen = false">
      <h3>确认入账</h3>
      <p>
        将把本期 <b>{{ readyGroups.size }}</b> 位成员的就绪账单、合计
        <b class="num">¥{{ cashText(readyTotal) }}</b> 计入「待到账」。
      </p>
      <p class="small muted">确认后不可直接修改；若上游再更正，会自动生成差额调整，由你再次核对。</p>
      <label class="check"><input v-model="acknowledged" type="checkbox"/>我已核对数量、单价和收款人</label><p v-if="state.confirmError.value" role="alert">{{state.confirmError.value}}</p>
      <div class="footer">
        <button @click="confirmOpen = false">再检查一下</button>
        <button class="primary" :disabled="confirming || !acknowledged" @click="doConfirm">
          {{ confirming ? '提交中…' : '确认入账' }}
        </button>
      </div>
    </Modal>

    <p v-if="state.confirmError.value" role="alert">{{state.confirmError.value}}</p><button v-if="progress && progress.status!=='done'" @click="progressOpen=true">查看确认进度</button>
    <!-- 确认进度弹窗（jobId 轮询） -->
    <Modal :open="progressOpen" @close="progressOpen=false">
      <h3>正在确认账单</h3><p v-if="state.confirmError.value" role="alert">{{state.confirmError.value}}</p><button v-if="state.confirmError.value" @click="state.pollConfirmation()">重新读取进度</button>
      <template v-if="progress && progress.status !== 'failed'">
        <div class="progress-track" style="margin: 12px 0">
          <i :style="{ width: progressPercent + '%' }" />
        </div>
        <p class="small muted" style="text-align: center">
          {{ progress.confirmed + progress.skipped }} / {{ progress.total }} 已处理{{ progress.skipped ? `（跳过 ${progress.skipped}）` : '' }}…
        </p>
      </template>
      <template v-else-if="progress">
        <p role="alert" style="color: var(--danger)">{{ progress.error || '账单处理失败' }}</p>
        <p class="small muted">已确认 {{ progress.confirmed }} 条，剩余 {{ progress.remaining }} 条未处理。数据未变化时可重试。</p>
      </template>
      <div class="footer">
        <button @click="progressOpen=false">后台继续</button>
        <button v-if="progress?.status === 'failed'" class="primary" @click="retryJob">重试</button>
      </div>
    </Modal>
  </div>
</template>
