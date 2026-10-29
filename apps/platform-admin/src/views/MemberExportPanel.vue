<script setup lang="ts">
import { computed, ref } from "vue";
import { ActionDialog } from "@zhihu-koc/shared-components";
import { http, useAuthStore } from "../stores/auth";
const props = defineProps<{ memberIds: string[]; projectId?: string }>();
const auth = useAuthStore(),
  opened = ref(false),
  busy = ref(false),
  error = ref(""),
  includeEarnings = ref(false);
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());
const from = ref(today.slice(0, 8) + "01"),
  to = ref(today);
const canExport = computed(
  () =>
    ["developer", "admin"].includes(auth.user?.role || "") &&
    auth.user?.adminDuty !== "finance",
);
const canMoney = computed(
  () => canExport.value && (auth.user?.adminDuty || "all") === "all",
);
async function download() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const blob = await http.postBlob("/member-exports", {
      memberIds: props.memberIds,
      from: from.value,
      to: to.value,
      includeEarnings: canMoney.value && includeEarnings.value,
      ...(props.projectId ? { projectId: props.projectId } : {}),
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `成员归属_${from.value}_${to.value}.xlsx`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    opened.value = false;
  } catch (e: any) {
    error.value = e.message || "导出失败，请重试";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <button
    v-if="canExport"
    class="export-trigger"
    type="button"
    :disabled="!memberIds.length || memberIds.length > 30000"
    @click="
      opened = true;
      error = '';
    "
  >
    导出成员资料
  </button>
  <ActionDialog
    :open="opened"
    title="导出成员资料"
    @close="!busy && (opened = false)"
  >
    <form class="export-form" @submit.prevent="download">
      <p>
        导出当前筛选的
        {{ memberIds.length }}
        位成员，包含全部分页结果、联系方式、当前团队、邀请来源和归属历史。
      </p>
      <label v-if="canMoney" class="check"
        ><input
          v-model="includeEarnings"
          type="checkbox"
        />同时导出个人、团队及拉新／拉活分类收益</label
      >
      <div class="dates">
        <label
          >收益统计开始日期<input
            v-model="from"
            type="date"
            :max="to"
            required /></label
        ><label
          >收益统计结束日期<input v-model="to" type="date" :min="from" required
        /></label>
      </div>
      <p>成员范围使用当前名单筛选，日期用于收益统计。归属历史完整保留。</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <button class="primary" :disabled="busy || !memberIds.length">
        {{ busy ? "正在生成…" : "下载 Excel" }}
      </button>
    </form>
  </ActionDialog>
</template>
<style scoped>
.export-trigger {
  min-height: 40px;
  padding: 8px 12px;
  cursor: pointer;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: inherit;
}
.export-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.export-form {
  display: grid;
  gap: 16px;
}
.export-form p {
  line-height: 1.7;
  color: var(--ink-soft);
}
.dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.dates label {
  display: grid;
  gap: 8px;
}
.dates input {
  width: 100%;
  min-width: 0;
}
.export-form .check {
  display: flex !important;
  gap: 8px;
  align-items: flex-start;
}
.check input {
  width: 18px !important;
  min-height: 18px !important;
  height: 18px;
  flex: 0 0 18px;
  margin: 0;
}
@media (max-width: 600px) {
  .dates {
    grid-template-columns: 1fr;
  }
}
</style>
