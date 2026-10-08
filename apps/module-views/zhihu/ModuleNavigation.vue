<script setup lang="ts">
import { computed } from "vue";
import type { HttpClient } from "@zhihu-koc/shared-services/core";
import FinanceHistory from "./FinanceHistory.vue";
import {
  retiredFinancePages,
  type BusinessPage,
} from "./navigation";
const props = defineProps<{
  pages: BusinessPage[];
  http: HttpClient;
  role: string;
  duty?: string;
  currentPath: string;
}>();
const mergedFinance = computed(() => retiredFinancePages.some(p => props.currentPath.endsWith('/' + p)));
const financeDestination = computed(() => ['admin', 'developer', 'operator'].includes(props.role)
  ? { path: '/finance', title: '财务' }
  : { path: '/income', title: '我的收益' });
</script>
<template>
  <section class="zhihu-module page-stack">
    <section v-if="mergedFinance" class="merged-page" role="status">
      <h1>这个功能已合并到“{{ financeDestination.title }}”</h1>
      <p>日常操作请从统一入口继续，下方保留历史记录。</p>
      <router-link :to="financeDestination.path" class="primary-action">前往{{ financeDestination.title }}</router-link>
    </section>
    <FinanceHistory v-if="mergedFinance" :http="http" :role="role" :current-path="currentPath" />
    <router-view v-else />
  </section>
</template>
<style scoped>
.zhihu-module {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
}
.merged-page { padding: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
.merged-page h1 { font-size: 24px; overflow-wrap: anywhere; }
.merged-page a { display: inline-flex; max-width: 100%; text-decoration: none; }
</style>
