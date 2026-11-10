<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  DetailDrawer,
  HistoryEvidenceForm,
  RecordComments,
  RateSettings,
  evidenceHistoryTarget,
} from "@zhihu-koc/shared-components";
import type {
  EvidenceAction,
  EvidenceRow,
  HistoryTarget,
} from "@zhihu-koc/shared-contracts/core";
import { workspace } from "../stores/platform";
import { useAuthStore } from "../stores/auth";
import { evidenceReminderContext } from "../reminder-context";
const emit = defineEmits<{ updated: [] }>(),
  route = useRoute(),
  router = useRouter(),
  auth = useAuthStore();
const context = computed(() => evidenceReminderContext(route.query)),
  open = computed(() => route.query.reminderContext === "evidence");
const row = ref<EvidenceRow | null>(null),
  history = ref<HistoryTarget | null>(null),
  loading = ref(false),
  error = ref(""),
  rates = ref(false);
const labels = {
  work: "作品登记",
  historicalOwnership: "历史归属",
  projectParticipation: "项目参与",
  pricing: "计费资料",
  existingCalculation: "已有计算",
};
let generation = 0;
const canOperate = computed(
  () =>
    !!auth.user &&
    ["admin", "developer", "operator"].includes(auth.user.role) &&
    auth.user.adminDuty !== "finance",
);
const canFinance = computed(
  () =>
    !!auth.user &&
    ["admin", "developer"].includes(auth.user.role) &&
    auth.user.adminDuty !== "operations",
);
const comments = computed(
  () =>
    row.value &&
    context.value &&
    workspace.evidenceComments?.({
      ...row.value.key,
      moduleId: context.value.moduleId,
    }),
);
const canAction = (a: EvidenceAction) =>
  a.requiredDuty === "finance" ? canFinance.value : canOperate.value;
async function load() {
  const version = ++generation;
  row.value = null;
  history.value = null;
  error.value = "";
  loading.value = true;
  try {
    const value = context.value;
    if (!value) throw new Error("提醒中的资料范围不完整，请重新打开提醒。");
    if (!canOperate.value && !canFinance.value)
      throw new Error("当前账号没有资料核验权限，请返回提醒列表。");
    if (!workspace.evidenceApi)
      throw new Error("资料服务暂未接通，请重新读取。");
    const { businessDate, ...scope } = value;
    const result = await workspace.evidenceApi.query({
      ...scope,
      from: businessDate,
      to: businessDate,
      page: 1,
      pageSize: 1,
    });
    const found = result.list[0];
    if (
      !found ||
      result.total !== 1 ||
      found.key.projectId !== value.projectId ||
      found.key.accountId !== value.accountId ||
      found.key.channelRef !== value.channelRef ||
      found.key.taskRef !== value.taskRef ||
      found.key.businessDate !== businessDate ||
      found.key.metricType !== value.metricType
    )
      throw new Error("这条资料已更新或不可查看，请重新读取提醒。");
    if (version === generation) row.value = found;
  } catch (e) {
    if (version === generation)
      error.value =
        e && typeof e === "object" && "message" in e
          ? String(e.message)
          : "资料暂时没加载出来，请重新读取。";
  } finally {
    if (version === generation) loading.value = false;
  }
}
watch(
  () => [
    route.query.reminderContext,
    JSON.stringify(context.value),
    auth.user?.id,
    auth.user?.role,
    auth.user?.adminDuty,
  ],
  () => {
    rates.value = false;
    if (open.value) void load();
    else {
      generation++;
      row.value = null;
      history.value = null;
    }
  },
  { immediate: true },
);
async function close() {
  generation++;
  const query = { ...route.query };
  for (const k of [
    "reminderContext",
    "channelRef",
    "taskRef",
    "businessDate",
    "metricType",
  ])
    delete query[k];
  await router.replace({ query });
}
async function repaired() {
  await load();
  emit("updated");
}
async function perform(action: EvidenceAction) {
  if (!canAction(action) || !context.value) return;
  const target = evidenceHistoryTarget(action);
  if (target) {
    history.value = target;
    return;
  }
  if (action.key === "set_pricing") {
    rates.value = true;
    return;
  }
  const task = /^\/api\/v1\/core\/tasks\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
    action.path,
  );
  const query = {
    projectId: context.value.projectId,
    accountId: context.value.accountId,
    moduleId: context.value.moduleId,
  };
  if (task) {
    await router.push({ path: "/tasks", query: { ...query, taskId: task[3] } });
    return;
  }
  const report = /^\/api\/v1\/modules\/[^/]+\/imports\/([^/]+)\/analysis$/.exec(
    action.path,
  );
  if (report || action.key === "upload_official_report") {
    await router.push({
      path: "/finance",
      query: { ...query, ...(report ? { importId: report[1] } : {}) },
    });
    return;
  }
  await nextTick();
  document
    .getElementById("reminder-record-comments")
    ?.scrollIntoView({ block: "start" });
}
</script>
<template>
  <DetailDrawer
    :open="open && !rates"
    :title="row?.title || '资料核对留言'"
    @close="close"
  >
    <p v-if="loading" role="status">正在读取对应资料…</p>
    <div v-if="error" role="alert">
      <p>{{ error }}</p>
      <button class="btn" @click="load">重新读取资料</button
      ><button class="btn" @click="close">返回提醒列表</button>
    </div>
    <HistoryEvidenceForm
      v-if="history"
      :target="history"
      @updated="emit('updated')"
      @completed="repaired"
      @stale="repaired"
      @cancel="history = null"
    />
    <div v-else-if="row" class="reminder-evidence">
      <p>
        {{ row.key.businessDate }} ·
        {{ row.key.metricType === "activation" ? "拉活" : "拉新" }}
      </p>
      <p>{{ row.result.reason }}</p>
      <article v-for="(check, key) in row.checks" :key="key">
        <h3>{{ labels[key] }}</h3>
        <p>{{ check.reason }}</p>
        <template v-if="check.nextAction"
          ><p>
            下一步：{{
              check.nextAction.requiredDuty === "finance" ? "财务" : "运营"
            }}：{{ check.nextAction.label }}
          </p>
          <button
            v-if="canAction(check.nextAction)"
            class="btn"
            @click="perform(check.nextAction)"
          >
            {{ check.nextAction.label }}
          </button></template
        >
      </article>
      <div id="reminder-record-comments">
        <RecordComments v-if="comments" :api="comments" title="资料核对沟通" />
      </div>
    </div>
  </DetailDrawer>
  <RateSettings
    v-if="rates && context && canFinance"
    :open="true"
    :project-id="context.projectId"
    :module-id="context.moduleId"
    :initial-metric-type="context.metricType"
    :http="workspace.http"
    @close="
      rates = false;
      repaired();
    "
  />
</template>
<style scoped>
.reminder-evidence {
  display: grid;
  gap: 16px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.reminder-evidence h3 {
  font-size: 15px;
  margin: 0 0 8px;
}
.reminder-evidence article {
  border-top: 1px solid var(--line, #ddd);
  padding-top: 16px;
}
.reminder-evidence p {
  margin: 0 0 8px;
}
</style>
