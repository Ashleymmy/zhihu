<script setup lang="ts">
import {nextTick,onBeforeUnmount,ref,watch} from 'vue'
const props=defineProps<{open:boolean;width?:string;busy?:boolean;title?:string}>()
const emit=defineEmits<{close:[]}>(),dialog=ref<HTMLDialogElement>()
function close(){if(!props.busy)emit('close')}
watch(()=>props.open,async open=>{await nextTick();if(open&&!dialog.value?.open){dialog.value?.setAttribute('aria-label',props.title||dialog.value.querySelector('h3,h2')?.textContent||'操作窗口');dialog.value?.showModal()}else if(!open&&dialog.value?.open)dialog.value.close()},{immediate:true})
onBeforeUnmount(()=>dialog.value?.close())
</script>
<template><Teleport to="body"><dialog ref="dialog" class="finance-flow-modal" @cancel.prevent="close" @click="$event.target===dialog&&close()"><div class="dialog" :style="width?{maxWidth:width}:{}"><slot/></div></dialog></Teleport></template>
<style scoped>
dialog.finance-flow-modal{margin:0;width:100vw;height:100dvh;max-width:none;max-height:none;border:0;box-sizing:border-box}dialog.finance-flow-modal:not([open]){display:none}dialog.finance-flow-modal::backdrop{background:transparent}.dialog{box-sizing:border-box;min-width:0;overflow-wrap:anywhere}dialog :deep(.footer){flex-wrap:wrap}dialog :deep(input),dialog :deep(textarea){box-sizing:border-box}dialog :deep(input[type=checkbox]){width:18px;min-height:18px;accent-color:#195e62}dialog :deep(.check){display:flex;align-items:center;gap:10px}@media(max-width:600px){dialog.finance-flow-modal{padding:16px}.dialog{padding:18px!important}}
</style>
