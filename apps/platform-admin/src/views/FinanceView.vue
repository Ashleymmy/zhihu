<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import type { SettlementScope } from '@zhihu-koc/shared-contracts/core';
import { PublicFinance } from "@zhihu-koc/shared-components";
const route = useRoute(), router = useRouter();
function context(value: SettlementScope) { void router.replace({query:{...route.query,...value}}); }
</script>
<template>
  <PublicFinance
    :initial-project-id="String(route.query.projectId || '')"
    :initial-account-id="String(route.query.accountId || '')"
    :initial-from="String(route.query.from || '')"
    :initial-to="String(route.query.to || '')"
    :initial-leader-id="String(route.query.leaderId || route.query.payeeId || '')"
    :initial-import-id="String(route.query.importId || '')"
    @context="context"
    @navigate="router.push"
  />
</template>
