<script setup lang="ts">
import {inject,computed} from 'vue'
import type {CoreWorkspace} from './core-workspace'
const workspace=inject<CoreWorkspace>('opc')!
const modules=computed(()=>workspace.modules.value.filter(m=>m.status==='enabled'))
</script>
<template><section class="page-stack"><header class="page-header"><div><h1>{{workspace.role.value==='admin'?'财务中心':'收入与提现'}}</h1><p>选择业务，查看对应账单与收款进度。</p></div></header><article class="panel" style="padding:28px"><p>各业务确认的收入统一记录到公共资金账。可提现金额由财务核对款项可用后开放。</p><p v-if="!modules.length">还没有可使用的业务，请联系运营人员开通项目权限。</p><router-link v-for="m in modules" :key="m.id" :to="m.entryPath" style="display:block;padding:16px 0">进入{{m.name}}</router-link></article></section></template>