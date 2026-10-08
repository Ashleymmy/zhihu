<script setup lang="ts">
import { computed, inject } from "vue";
import type { CoreWorkspace } from "./core-workspace";
const workspace = inject<CoreWorkspace>("opc")!;
const modules = computed(() =>
  workspace.modules.value.filter(
    (m) =>
      m.status === "enabled" &&
      m.financeHistoryPath?.startsWith("/") &&
      !m.financeHistoryPath.startsWith("//"),
  ),
);
</script>
<template>
  <details v-if="modules.length" class="history-links">
    <summary>历史账目（只读）</summary>
    <router-link v-for="m in modules" :key="m.id" :to="m.financeHistoryPath!"
      >{{ m.name }}历史账目</router-link
    >
  </details>
</template>
<style scoped>
.history-links {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--muted);
}
summary {
  cursor: pointer;
  padding: 10px 0;
  min-height: 24px;
}
.history-links a {
  display: inline-block;
  padding: 12px 16px 12px 0;
  min-height: 24px;
  color: var(--ink);
}
</style>
