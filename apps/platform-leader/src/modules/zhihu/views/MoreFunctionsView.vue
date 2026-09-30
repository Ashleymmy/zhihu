<script setup lang="ts">
import MoreFunctions from '@zhihu-koc/zhihu-module-views/MoreFunctions.vue'
import { useAuthStore } from '../context'
import { modulePages } from '../routes'
const auth = useAuthStore()
</script>
<template><MoreFunctions :pages="modulePages" :role="auth.user?.role ?? ''" :duty="auth.user?.adminDuty" /></template>
