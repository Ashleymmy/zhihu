<script setup lang="ts">
import {computed,inject,watch} from 'vue'
import {CashWallet} from '@zhihu-koc/shared-components'
import type {PeriodState} from '../composables/usePeriodState'
import {fmtMoney,moneyValue,cashText} from '../composables/useFinanceApi'
const state=inject<PeriodState>('financeState')!
const total=(status:string[])=>cashText(state.withdrawals.value.filter(w=>status.includes(w.status)).reduce((n,w)=>n+moneyValue(w.netAmount??w.amount),0n))
const paid=computed(()=>total(['paid'])),pending=computed(()=>total(['pending','approved']))
watch(()=>state.statusKey.value,(status,previous)=>{if(previous==='payout'&&status==='closed')state.gotoStep(5)})
</script>
<template><div><div class="metric-grid"><div class="metric rise" style="--d:0ms"><span>本期成员应付</span><strong>{{fmtMoney(state.totalPayable.value)}}</strong></div><div class="metric rise" style="--d:50ms"><span>项目待开放款项</span><strong>{{fmtMoney(state.funding.amount)}}</strong></div><div class="metric rise" style="--d:100ms"><span>项目待线下发放</span><strong>¥{{pending}}</strong></div><div class="metric rise" style="--d:150ms"><span>项目已登记发放</span><strong>¥{{paid}}</strong></div></div><div class="banner"><div class="grow"><b>实际转账后，再登记发放</b><p class="small muted">提现和款项开放按项目全部日期办理，包含跨账期余额。这里记录微信、支付宝或银行卡的线下发放。</p></div></div><CashWallet :http="state.context.coreHttp" :scope="{projectId:state.context.scope.projectId,accountId:state.context.scope.accountId,moduleId:'zhihu'}" @updated="state.loadPeriod()"/><div v-if="state.closed.value" class="row-actions"><button class="primary" @click="state.gotoStep(5)">查看记录与导出 →</button></div></div></template>
