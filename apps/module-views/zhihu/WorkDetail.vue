<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from "vue";
import { ActionDialog } from "@zhihu-koc/shared-components";
import type { HttpClient } from "@zhihu-koc/shared-services/core";
import { errorText, type Scope } from "./context";
import { upstreamReview, type WorkStatus } from "./work-status";
export interface WorkDetailRecord extends WorkStatus {
  id: string;
  keyword?: string;
  taskName?: string;
  description?: string;
  executorName?: string;
  workUrl?: string;
  mediaType?: string;
  mediaAccount?: string;
  compositionType?: number;
  compositionSubType?: number;
  createdAt?: string;
  releaseTime?: string;
  compositionId?: string | null;
}
const props = defineProps<{
  work: WorkDetailRecord | null;
  http?: HttpClient;
  scope?: Scope;
}>();
const emit = defineEmits<{ close: [] }>();
const item = ref<WorkDetailRecord | null>(null),
  busy = ref(false),
  error = ref(""),
  copied = ref(false);
let generation = 0;
watch(
  () => [props.work, props.scope],
  async () => {
    const n = ++generation;
    error.value = "";
    copied.value = false;
    item.value = null;
    busy.value = false;
    if (!props.work) return;
    if (!props.http || !props.scope?.accountId || !props.scope?.projectId) {
      item.value = props.work;
      return;
    }
    busy.value = true;
    try {
      const result = await props.http.get<WorkDetailRecord>(
        "/workbench/work-detail",
        {
          ...props.scope,
          id: props.work.compositionId
            ? "composition:" + props.work.compositionId
            : props.work.id,
        },
      );
      if (n === generation) item.value = result;
    } catch (e) {
      if (n === generation) error.value = errorText(e);
    } finally {
      if (n === generation) busy.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
const review = computed(() =>
  item.value?.compositionId
    ? upstreamReview(item.value)
    : { label: "尚未登记知乎推广作品", reason: "" },
);
const types = ["其他", "图文", "视频"],
  subs = [
    "",
    "实拍",
    "Live 图",
    "截屏",
    "漫画",
    "表情包解说",
    "真人演绎",
    "猫 meme",
    "漫剧",
    "解压",
    "滚屏",
    "其他",
  ];
const date = (v?: string) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "未填写";
const url = computed(() => {
  try {
    const u = new URL(item.value?.workUrl || "");
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
});
async function copy() {
  try {
    await navigator.clipboard.writeText(item.value?.workUrl || "");
    copied.value = true;
  } catch {
    error.value = "复制失败，请选中下面的完整链接手动复制";
  }
}
</script>
<template>
  <ActionDialog :open="!!work" title="作品详情" @close="emit('close')">
    <p v-if="busy" role="status">正在加载作品详情…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="item"
      ><h3>{{ item.keyword || "推广作品" }}</h3>
      <p>{{ item.taskName || "知乎业务" }}</p>
      <div class="work-result">
        <strong>{{ review.label }}</strong>
        <p v-if="review.reason">{{ review.reason }}</p>
      </div>
      <dl class="work-detail">
        <dt>登记人</dt>
        <dd>{{ item.executorName || "项目成员" }}</dd>
        <dt>标题 / 说明</dt>
        <dd>{{ item.description || "未填写" }}</dd>
        <dt>发布平台</dt>
        <dd>{{ item.mediaType || "未填写" }}</dd>
        <dt>平台账号</dt>
        <dd>{{ item.mediaAccount || "未填写" }}</dd>
        <dt>作品分类</dt>
        <dd>
          {{ types[item.compositionType ?? -1] || "未填写" }} /
          {{ subs[item.compositionSubType ?? -1] || "未填写" }}
        </dd>
        <dt>发布时间</dt>
        <dd>{{ date(item.releaseTime) }}</dd>
        <dt>登记时间</dt>
        <dd>{{ date(item.createdAt) }}</dd>
      </dl>
      <h4>作品原链接</h4>
      <p class="work-url">{{ item.workUrl }}</p>
      <div class="dialog-actions">
        <button @click="copy">{{ copied ? "已复制" : "复制链接" }}</button
        ><a v-if="url" :href="url" target="_blank" rel="noopener noreferrer"
          >打开原作品 ↗</a
        >
      </div>
    </template>
  </ActionDialog>
</template>
<style scoped>
h3 {
  font-size: 22px;
  margin: 0 0 8px;
}
.work-result {
  background: #eef4f1;
  padding: 16px;
  border-radius: 8px;
}
.work-result p {
  margin-bottom: 0;
}
.work-detail {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 0;
  margin: 20px 0;
}
.work-detail dt,
.work-detail dd {
  padding: 12px 0;
  margin: 0;
  border-bottom: 1px solid var(--line, #ddd);
  overflow-wrap: anywhere;
}
.work-detail dt {
  color: var(--ink-soft, #637078);
}
.work-url {
  overflow-wrap: anywhere;
  user-select: text;
  font-size: 14px;
}
.dialog-actions {
  align-items: center;
}
.dialog-actions a {
  padding: 10px;
  color: #195e62;
}
</style>
