<script setup lang="ts">
/**
 * 账期列表（demo viewPeriods）
 * 结构 1:1 对齐 demo：banner + period-card（title+badge / nums 三指标 / 第X步提示）
 * 数据：GET /workbench/periods（分页账期）+ 每月 GET /workbench 读取金额与待办
 */
import { inject, onMounted, onUnmounted, ref } from 'vue'
import type { PeriodState } from './composables/usePeriodState'
import { periodTitle } from './composables/usePeriodState'
import { errorText } from '../context'
import {
  fmtMoney,
  moneyValue,
  cashText,
  type PeriodRow,
  type WorkbenchView,
} from './composables/useFinanceApi'

const state = inject<PeriodState>('financeState')!
const toast = inject<(text: string) => void>('financeToast')!

interface PeriodCard {
  row: PeriodRow
  wb: WorkbenchView | null
  todoCount: number
  summaryError: string
}

const cards = ref<PeriodCard[]>([])
const total = ref(0)
const page = ref(1)
const busy = ref(false)
const loadError = ref('')
let generation = 0

async function loadSummary(card: PeriodCard, current: number) {
  try {
    const wb=await state.api.getWorkbench(card.row.from,card.row.to)
    if(current!==generation)return
    card.wb=wb
    card.todoCount=new Set(wb.entries.filter(e=>e.ownPayable&&!e.ready&&e.status!=='confirmed'&&e.reasonCode).map(e=>e.factId)).size
    card.summaryError = ''
  } catch (e) {
    if (current === generation) card.summaryError = errorText(e)
  }
}

async function load() {
  const current = ++generation
  busy.value = true
  loadError.value = ''
  try {
    const r = await state.api.getPeriods(page.value)
    if (current !== generation) return
    total.value = r.total
    cards.value = r.list.map((row) => ({ row, wb: null, todoCount: 0, summaryError: '' }))
    await Promise.allSettled(cards.value.map((c) => loadSummary(c, current)))
  } catch (e) {
    if (current === generation) loadError.value = errorText(e)
  } finally {
    if (current === generation) busy.value = false
  }
}

/** 卡片三指标（拉新 + 拉活合并，null 金额不计） */
function totalPayable(c: PeriodCard): string {
  if (!c.wb) return '—'
  if (c.wb.processingImports?.length&&!c.wb.entries.length) return '待计算'
  const s = c.wb.summary
  const sum = moneyValue(s.byType.newUser.payable) + moneyValue(s.byType.activation.payable)
  return '¥' + cashText(sum)
}

function totalOrders(c: PeriodCard): string {
  return c.wb?`${c.wb.summary.byType.newUser.quantity} 单 / ${c.wb.summary.byType.activation.quantity} 个`:'—'
}

function todoText(c: PeriodCard): string {
  if (!c.wb) return '—'
  return `${c.todoCount} 项`
}

function statusOf(c: PeriodCard): { cls: string; label: string; stepText: string } {
  if (!c.wb) return {cls:'badge',label:c.summaryError?'读取失败':'读取中',stepText:''}
  if (c.wb.processingImports?.length) return {cls:'badge warn',label:c.wb.processingImports.some(r=>r.status==='failed')?'报表处理待恢复':'报表处理中',stepText:'第 1 / 5 步 · 查看处理进度'}
  if (c.todoCount > 0) return { cls: 'badge danger', label: '待处理', stepText: '第 2 / 5 步 · 待处理' }
  const hasReady = c.wb.groups.some((g) => g.ready > 0)
  if (hasReady) return { cls: 'badge info', label: '待确认', stepText: '第 3 / 5 步 · 核对与确认' }
  return c.wb.entries.some(e=>e.status==='confirmed')?{cls:'badge info',label:'账单已确认',stepText:'进入后查看实际发放进度'}:{cls:'badge warn',label:'待核对',stepText:'进入查看明细'}
}

async function open(c: PeriodCard) {
  await state.openPeriod(c.row.id)
}

onMounted(load)
onUnmounted(() => generation++)
</script>

<template>
  <div>
    <div class="row-actions" style="margin-bottom:16px"><button class="primary" @click="state.openPeriod(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}).slice(0,7)).then(()=>{state.step.value=1})">上传报表</button></div><div class="banner">
      <div class="grow">
        <b>按账期工作，而不是面对一屏功能。</b>
        <div class="small muted">
          每个账期都是一条有状态的流水线：上传 → 待处理 → 确认 → 放款 → 归档。点击进入「{{ cards[0] ? periodTitle(cards[0].row.id) : '本月' }}」开始。
        </div>
      </div>
    </div>

    <div v-if="busy && !cards.length" class="empty"><span class="spin" /> 正在读取账期…</div>
    <div v-if="loadError" class="empty" role="alert">
      {{ loadError }} <button @click="load">重新加载</button>
    </div>

    <template v-else>
      <div
        v-for="(c, i) in cards"
        :key="c.row.id"
        class="card period-card rise" role="button" tabindex="0" @keydown.enter="open(c)" @keydown.space.prevent="open(c)"
        :style="{ '--d': `${i * 60}ms` }"
        @click="open(c)"
      >
        <div>
          <div class="title">{{ periodTitle(c.row.id) }}</div>
          <span :class="statusOf(c).cls">{{ statusOf(c).label }}</span>
        </div>
        <div class="nums">
          <div><b>{{ totalPayable(c) }}</b><span>应付合计</span></div>
          <div><b>{{ todoText(c) }}</b><span>待处理账单</span></div>
          <div><b>{{ totalOrders(c) }}</b><span>拉新订单 / 拉活量</span></div>
        </div>
        <div class="small muted">
          <template v-if="c.summaryError">金额读取失败 <button class="ghost" @click.stop="loadSummary(c, generation)">重试</button></template>
          <template v-else-if="!c.wb">正在读取金额…</template>
          <template v-else>{{ statusOf(c).stepText }}</template>
        </div>
      </div>

      <div v-if="!cards.length && !busy" class="card empty">
        还没有正式导入的报表<br />
        <span class="small">上传第一份报表后，对应账期会显示在这里。</span>
      </div>

      <div v-if="total > 12" class="flex" style="justify-content: center; margin-top: 14px">
        <button :disabled="busy || page === 1" @click="page--; load()">上一页</button>
        <span class="small muted">第 {{ page }} 页</span>
        <button :disabled="busy || page * 12 >= total" @click="page++; load()">下一页</button>
      </div>
    </template>
  </div>
</template>
