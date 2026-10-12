<script setup lang="ts">
// 兼容旧模块引用：唯一流程实现为 FinanceFlow。
import FinanceFlow from './Finance/FinanceFlow.vue'
import type {EngineContext} from './context'
defineProps<{context:EngineContext;wallet?:boolean;initialFrom?:string;initialTo?:string;flow?:boolean;flowStep?:string}>()
const emit=defineEmits<{navigate:[path:string]}>()
</script>
<template><FinanceFlow :context="context" @navigate="emit('navigate',$event)" :wallet="wallet" :initial-period="initialFrom?.slice(0,7)"/></template>
