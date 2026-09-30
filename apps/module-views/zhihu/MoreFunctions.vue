<script setup lang="ts">
import { computed, ref } from "vue";
import {
  businessPages,
  businessLabel,
  dailyPages,
  type BusinessPage,
} from "./navigation";
const props = defineProps<{
  pages: BusinessPage[];
  role: string;
  duty?: string;
}>();
const search = ref("");
const pages = computed(() =>
  businessPages(props.pages, props.role, props.duty)
    .filter((p) => !dailyPages.includes(p.path) && p.path !== "history")
    .filter((p) => businessLabel(p, props.role).includes(search.value.trim())),
);
</script>
<template>
  <section class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">知乎</p>
        <h1>更多功能</h1>
        <p>查找业务工具，点击卡片进入。</p>
      </div>
      <router-link to="/dashboard">返回工作台</router-link>
    </header>
    <label class="function-search"
      >查找功能<input v-model="search" type="search" placeholder="输入功能名称"
    /></label>
    <div class="function-grid">
      <router-link
        v-for="p in pages"
        :key="p.path"
        class="function-card"
        :to="'/modules/zhihu/' + p.path"
        ><strong>{{ businessLabel(p, role) }}</strong
        ><span aria-hidden="true">→</span></router-link
      >
    </div>
    <p v-if="!pages.length" role="status">没有匹配的功能。</p>
  </section>
</template>
<style scoped>
.function-search {
  display: grid;
  gap: 8px;
  max-width: 420px;
}
.function-search input {
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: inherit;
  border-radius: 8px;
}
.function-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 16px;
}
.function-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  min-height: 110px;
  padding: 24px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 10px;
  color: inherit;
  text-decoration: none;
}
.function-card:hover {
  border-color: #195e62;
}
.function-card:focus-visible {
  outline: 2px solid #195e62;
  outline-offset: 3px;
}
@media (max-width: 550px) {
  .function-grid {
    grid-template-columns: 1fr;
  }
  .function-card {
    min-height: 88px;
    padding: 20px;
  }
}
</style>
