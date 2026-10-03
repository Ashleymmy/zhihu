<script setup lang="ts">
import {ref} from 'vue'
import {useRouter} from 'vue-router'
import Workspace from '@zhihu-koc/zhihu-module-views/Workspace.vue'
import MetricsSummary from './MetricsSummary.vue'
import {http,useAuthStore} from '../context'
import {http as coreHttp} from '../../../stores/auth'
const auth=useAuthStore(),router=useRouter(),showMetrics=ref(false)
</script>
<template><div class="page-stack"><Workspace :key="auth.user?.id" :http="http" :core-http="coreHttp" :role="auth.user?.role??''" :user-id="auth.user?.id??''" :parent-id="auth.user?.parentId" :permissions="auth.user?.permissions" :admin-duty="auth.user?.adminDuty" section="activity" @navigate="router.push" /><details class="legacy-metrics" @toggle="showMetrics=($event.target as HTMLDetailsElement).open"><summary>流量与收益（全部授权范围）</summary><MetricsSummary v-if="showMetrics" /></details></div></template>
<style scoped>.legacy-metrics{border-top:1px solid var(--line,#ddd);padding-top:20px;margin-top:28px}.legacy-metrics summary{cursor:pointer;color:var(--ink-soft,#637078);padding:12px 0}</style>
