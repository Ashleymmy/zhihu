<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import SaltBoards from "@zhihu-koc/zhihu-module-views/SaltBoards.vue";
import { http, useAuthStore } from "../context";
import { http as coreHttp } from "../../../stores/auth";
const auth = useAuthStore(),
  route = useRoute(),
  router = useRouter();
</script>
<template>
  <SaltBoards
    :http="http"
    :core-http="coreHttp"
    :role="auth.user?.role ?? ''"
    :admin-duty="auth.user?.adminDuty"
    :initial-project-id="
      typeof route.query.projectId === 'string'
        ? route.query.projectId
        : undefined
    "
    :initial-account-id="
      typeof route.query.accountId === 'string'
        ? route.query.accountId
        : undefined
    "
    @back="router.push('/projects')"
  />
</template>
