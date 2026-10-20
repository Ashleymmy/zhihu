<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
const props = defineProps<{
  http: { getBlob(path: string): Promise<Blob> };
  query: Record<string, string>;
  kind?: "works" | "keywords";
}>();
const from = ref(""),
  to = ref(""),
  exporting = ref(false),
  error = ref("");
const keywords = computed(() => props.kind === "keywords");
const params = computed(() =>
  keywords.value
    ? {
        ...props.query,
        ...(from.value ? { from: from.value } : {}),
        ...(to.value ? { to: to.value } : {}),
      }
    : props.query,
);
let disposed = false;
watch(
  () => JSON.stringify(params.value),
  () => {
    error.value = "";
  },
);
watch(
  () => JSON.stringify([props.query.projectId, props.query.accountId]),
  () => {
    from.value = "";
    to.value = "";
  },
);
onBeforeUnmount(() => {
  disposed = true;
});
function period(kind: "day" | "week" | "month") {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  const start = new Date(today + "T00:00:00Z");
  if (kind === "week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (kind === "month") start.setUTCDate(1);
  from.value = start.toISOString().slice(0, 10);
  to.value = today;
}
async function download() {
  if (exporting.value) return;
  const query = { ...params.value },
    key = JSON.stringify(params.value);
  if (query.from && query.to && query.from > query.to) {
    error.value = "开始日期不能晚于结束日期";
    return;
  }
  exporting.value = true;
  error.value = "";
  try {
    const blob = await props.http.getBlob(
      (keywords.value ? "/keyword-bindings" : "/work-registrations") +
        "/export?" +
        new URLSearchParams(query),
    );
    if (disposed || key !== JSON.stringify(params.value)) return;
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `${keywords.value ? "关键词绑定" : "作品回传"}_${query.from || "全部"}_${query.to || "至今"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    if (!disposed && key === JSON.stringify(params.value))
      error.value = e instanceof Error ? e.message : "导出失败，请重试";
  } finally {
    exporting.value = false;
  }
}
</script>
<template>
  <section
    class="registration-report"
    :aria-label="keywords ? '关键词日期导出' : '作品回传导出'"
  >
    <form v-if="keywords" class="export-dates" @submit.prevent="download">
      <label>绑定开始日期<input v-model="from" type="date" /></label>
      <label>绑定结束日期<input v-model="to" type="date" /></label>
      <div class="export-actions">
        <button type="button" @click="period('day')">今天</button
        ><button type="button" @click="period('week')">本周至今</button
        ><button type="button" @click="period('month')">本月至今</button
        ><button
          type="button"
          @click="
            from = '';
            to = '';
          "
        >
          全部日期
        </button>
      </div>
    </form>
    <p v-if="keywords">
      按领取／分配日期导出，保留失败和已释放记录。未分配的失败关键词按创建日期收录并标明。
    </p>
    <p v-else>
      按上方填写的回传日期和筛选条件导出，包含完整链接、分类、原著、账号及团长信息。
    </p>
    <button type="button" :disabled="exporting" @click="download">
      {{
        exporting
          ? "正在导出…"
          : keywords
            ? "导出关键词 Excel"
            : "导出回传 Excel"
      }}
    </button>
    <p v-if="error" class="report-error" role="alert">
      {{ error }}
      <button type="button" :disabled="exporting" @click="download">
        重试导出
      </button>
    </p>
  </section>
</template>
<style scoped>
.registration-report {
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
  margin: 16px 0;
  padding: 16px;
}
.registration-report p {
  font-size: 13px;
  color: var(--ink-soft, #637078);
  margin: 8px 0 12px;
  line-height: 1.7;
}
.export-dates,
.export-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}
.export-dates label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.registration-report button {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.registration-report button:disabled { opacity: .6; cursor: wait; }
.registration-report button:hover:not(:disabled) { background: var(--surface, #f2f5f3); }
.export-dates input {
  max-width: 100%;
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 10px;
  font: inherit;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
  color: inherit;
  background: transparent;
}
.registration-report .report-error {
  color: #9c2626;
}
@media (max-width: 700px) {
  .registration-report {
    padding: 12px;
  }
  .export-dates > label {
    flex: 1 1 140px;
  }
  .registration-report > button {
    width: 100%;
    white-space: normal;
  }
}
</style>
