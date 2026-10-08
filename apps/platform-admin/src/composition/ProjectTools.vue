<script setup lang="ts">
import AgencySettings from '@zhihu-koc/zhihu-module-views/AgencySettings.vue'
import {http as zhihuHttp} from '../modules/zhihu/context'
import { computed, onMounted, ref } from 'vue'
import { RateSettings } from '@zhihu-koc/shared-components'
import { http, useAuthStore } from '../stores/auth'
import { workspace } from '../stores/platform'
import { canAccessPath } from '../access'
const props = defineProps<{ projectId: string }>()
const agencyAccount=ref('')
const auth=useAuthStore(), selectedModule=ref('')
const accounts = ref<{ id: string; moduleId: string; status: string }[]>([]), error = ref('')
const rateModules=computed(()=>canAccessPath(auth.user,'/rates')?workspace.modules.value.filter(m=>m.status==='enabled'&&m.capabilities.includes('role-rates')&&accounts.value.some(a=>a.status==='active'&&a.moduleId===m.id)):[])
async function load() { error.value = ''; try { accounts.value = await http.get('/projects/' + props.projectId + '/integrations') } catch { error.value = '项目工具加载失败，请重试。' } }
onMounted(load)
const tools = [
  { label: '推广活动与渠道', path: '/modules/zhihu/operations', tab: 'channels' },
  { label: '报表中的渠道名称', path: '/modules/zhihu/operations', tab: 'channels' },
  { label: '盐选榜单', path: '/modules/zhihu/salt' },
  { label: '内容标签', path: '/modules/zhihu/tags' },
  { label: '评论截流', path: '/modules/zhihu/comments' },
]
</script>
<template><article v-if="rateModules.length" class="panel project-tools"><h2>计费规则</h2><button v-for="module in rateModules" :key="module.id" @click="selectedModule=module.id">查看与设置{{ module.name }}单价</button></article><article class="panel project-tools"><h2>项目工具</h2><p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p><div v-for="account in accounts.filter(a=>a.moduleId==='zhihu'&&a.status==='active')" :key="account.id"><button @click="agencyAccount=account.id">拉活代理名称</button><router-link v-for="tool in tools" :key="tool.label" :to="{path:tool.path,query:{projectId,accountId:account.id,...(tool.tab?{tab:tool.tab}:{})}}">{{ tool.label }} →</router-link></div></article><RateSettings v-if="selectedModule" :open="true" :project-id="projectId" :module-id="selectedModule" :http="http" @close="selectedModule=''" /><AgencySettings :open="!!agencyAccount" :http="zhihuHttp" :scope="{projectId,accountId:agencyAccount}" @close="agencyAccount=''" @saved="agencyAccount=''" /></template>
<style scoped>.project-tools{padding:20px}.project-tools h2{font-size:18px;margin:0 0 15px}.project-tools>div{display:flex;gap:12px;flex-wrap:wrap}.project-tools a{padding:10px 12px;background:var(--ground,#f3f3ef);border-radius:6px;text-decoration:none}.project-tools button{padding:11px 14px;min-height:44px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:#195e62;cursor:pointer}</style>
