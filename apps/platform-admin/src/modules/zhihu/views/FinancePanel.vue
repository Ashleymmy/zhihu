<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {useRoute,useRouter} from "vue-router";
import Finance from "@zhihu-koc/zhihu-module-views/Finance/FinanceFlow.vue";
import { http, useAuthStore } from "../context";
import { http as coreHttp } from "../../../stores/auth";
const props = defineProps<{
  scope: { projectId: string; accountId: string };
  initialFrom?: string;
  initialTo?: string;
}>();
const route=useRoute(),router=useRouter();
const initialPeriod=ref(String(route.query.from||'').slice(0,7));
const {period,from,to,step,...baseQuery}=route.query;
if(period||from||to||step)void router.replace({query:baseQuery});
type EngineOptions = InstanceType<
  typeof Finance
>["$props"]["context"]["options"];
const auth = useAuthStore(),
  options = ref<EngineOptions | null>(null),
  loading = ref(false),
  error = ref("");
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  options.value = null;
  try {
    const result = await http.get<EngineOptions>(
      "/attribution-options",
      props.scope,
    );
    if (current === generation) options.value = result;
  } catch (e) {
    if (current === generation)
      error.value =
        e instanceof Error ? e.message : "项目资料暂时未加载，请重试。";
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => [props.scope.projectId, props.scope.accountId], load, {
  immediate: true,
});
const context = computed(() => ({
  http,
  coreHttp,
  scope: props.scope,
  role: "admin",
  userId: auth.user?.id ?? "",
  parentId: auth.user?.parentId ?? null,
  adminDuty: auth.user?.adminDuty ?? "all",
  options: options.value!,
}));
</script>
<template>
  <div class="finance-project-panel" :aria-busy="loading">
    <p v-if="loading" role="status">正在读取项目资料…</p>
    <div v-else-if="error" role="alert">
      <p>{{ error }}</p>
      <button @click="load">重新加载</button>
    </div>
    <Finance
      v-else-if="options"
      :key="scope.projectId + ':' + scope.accountId"
      :context="context"
      :initial-period="initialPeriod"
      @navigate="router.push"
    />
  </div>
</template>
