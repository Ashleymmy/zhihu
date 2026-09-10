<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { modulePages } from './routes'
const route = useRoute(),
  router = useRouter()
function navigate(event: Event) {
  void router.push((event.target as HTMLSelectElement).value)
}
</script>
<template>
  <section class="page-stack">
    <div class="module-toolbar">
      <strong>知乎业务</strong
      ><label
        >业务功能
        <select aria-label="知乎业务功能" :value="route.path.replace(/\/$/, '')" @change="navigate">
          <option
            v-for="page in modulePages"
            :key="String(page.name)"
            :value="('/modules/zhihu/' + page.path).replace(/\/$/, '')"
          >
            {{ page.meta?.title }}
          </option>
        </select></label
      ><router-link to="/dashboard">返回 OPC 工作台</router-link>
    </div>
    <router-view />
  </section>
</template>
<style scoped>
.module-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.module-toolbar label {
  flex: 1;
  min-width: 180px;
}
.module-toolbar select {
  max-width: 100%;
  padding: 8px;
}
.module-toolbar a {
  font-size: 13px;
}
</style>
