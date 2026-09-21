<script setup lang="ts">
import {computed} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import Workspace from '@zhihu-koc/zhihu-module-views/Workspace.vue'
import {http,useAuthStore} from '../context'
import {http as coreHttp} from '../../../stores/auth'
const auth=useAuthStore(),route=useRoute(),router=useRouter()
const section=computed(()=>String(route.meta.section||'operations'))
</script>
<template><Workspace :http="http" :core-http="coreHttp" :role="auth.user?.role??''" :user-id="auth.user?.id??''" :parent-id="auth.user?.parentId" :admin-duty="auth.user?.adminDuty" :section="section" :initial-project-id="String(route.query.projectId||'')" :initial-account-id="String(route.query.accountId||'')" :active-tab="String(route.query.tab||'keywords')" :initial-keyword="String(route.query.keyword||'')" @navigate="router.push" /></template>