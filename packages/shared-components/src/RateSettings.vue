<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import DetailDrawer from "./DetailDrawer.vue";
import type { CoreWorkspace, WorkspaceHttp } from "./core-workspace";
const props = defineProps<{
  open: boolean;
  projectId: string;
  moduleId: string;
  initialMetricType?: string;
  http?: WorkspaceHttp;
}>();
const emit = defineEmits<{
  close: [];
  published: [{ effectiveFrom: string; recalculated: number }];
}>();
const workspace = inject<CoreWorkspace | undefined>("opc", undefined);
interface Metric {
  code: string;
  label: string;
  unit: string;
  earliestFrom?: string;
  note?: string;
  rules: { code: string; label: string; editable: boolean }[];
}
interface Version {
  id: string;
  metricType: string;
  ruleCode: string;
  unitPrice: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
interface RateView {
  metrics: Metric[];
  versions: Version[];
  baseVersion: string;
  businessDate: string;
  earliestFrom: Record<string, string>;
}
const view = ref<RateView | null>(null),
  metricType = ref(""),
  effectiveFrom = ref(""),
  prices = ref<Record<string, string>>({});
const loading = ref(false),
  saving = ref(false),
  error = ref(""),
  notice = ref("");
const feedback = ref<HTMLElement>();
const metric = computed(() =>
  view.value?.metrics.find((m) => m.code === metricType.value),
);
const earliest = computed(() => metric.value?.earliestFrom ?? view.value?.earliestFrom[metricType.value] ?? "");
const history = computed(
  () =>
    view.value?.versions
      .filter((r) => r.metricType === metricType.value)
      .slice()
      .sort(
        (a, b) =>
          b.effectiveFrom.localeCompare(a.effectiveFrom) ||
          a.ruleCode.localeCompare(b.ruleCode),
      ) ?? [],
);
const priceText = (s: string) => s.replace(/(\.\d{2})0+$/, "$1");
const label = (code: string) =>
  metric.value?.rules.find((r) => r.code === code)?.label ?? "单价";
const status = (v: Version) =>
  v.effectiveFrom > (view.value?.businessDate ?? "")
    ? "待生效"
    : v.effectiveTo && v.effectiveTo <= (view.value?.businessDate ?? "")
      ? "已结束"
      : "当前生效";
function latest(code: string) {
  return history.value.find((r) => r.ruleCode === code);
}
function resetForm() {
  prices.value = Object.fromEntries(
    metric.value?.rules
      .filter((r) => r.editable)
      .map((r) => [r.code, latest(r.code)?.unitPrice ?? ""]) ?? [],
  );
  effectiveFrom.value = earliest.value;
}
let generation = 0;
async function load(preserveNotice = false) {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  if (!preserveNotice) notice.value = "";
  try {
    const http = props.http ?? workspace?.http;
    if (!http) throw Error("单价设置暂时无法打开，请关闭后重试");
    const data = await http.get<RateView>("/rates", {
      projectId: props.projectId,
      moduleId: props.moduleId,
    });
    if (current !== generation) return;
    view.value = data;
    if (!preserveNotice && data.metrics.some((m) => m.code === props.initialMetricType))
      metricType.value = props.initialMetricType!;
    if (!data.metrics.some((m) => m.code === metricType.value))
      metricType.value = data.metrics[0]?.code ?? "";
    resetForm();
  } catch (e) {
    if (current === generation) {
      view.value = null;
      error.value = e instanceof Error ? e.message : "加载失败，请重试";
    }
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function publish() {
  if (saving.value || !view.value || !metric.value) return;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const http = props.http ?? workspace?.http;
    if (!http) throw Error("单价设置暂时不可用，请关闭后重试");
    const result = await http.post<{
      effectiveFrom: string;
      recalculated: number;
    }>("/rates", {
      projectId: props.projectId,
      moduleId: props.moduleId,
      metricType: metricType.value,
      effectiveFrom: effectiveFrom.value,
      prices: { ...prices.value },
      baseVersion: view.value.baseVersion,
    });
    notice.value = `已发布，${result.effectiveFrom} 起使用新单价。`;
    emit("published", result);
    await load(true);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "发布失败，请重试";
  } finally {
    saving.value = false;
    await nextTick();
    feedback.value?.closest("dialog")?.scrollTo({ top: 0, behavior: "auto" });
    feedback.value?.focus({ preventScroll: true });
  }
}
watch(metricType, resetForm);
watch(
  () => [props.open, props.projectId, props.moduleId, props.initialMetricType],
  () => {
    if (props.open) void load();
    else {
      generation++;
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>
<template>
  <DetailDrawer :open="open" title="单价设置" @close="emit('close')">
    <div class="rate-settings" :aria-busy="loading || saving">
      <p v-if="loading" role="status">正在加载单价…</p>
      <div v-if="notice || error" ref="feedback" tabindex="-1">
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <div v-if="error" class="problem" role="alert">
          <p>{{ error }}</p>
          <button type="button" :disabled="loading || saving" @click="load()">
            刷新单价
          </button>
        </div>
      </div>
      <template v-if="view && metric">
        <label
          >业绩类型<select v-model="metricType" :disabled="saving">
            <option
              v-for="item in view.metrics"
              :key="item.code"
              :value="item.code"
            >
              {{ item.label }}
            </option>
          </select></label
        >
        <section class="rate-overview" aria-label="已发布单价">
          <h3>已发布单价</h3>
          <div v-for="rule in metric.rules" :key="rule.code" class="rate-row">
            <span>{{ rule.label }}</span>
            <div v-if="latest(rule.code)">
              <strong
                >¥{{ priceText(latest(rule.code)!.unitPrice)
                }}<small> / {{ metric.unit }}</small></strong
              ><span class="period"
                >{{ latest(rule.code)!.effectiveFrom }} 起 ·
                {{ status(latest(rule.code)!) }}</span
              >
            </div>
            <span v-else>尚未设置</span>
          </div>
        </section>
        <form @submit.prevent="publish">
          <h3>新增未来单价</h3>
          <p class="note">{{ metric.note }}</p>
          <label
            >生效日期<input
              v-model="effectiveFrom"
              type="date"
              :min="earliest"
              required
              :disabled="saving"
          /></label>
          <div class="price-inputs">
            <label
              v-for="rule in metric.rules.filter((r) => r.editable)"
              :key="rule.code"
              >{{ rule.label }}（元 / {{ metric.unit }}）<input
                v-model="prices[rule.code]"
                inputmode="decimal"
                pattern="[0-9]{1,14}(\.[0-9]{1,4})?"
                required
                :disabled="saving"
            /></label>
          </div>
          <p class="note">历史单价和已确认账目保留原值。</p>
          <button class="publish" type="submit" :disabled="saving || loading">
            {{ saving ? "正在发布…" : "发布新单价" }}
          </button>
        </form>
        <details class="history">
          <summary>查看全部价格记录（{{ history.length }}）</summary>
          <ul>
            <li v-for="record in history" :key="record.id">
              <div>
                <strong>{{ label(record.ruleCode) }}</strong
                ><span
                  >¥{{ priceText(record.unitPrice) }} / {{ metric.unit }}</span
                >
              </div>
              <p>
                {{ record.effectiveFrom }} 起<span v-if="record.effectiveTo"
                  >，{{ record.effectiveTo }} 起结束</span
                >
                · {{ status(record) }}
              </p>
            </li>
          </ul>
        </details>
      </template>
      <p v-else-if="view && !loading">此项目暂时没有可设置的单价。</p>
    </div>
  </DetailDrawer>
</template>
<style scoped>
.rate-settings {
  display: grid;
  gap: 24px;
  min-width: 0;
  font-size: 14px;
}
h3,
p {
  margin: 0;
}
h3 {
  font-size: 16px;
  margin-bottom: 10px;
}
label {
  display: grid;
  gap: 6px;
  min-width: 0;
  font-weight: 500;
}
input,
select,
button {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  min-height: 44px;
  font: inherit;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
  padding: 10px 12px;
  color: inherit;
  background: var(--paper, #fff);
}
input,
select {
  width: 100%;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
input:focus-visible,
select:focus-visible,
button:focus-visible,
summary:focus-visible {
  outline: 3px solid #195e62;
  outline-offset: 2px;
}
.rate-overview {
  padding: 16px;
  background: var(--surface-soft, #f3f6f5);
  border-radius: 12px;
}
.rate-row {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: baseline;
  padding: 12px 0;
  border-bottom: 1px solid var(--line, #dce3e5);
}
.rate-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.rate-row > div {
  text-align: right;
}
.rate-row strong {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
small {
  font-weight: 400;
  font-size: 12px;
}
.period,
.note {
  display: block;
  color: #59676a;
  font-weight: 400;
  font-size: 13px;
}
form {
  display: grid;
  gap: 16px;
}
form h3 {
  margin: 0;
}
.price-inputs {
  display: grid;
  gap: 14px;
}
.publish {
  background: #195e62;
  color: white;
  border-color: #195e62;
  width: 100%;
  font-weight: 600;
}
.notice {
  background: #e9f3ef;
  color: #205545;
  padding: 14px;
  border-radius: 8px;
}
.problem {
  background: #fff1ed;
  color: #8e3c25;
  padding: 14px;
  border-radius: 8px;
  display: grid;
  gap: 10px;
}
.problem button {
  justify-self: start;
}
summary {
  cursor: pointer;
  padding: 10px 0;
  min-height: 24px;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  padding: 12px 0;
  border-top: 1px solid var(--line, #dce3e5);
}
li > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
li p {
  color: #59676a;
  font-size: 12px;
}
@media (max-width: 600px) {
  .rate-row {
    gap: 8px;
  }
  .rate-row > span {
    max-width: 45%;
  }
  .rate-overview {
    padding: 12px;
  }
}
</style>
