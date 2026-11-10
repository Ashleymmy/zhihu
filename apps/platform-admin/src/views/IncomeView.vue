<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { PlatformIncome } from "@zhihu-koc/shared-components";
const route = useRoute(),
  router = useRouter();
</script>
<template>
  <PlatformIncome
    :initial-project-id="String(route.query.projectId || '')"
    :key="JSON.stringify(route.query)"
    :initial-account-id="String(route.query.accountId || '')"
    :initial-module-id="String(route.query.moduleId || '')"
    :initial-from="String(route.query.from || '')"
    :initial-to="String(route.query.to || '')"
    :initial-group="String(route.query.group || '')"
    :initial-performer-id="String(route.query.performerId || '')"
    @navigate="router.push"
  />
</template>
