<template>
  <div class="z-page">
    <div class="pg-header">
      <div>
        <h1 class="pg-title">推广作品</h1>
        <p class="pg-sub">管理知乎联盟推广作品，支持单个与批量创建</p>
      </div>
    </div>
    <a-tabs v-model:activeKey="tab" class="z-tabs">
      <!-- ── 作品列表 ── -->
      <a-tab-pane key="list" tab="作品列表">
        <div class="alert-info">
          本页须使用渠道 ID +
          单个计划关键词从知乎上游实时查询；“本地工作台”使用本地回传记录，两者不是同一数据源。
        </div>
        <div class="filter-row">
          <a-select
            v-model:value="lq.channelId"
            placeholder="选择渠道（必填）"
            style="width: 200px"
            @change="
              (val: unknown) =>
                onChannelChange(typeof val === 'string' ? val : '')
            "
          >
            <a-select-option
              v-for="o in ch.channelOptions"
              :key="o.value"
              :value="o.value"
              >{{ o.label }}</a-select-option
            >
          </a-select>
          <a-input
            v-model:value="lq.keyword"
            placeholder="单个计划关键词（必填）"
            style="width: 220px"
            allow-clear
          />
          <a-button
            type="primary"
            :disabled="!lq.channelId || !lq.keyword"
            @click="fetchList"
            >查询</a-button
          >
        </div>
        <div class="table-card">
          <a-table
            :data-source="co.items"
            :loading="co.loading"
            row-key="compositionId"
            size="middle"
            :pagination="{
              total: co.total,
              pageSize: co.pageSize,
              current: co.current,
              onChange: co.fetchPage,
            }"
            :locale="{ emptyText: listEmptyText }"
          >
            <a-table-column title="关键词" data-index="keyword" :width="140" />
            <a-table-column title="作品 ID" :width="200">
              <template #default="{ record }">
                <span class="mono-sm">{{ record.compositionId }}</span>
                <button class="copy-btn" @click="copyId(record.compositionId)">
                  复制
                </button>
              </template>
            </a-table-column>
            <a-table-column title="作品链接" :width="100">
              <template #default="{ record }">
                <a
                  v-if="record.compositionUrl"
                  :href="record.compositionUrl"
                  target="_blank"
                  class="link-btn"
                  >查看</a
                >
                <span v-else>—</span>
              </template>
            </a-table-column>
            <a-table-column title="分类" :width="150">
              <template #default="{ record }">{{
                formatCompositionCategory(record)
              }}</template>
            </a-table-column>
            <a-table-column
              title="提交时间"
              data-index="submitTime"
              :width="160"
            />
            <a-table-column title="更新" :width="120">
              <template #default="{ record }">
                <span
                  v-if="!canUpdateCompositionFromList(record)"
                  class="text-disabled"
                  :aria-label="`作品 ${record.compositionId} 更新不可用`"
                  >不可用</span
                >
              </template>
            </a-table-column>
          </a-table>
        </div>
      </a-tab-pane>

      <!-- ── 创建作品 ── -->
      <a-tab-pane key="create" tab="创建作品">
        <a-form
          :model="cf"
          layout="vertical"
          style="max-width: 560px; margin-top: 8px"
          @finish="handleCreate"
        >
          <a-form-item
            label="推广计划 ID"
            name="planId"
            :rules="[{ required: true, message: '请输入 planId' }]"
          >
            <a-input
              v-model:value="cf.planId"
              placeholder="来自「创建计划」页面的 Plan ID"
            />
          </a-form-item>
          <a-form-item
            label="计划关键词（用于创建后查询）"
            name="keyword"
            :rules="[
              { required: true, message: '请输入计划关键词' },
              {
                pattern: /^[^,\s，]+$/,
                message: '仅支持单个关键词，不能含逗号或空格',
              },
            ]"
          >
            <a-input
              v-model:value="cf.keyword"
              placeholder="必须与创建计划时的关键词一致"
            />
            <div class="optional-tip">
              该字段只用于创建成功后实时回查，不会加入创建作品的上游请求。
            </div>
          </a-form-item>
          <a-form-item
            label="渠道"
            name="channelId"
            :rules="[{ required: true, message: '请选择渠道' }]"
          >
            <a-select
              v-model:value="cf.channelId"
              placeholder="选择渠道"
              style="width: 100%"
            >
              <a-select-option
                v-for="o in ch.channelOptions"
                :key="o.value"
                :value="o.value"
                >{{ o.label }}</a-select-option
              >
            </a-select>
          </a-form-item>
          <a-form-item
            label="媒体类型"
            name="mediaType"
            :rules="[{ required: true }]"
          >
            <a-select
              v-model:value="cf.mediaType"
              style="width: 100%"
              placeholder="选择作品发布平台"
            >
              <a-select-option
                v-for="mediaType in MEDIA_TYPES"
                :key="mediaType"
                :value="mediaType"
                >{{ mediaType }}</a-select-option
              >
            </a-select>
          </a-form-item>
          <a-form-item
            label="媒体账号"
            name="mediaAccount"
            :rules="[{ required: true, message: '请输入媒体账号' }]"
          >
            <a-input
              v-model:value="cf.mediaAccount"
              placeholder="知乎账号 ID 或用户名"
            />
          </a-form-item>
          <a-form-item
            label="作品类型"
            name="compositionType"
            :rules="[{ required: true }]"
          >
            <a-select
              v-model:value="cf.compositionType"
              style="width: 100%"
              @change="onCompositionTypeChange"
            >
              <a-select-option :value="0">其他</a-select-option>
              <a-select-option :value="1">图文</a-select-option>
              <a-select-option :value="2">视频</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item
            label="子类型"
            name="compositionSubType"
            :rules="[{ required: true }]"
          >
            <a-select v-model:value="cf.compositionSubType" style="width: 100%">
              <a-select-option
                v-for="item in compositionSubTypeOptions"
                :key="item.value"
                :value="item.value"
                >{{ item.label }}</a-select-option
              >
            </a-select>
          </a-form-item>
          <a-form-item
            label="作品 URL"
            name="compositionUrl"
            :rules="[
              { required: true, message: '请输入作品 URL' },
              { type: 'url', message: '请输入合法 URL' },
            ]"
          >
            <a-input
              v-model:value="cf.compositionUrl"
              placeholder="知乎内容链接"
            />
          </a-form-item>
          <a-form-item
            label="发布时间"
            name="releaseTime"
            :rules="[{ required: true, message: '请输入发布时间' }]"
          >
            <a-date-picker
              v-model:value="cf.releaseTime"
              value-format="YYYY-MM-DD HH:mm:ss"
              show-time
              style="width: 100%"
            />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" html-type="submit" :loading="co.creating"
              >创建作品</a-button
            >
          </a-form-item>
        </a-form>
      </a-tab-pane>

      <!-- ── 批量创建 ── -->
      <a-tab-pane key="batch" tab="批量创建">
        <div style="max-width: 560px; margin-top: 8px">
          <div class="batch-tip">
            仅提交受限安全 XLSX；提交成功不代表完成，结果下载尚未开放。
          </div>
          <a-form layout="vertical">
            <a-form-item label="渠道">
              <a-select
                v-model:value="bf.channelId"
                placeholder="选择渠道"
                style="width: 100%"
              >
                <a-select-option
                  v-for="o in ch.channelOptions"
                  :key="o.value"
                  :value="o.value"
                  >{{ o.label }}</a-select-option
                >
              </a-select>
            </a-form-item>
            <a-form-item label="绑定类型">
              <a-radio-group v-model:value="bf.bindType">
                <a-radio :value="1">按计划 ID（planId）</a-radio>
                <a-radio :value="2">按关键词</a-radio>
              </a-radio-group>
            </a-form-item>
            <a-form-item label="XLSX 文件">
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                class="file-input"
                @change="onBatchFile"
              />
            </a-form-item>
            <a-form-item>
              <a-button
                type="primary"
                :disabled="co.batchUploading || !batchFile || !bf.channelId"
                :loading="co.batchUploading"
                @click="submitBatch"
              >
                提交批量作品
              </a-button>
            </a-form-item>
          </a-form>
          <div v-if="co.lastBatchTaskId" class="batch-result">
            <span
              >任务 ID：<code class="mono-sm">{{
                co.lastBatchTaskId
              }}</code></span
            >
            <button class="copy-btn" @click="copyId(co.lastBatchTaskId)">
              复制 ID
            </button>
            <div>提交成功不代表完成，结果下载尚未开放</div>
          </div>
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { message } from "ant-design-vue";
import dayjs from "dayjs";
import { MEDIA_TYPES } from "@/api/alliance";
import type { CompositionListItem, CreateCompositionReq } from "@/api/alliance";
import { useZChannelStore } from "@/stores/zChannel.store";
import {
  canUpdateCompositionFromList,
  useZCompositionStore,
} from "@/stores/zComposition.store";

