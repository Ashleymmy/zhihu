<script setup lang="ts">
import Objections from '@zhihu-koc/zhihu-module-views/Finance/components/Objections.vue'
import {http} from '../context'
defineProps<{scope:{projectId:string;accountId:string};earningLineId?:string}>()
</script>
<template><Objections :key="scope.projectId+':'+scope.accountId+':'+(earningLineId||'')" :context="{http,scope}" mine :earning-line-id="earningLineId"/></template>
