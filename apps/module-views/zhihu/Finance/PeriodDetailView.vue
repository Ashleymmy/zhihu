<script setup lang="ts">
/**
 * 账期详情外壳（demo viewPeriod）
 * 结构 1:1 对齐 demo：返回行（ghost 按钮 + h1 + 状态徽章 + 项目说明）+ .stepper 五步 + 动态 body
 */
import { inject,markRaw } from 'vue'
import type { PeriodState } from './composables/usePeriodState'
import { STEPS, periodTitle } from './composables/usePeriodState'
import StepUpload from './components/StepUpload.vue'
import StepTodo from './components/StepTodo.vue'
import StepReview from './components/StepReview.vue'
import StepPayout from './components/StepPayout.vue'
import StepArchive from './components/StepArchive.vue'

const stepComponents=[StepUpload,StepTodo,StepReview,StepPayout,StepArchive].map(markRaw)
const state = inject<PeriodState>('financeState')!
const toast = inject<(text: string) => void>('financeToast')!

function onStepClick(n: 1 | 2 | 3 | 4 | 5) {
  if (!state.gotoStep(n)) toast('这一步还没有到：请先完成当前阶段')
}
</script>

<template>
  <div>
    <div class="flex" style="margin-bottom: 16px">
      <button class="ghost" :disabled="state.confirmBusy.value" @click="state.backToPeriods()">← 账期列表</button>
      <h1 style="font-size: 20px; margin: 0">{{ periodTitle(state.periodId.value) }}</h1>
      <span :class="state.statusBadgeClass.value">{{ state.statusLabel.value }}</span>
      <span class="right small muted">项目：知乎</span>
    </div>

    <nav class="stepper" aria-label="财务处理步骤">
      <button type="button"
        v-for="st in STEPS"
        :key="st.n"
        class="step"
        :class="{
          done: st.n < state.stepOfStatus.value,
          current: st.n === state.stepOfStatus.value,
          locked: st.n > state.stepOfStatus.value,
        }"
        :title="st.n > state.stepOfStatus.value ? '请先完成当前阶段' : ''"
        :aria-disabled="st.n > state.stepOfStatus.value || state.loading.value"
        :aria-current="st.n===state.stepOfStatus.value?'step':undefined"
        @click="onStepClick(st.n)"
      >
        <div class="no">{{ st.n < state.stepOfStatus.value ? '✓' : st.n }}</div>
        <div class="name">{{ st.name }}</div>
        <div class="sub">{{ st.sub }}</div>
        <span v-if="st.n === 2 && state.todoCount.value > 0" class="dot" />
      </button>
    </nav>
    <p v-if="state.step.value!==state.stepOfStatus.value" class="small muted">正在回看：{{STEPS[state.step.value-1]?.name}}</p>
    <div v-if="state.error.value" class="banner warn" role="alert">{{state.error.value}}<button @click="state.loadPeriod()">重新加载</button></div>
    <div v-if="state.loading.value&&!state.workbench.value" class="empty"><span class="spin" /> 正在加载账期数据…</div>
    <div v-else><div class="row-actions"><button :disabled="state.loading.value" @click="state.loadPeriod()">刷新结果</button></div><Transition name="finance-step" mode="out-in"><KeepAlive><component :is="stepComponents[state.step.value-1]" :key="state.periodId.value+':'+state.step.value" class="step-body"/></KeepAlive></Transition></div>
  </div>
</template>
