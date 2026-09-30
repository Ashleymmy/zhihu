<script setup lang="ts">
import { StaffManager } from '@zhihu-koc/shared-components'
import { http, useAuthStore } from '../stores/auth'
const auth = useAuthStore()
</script>
<template><section class="page-stack"><header class="page-header"><h1>角色与账号</h1></header><StaffManager :http="http" :actor-role="auth.user?.role" /></section></template>
