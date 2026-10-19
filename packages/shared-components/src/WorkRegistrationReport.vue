<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
interface Http {
  get<T>(path: string, params?: object): Promise<T>;
  getBlob(path: string): Promise<Blob>;
}
const props = defineProps<{
  http: Http;
  query: Record<string, string>;
  revision?: number;
}>();
const emit = defineEmits<{ day: [date: string] }>();
const daily = ref<{ date: string; count: number }[]>([]),
  total = ref(0),
  busy = ref(false),
  exporting = ref(false),
  error = ref("");
let generation = 0, disposed = false;
const message = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String(e.message)
    : "读取失败，请重试";
async function load() {
  const n = ++generation;
  busy.value = true;
  error.value = "";
  daily.value = [];
  try {
    const report = await props.http.get<{
      total: number;
      daily: { date: string; count: number }[];
    }>("/work-registrations", props.query);
    if (n === generation) {
      daily.value = report.daily;
      total.value = report.total;
    }
  } catch (e) {
    if (n === generation) error.value = message(e);
  } finally {
    if (n === generation) busy.value = false;
  }
}
watch(() => JSON.stringify([props.query, props.revision]), load, {
  immediate: true,
});
onBeforeUnmount(() => { generation++; disposed = true; });
async function download() {
  if (exporting.value || busy.value) return;
  const key = JSON.stringify(props.query);
  exporting.value = true;
  error.value = "";
  try {
    const blob = await props.http.getBlob(
      "/work-registrations/export?" + new URLSearchParams(props.query),
    );
    if (disposed || key !== JSON.stringify(props.query)) return;
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `作品登记_${props.query.from || "全部"}_${props.query.to || "至今"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    if (key === JSON.stringify(props.query)) error.value = message(e);
  } finally {
    exporting.value = false;
  }
}
</script>
<template>
  <section class="registration-report" aria-label="每日作品登记统计">
    <div class="report-heading">
      <span>{{
        busy
          ? "正在统计…"
          : `所选范围共 ${total} 条${query.successfulOnly === "1" ? "成功登记的作品" : "作品记录"}`
      }}</span
      ><button
        type="button"
        :disabled="busy || exporting || !!error"
        @click="download"
      >
        {{ exporting ? "正在导出…" : "导出 Excel（含回传链接）" }}
      </button>
    </div>
    <p v-if="error" class="report-error" role="alert">
      {{ error }} <button type="button" @click="load">重试</button>
    </p>
    <details v-if="!busy && !error" open>
      <summary>每日数量 · 点击日期查看作品（未列日期为 0 条）</summary>
      <div class="daily-list">
        <button
          v-for="day in daily"
          :key="day.date"
          type="button"
          :aria-label="`${day.date}，${day.count} 条作品，查看明细`"
          @click="emit('day', day.date)"
        >
          <span>{{ day.date }}</span
          ><strong>{{ day.count }} 条</strong>
        </button>
        <p v-if="!daily.length">所选范围没有作品，请调整登记日期或筛选条件。</p>
      </div>
    </details>
  </section>
</template>
<style scoped>
.registration-report {
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
  margin: 16px 0;
  padding: 16px;
}
.report-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.registration-report summary {
  cursor: pointer;
  margin-top: 12px;
  font-size: 13px;
  color: var(--ink-soft, #637078);
}
.daily-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
  margin-top: 12px;
  max-height: 240px;
  overflow: auto;
}
.daily-list button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px;
}
.daily-list p {
  grid-column: 1/-1;
}
.report-error {
  color: #9c2626;
}
@media (max-width: 700px) {
  .report-heading {
    align-items: stretch;
  }
  .report-heading > button {
    width: 100%;
    white-space: normal;
  }
  .daily-list {
    grid-template-columns: 1fr;
  }
  .registration-report {
    padding: 12px;
  }
}
</style>