const ch = useZChannelStore();
const co = useZCompositionStore();
const route = useRoute();
const tab = ref("list");
const lq = reactive({ channelId: "", keyword: "" });
const cf = reactive({
  planId: "",
  keyword: "",
  channelId: "",
  mediaType: MEDIA_TYPES[0],
  mediaAccount: "",
  compositionType: 1,
  compositionSubType: 1,
  compositionUrl: "",
  releaseTime: "",
});
const bf = reactive({ channelId: "", bindType: 1 as 1 | 2 });
const batchFile = ref<File | null>(null);

const compositionSubTypes = {
  0: [{ value: 11, label: "其他" }],
  1: [
    { value: 1, label: "实拍" },
    { value: 2, label: "Live 图" },
    { value: 3, label: "截屏" },
    { value: 4, label: "漫画" },
  ],
  2: [
    { value: 5, label: "表情包解说" },
    { value: 6, label: "真人演绎" },
    { value: 7, label: "猫 meme" },
    { value: 8, label: "漫剧" },
    { value: 9, label: "解压" },
    { value: 10, label: "滚屏" },
  ],
} as const;
const compositionSubTypeOptions = computed(
  () =>
    compositionSubTypes[cf.compositionType as keyof typeof compositionSubTypes],
);
const compositionTypeLabels = { 0: "其他", 1: "图文", 2: "视频" } as const;
const listEmptyText = computed(() => {
  const keyword = lq.keyword.trim();
  if (!lq.channelId || !keyword) return "请选择渠道并输入单个计划关键词后查询";
  if (
    co.lastQuery?.channelId !== lq.channelId ||
    co.lastQuery?.keyword !== keyword
  ) {
    return "条件已填写，请点击“查询”从知乎上游实时加载";
  }
  return "知乎上游未返回匹配作品，请确认渠道和计划关键词，或稍后重新查询";
});

