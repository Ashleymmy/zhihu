<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { PlatformIncome } from "@zhihu-koc/shared-components";
const route = useRoute(),
  router = useRouter();
</script>
<template>
  <PlatformIncome
    :initial-project-id="String(route.query.projectId || '')"
    @navigate="router.push"
  />
</template>
