<script setup lang="ts">
import { http } from './context'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import ModuleNavigation from '@zhihu-koc/zhihu-module-views/ModuleNavigation.vue'
import { modulePages } from './routes'
const auth = useAuthStore(), route = useRoute()
</script>
<template><ModuleNavigation :http="http" :pages="modulePages" :role="auth.user?.role ?? ''" :duty="auth.user?.adminDuty" :current-path="route.path" /></template>
