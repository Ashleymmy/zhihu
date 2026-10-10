<script setup lang="ts">
import type {EngineContext} from '../context'
import Finance from '../Finance.vue'
import PeriodsView from './PeriodsView.vue'
const props=defineProps<{context:EngineContext;initialFrom?:string;initialTo?:string;active?:boolean;step?:string}>()
const emit=defineEmits<{open:[period:{from:string;to:string},step:string];back:[];step:[value:string];period:[value:{from:string;to:string}];navigate:[path:string]}>()
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
</script>
<template><div><PeriodsView v-if="!active" :context="context" @open="emit('open',$event,'review')" @upload="emit('open',{from:today.slice(0,7)+'-01',to:today},'upload')"/><template v-else><button class="period-back" @click="emit('back')">← 账期列表</button><Finance :context="context" :initial-from="initialFrom" :initial-to="initialTo" flow :flow-step="step" @step="emit('step',$event)" @period="emit('period',$event)" @navigate="emit('navigate',$event)"/></template></div></template>
<style scoped>.period-back{border:0;background:none;color:var(--primary,#195e62);font:inherit;cursor:pointer;min-height:44px;margin-bottom:10px}</style>
