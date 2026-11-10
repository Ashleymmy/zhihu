<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import SaltBoards from '@zhihu-koc/zhihu-module-views/SaltBoards.vue'
import { http, useAuthStore } from '../context'
import { http as coreHttp } from '../../../stores/auth'
const route = useRoute(), router = useRouter(), auth = useAuthStore()
</script>
<template><SaltBoards :http="http" :core-http="coreHttp" :role="auth.user?.role || ''" :admin-duty="auth.user?.adminDuty" :initial-project-id="String(route.query.projectId || '')" :initial-account-id="String(route.query.accountId || '')" @back="router.push({path:'/projects',query:{projectId:route.query.projectId}})" /></template>
