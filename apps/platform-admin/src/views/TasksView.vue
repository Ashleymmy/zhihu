<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { PlatformTasks } from "@zhihu-koc/shared-components";
const route = useRoute(),
  router = useRouter();
</script>
<template>
  <PlatformTasks
    :hall="route.path === '/task-hall'"
    :initial-project-id="String(route.query.projectId || '')"
    @navigate="router.push"
  />
</template>
