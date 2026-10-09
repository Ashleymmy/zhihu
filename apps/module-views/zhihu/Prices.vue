<script setup lang="ts">
import {computed,ref} from 'vue'
import {RateSettings} from '@zhihu-koc/shared-components'
import type {EngineContext} from './context'
const props=defineProps<{context:EngineContext}>(),open=ref(false)
const canManage=computed(()=>props.context.role==='admin'&&props.context.adminDuty!=='operations')
</script>
<template>
  <section class="work-card">
    <h2>成员报价已合并到计费规则</h2>
    <p>收益按执行人角色计算，已确认账目保留当时的单价。</p>
    <button v-if="canManage" class="primary" @click="open=true">查看与设置单价</button>
    <router-link v-else :to="context.role==='admin'?'/tasks':'/income'">{{context.role==='admin'?'查看任务':'查看我的收益'}}</router-link>
    <RateSettings :open="open" :http="context.coreHttp" :project-id="context.scope.projectId" module-id="zhihu" @close="open=false" />
  </section>
</template>
