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
    :initial-task="
      route.query.taskId && route.query.moduleId && route.query.accountId
        ? {
            taskId: String(route.query.taskId),
            moduleId: String(route.query.moduleId),
            accountId: String(route.query.accountId),
          }
        : undefined
    "
    @navigate="router.push"
  />
</template>