function formatCompositionCategory(record: CompositionListItem) {
  const type =
    compositionTypeLabels[
      record.compositionType as keyof typeof compositionTypeLabels
    ];
  const subType = compositionSubTypes[
    record.compositionType as keyof typeof compositionSubTypes
  ]?.find((item) => item.value === record.compositionSubType)?.label;
  if (type) return subType ? `${type} / ${subType}` : type;
  return "—";
}

function onChannelChange(id: string) {
  lq.channelId = id;
}
async function fetchList() {
  lq.keyword = lq.keyword.trim();
  if (!lq.channelId || !lq.keyword) return;
  await co.fetchList(lq);
}
async function handleCreate() {
  const req: CreateCompositionReq = {
    planId: cf.planId,
    channelId: cf.channelId,
    mediaType: cf.mediaType,
    mediaAccount: cf.mediaAccount,
    compositionType: cf.compositionType,
    compositionSubType: cf.compositionSubType,
    compositionUrl: cf.compositionUrl,
    releaseTime: dayjs(cf.releaseTime).toISOString(),
  };
  const createdId = await co.submitCreate(req);
  lq.channelId = cf.channelId;
  lq.keyword = cf.keyword.trim();
  tab.value = "list";
  try {
    const items = await co.fetchList(lq);
    if (!items.some((item) => item.compositionId === createdId)) {
      message.warning(
        "作品已创建，但知乎实时列表暂未返回该作品，请稍后重新查询",
      );
    }
  } catch {
    message.warning("作品已创建，但实时列表查询失败，请稍后重新查询");
  }
}
function onCompositionTypeChange(value: unknown) {
  if (typeof value !== "number") return;
  const type = value as keyof typeof compositionSubTypes;
  const options = compositionSubTypes[type];
  if (options) cf.compositionSubType = options[0].value;
}
function onBatchFile(e: Event) {
  batchFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}
async function submitBatch() {
  if (co.batchUploading || !batchFile.value || !bf.channelId) return;
  await co.submitBatch(batchFile.value, bf);
}
async function copyId(id: string) {
  await navigator.clipboard.writeText(id);
  message.success("已复制");
}

function routeText(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

onMounted(async () => {
  await ch.fetchChannels();
  const routeTab = routeText(route.query.tab);
  const routeChannelId = routeText(route.query.channelId);
  const routeKeyword = routeText(route.query.keyword).trim();
  const initialChannelId = routeChannelId || ch.channelOptions[0]?.value || "";

  if (["list", "create", "batch"].includes(routeTab)) tab.value = routeTab;
  cf.planId = routeText(route.query.planId);
  cf.keyword = routeKeyword;
  cf.channelId = initialChannelId;
  lq.channelId = initialChannelId;
  lq.keyword = routeKeyword;
  bf.channelId = initialChannelId;
});
</script>

<style scoped>
.z-page {
  padding-bottom: 16px;
}
.pg-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.pg-title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}
.pg-sub {
  font-size: 12.5px;
  color: var(--color-text-disabled);
}
.z-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}
.alert-info {
  padding: 10px 14px;
  background: var(--color-info-bg);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--color-info);
  margin-bottom: 14px;
}
.filter-row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 14px;
}
.table-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.mono-sm {
  font-size: 11.5px;
  font-family: var(--font-mono);
  color: var(--color-text-tertiary);
}
.copy-btn {
  margin-left: 6px;
  padding: 2px 8px;
  background: var(--color-bg-active);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.copy-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.link-btn {
  font-size: 12px;
  color: var(--color-accent);
  text-decoration: none;
}
.link-btn:hover {
  text-decoration: underline;
}
.batch-tip {
  padding: 10px 14px;
  background: var(--color-info-bg);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--color-info);
  margin-bottom: 16px;
}
.optional-tip {
  margin-top: 6px;
  color: var(--color-text-tertiary);
  font-size: 12px;
}
.file-input {
  color: var(--color-text-secondary);
  font-size: 13px;
}
.batch-result {
  padding: 12px 16px;
  background: var(--color-success-bg);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 13px;
}
</style>
