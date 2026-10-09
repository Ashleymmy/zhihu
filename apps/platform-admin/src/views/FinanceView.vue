<script setup lang="ts">
import { useRoute } from "vue-router";
import { PublicFinance } from "@zhihu-koc/shared-components";
const route = useRoute();
</script>
<template>
  <PublicFinance
    :initial-project-id="String(route.query.projectId || '')"
    :initial-account-id="String(route.query.accountId || '')"
    :initial-from="String(route.query.from || '')"
    :initial-to="String(route.query.to || '')"
  />
</template>
