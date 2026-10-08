<script setup lang="ts">
import { computed } from "vue";
import {
  businessPages,
  businessLabel,
  dailyPages,
  retiredFinancePages,
  type BusinessPage,
} from "./navigation";
const props = defineProps<{
  pages: BusinessPage[];
  role: string;
  duty?: string;
  currentPath: string;
}>();
const pages = computed(() =>
  businessPages(props.pages, props.role, props.duty).filter((p) =>
    dailyPages.includes(p.path),
  ),
);
const showDaily = computed(
  () =>
    dailyPages.some((p) => props.currentPath.endsWith("/" + p)) ||
    props.currentPath.endsWith("/keywords") ||
    props.currentPath.endsWith("/works/new"),
);
const mergedFinance = computed(() => retiredFinancePages.some(p => props.currentPath.endsWith('/' + p)));
const financeDestination = computed(() => ['admin', 'developer', 'operator'].includes(props.role)
  ? { path: '/modules/zhihu/finance', title: '财务做账' }
  : { path: '/modules/zhihu/wallet', title: '收入与提现' });
</script>
<template>
  <section class="zhihu-module page-stack">
    <nav v-if="showDaily" class="module-toolbar" aria-label="知乎业务导航">
      <router-link
        v-for="p in pages"
        :key="p.path"
        :to="'/modules/zhihu/' + p.path"
        >{{ businessLabel(p, role) }}</router-link
      >
      <router-link class="back" to="/dashboard">返回工作台</router-link>
    </nav>
    <section v-if="mergedFinance" class="merged-page" role="status">
      <h1>这个功能已合并到“{{ financeDestination.title }}”</h1>
      <p>请从统一入口查看收益和收款进度。</p>
      <router-link :to="financeDestination.path" class="primary-action">前往{{ financeDestination.title }}</router-link>
    </section>
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
.module-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
}
.module-toolbar a {
  padding: 10px 14px;
  border-radius: 7px;
  text-decoration: none;
  font-size: 14px;
}
.module-toolbar .router-link-active {
  background: #195e62;
  color: white;
}
.module-toolbar .back {
  margin-left: auto;
}
@media (max-width: 700px) {
  .module-toolbar {
    gap: 4px;
    padding: 8px;
  }
  .module-toolbar a {
    flex: 1 1 auto;
    text-align: center;
    padding: 11px 8px;
  }
  .module-toolbar .back {
    margin-left: 0;
  }
}
</style>
