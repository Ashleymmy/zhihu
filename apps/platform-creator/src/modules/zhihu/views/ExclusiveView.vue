<script setup lang="ts">
import Workspace from '@zhihu-koc/zhihu-module-views/Workspace.vue'
import { http, useAuthStore } from '../context'
import { http as coreHttp } from '../../../stores/auth'
const auth = useAuthStore()
</script>
<template>
  <Workspace
    :http="http"
    :core-http="coreHttp"
    :role="auth.user?.role ?? ''"
    :user-id="auth.user?.id ?? ''"
  />
</template>
