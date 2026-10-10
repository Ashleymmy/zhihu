<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {useRoute,useRouter} from "vue-router";
import Finance from "@zhihu-koc/zhihu-module-views/Finance/PeriodDetailView.vue";
import { http, useAuthStore } from "../context";
import { http as coreHttp } from "../../../stores/auth";
const props = defineProps<{
  scope: { projectId: string; accountId: string };
  initialFrom?: string;
  initialTo?: string;
}>();
const route=useRoute(),router=useRouter();
const active=computed(()=>route.query.period==='current'||!!route.query.from);
function open(period:{from:string;to:string},step:string){void router.push({query:{...route.query,projectId:props.scope.projectId,accountId:props.scope.accountId,period:'current',...period,step}})}
function back(){const {period,from,to,step,...rest}=route.query;void router.push({query:rest})}
function setStep(step:string){void router.replace({query:{...route.query,step}})}
function setPeriod(period:{from:string;to:string}){void router.replace({query:{...route.query,...period,step:'todo'}})}
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
      :initial-from="String(route.query.from||initialFrom||'')"
      :initial-to="String(route.query.to||initialTo||'')"
      :active="active" :step="String(route.query.step||'review')" @open="open" @back="back" @step="setStep" @period="setPeriod" @navigate="router.push($event)"
    />
  </div>
</template>
