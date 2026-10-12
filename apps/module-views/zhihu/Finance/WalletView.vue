<script setup lang="ts">
import {inject} from 'vue'
import {PlatformIncome} from '@zhihu-koc/shared-components'
import type {EngineContext} from '../context'
const context=inject<EngineContext>('financeContext')!
const emit=defineEmits<{navigate:[path:string]}>()
</script>
<template><PlatformIncome :initial-project-id="context.scope.projectId" @navigate="emit('navigate',$event)"/></template>
