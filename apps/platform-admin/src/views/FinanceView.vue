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
    :initial-module-id="String(route.query.moduleId || '')"
    :initial-settlement-id="String(route.query.settlementId || '')"
    :initial-withdrawal-id="String(route.query.withdrawalId || '')"
    :initial-source-id="String(route.query.sourceId || '')"
    :initial-metric-type="String(route.query.metricType || '')"
    @context="context"
    @navigate="router.push"
  />
</template>
