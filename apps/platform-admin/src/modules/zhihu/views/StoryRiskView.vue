<script setup lang="ts">
import {useRouter} from 'vue-router'
import Workspace from '@zhihu-koc/zhihu-module-views/Workspace.vue'
import {http,useAuthStore} from '../context'
import {http as coreHttp} from '../../../stores/auth'
const auth=useAuthStore(),router=useRouter()
</script>
<template><Workspace :http="http" :core-http="coreHttp" :role="auth.user?.role??''" :user-id="auth.user?.id??''" :admin-duty="auth.user?.adminDuty" section="risk" @navigate="router.push" /></template>
