<template>
  <div class="z-page">
    <div class="pg-header">
      <div>
        <h1 class="pg-title">创建推广计划</h1>
        <p class="pg-sub">向知乎联盟提交推广计划，支持单个与批量创建</p>
      </div>
    </div>

    <a-tabs v-model:activeKey="activeTab" class="z-tabs">
      <!-- ── 单个创建 ── -->
      <a-tab-pane key="single" tab="单个创建">
        <a-form
          ref="formRef"
          :model="form"
          layout="vertical"
          style="max-width: 560px; margin-top: 8px"
          @finish="submitForm"
        >
          <a-form-item
            label="一代渠道"
            name="channelId"
            :rules="[{ required: true, message: '请选择渠道' }]"
          >
            <a-select
              v-model:value="form.channelId"
              placeholder="选择渠道"
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
          </a-form-item>
          <a-form-item label="二代渠道（可选）">
            <a-select
              v-model:value="form.secondChannelId"
              :placeholder="
                secondChannelUnavailable ? '未开通/不可用' : '不指定（可选）'
              "
              allow-clear
              :disabled="!form.channelId || secondChannelUnavailable"
              :loading="Boolean(ch.secondLoading[form.channelId])"
            >
              <a-select-option
                v-for="o in ch.getSecondOptions(form.channelId)"
                :key="o.value"
                :value="o.value"
                >{{ o.label }}</a-select-option
              >
            </a-select>
            <div v-if="secondChannelUnavailable" class="optional-tip">
              当前账号未开通二代渠道权限，不影响推广任务选择。
            </div>
          </a-form-item>
          <a-form-item
            label="推广任务"
            name="taskId"
            :rules="[{ required: true, message: '请选择推广任务' }]"
          >
            <a-select
              v-model:value="form.taskId"
              placeholder="选择推广任务"
              :disabled="!form.channelId"
              :loading="tk.loading"
            >
              <a-select-option
                v-for="o in tk.taskOptions"
                :key="o.value"
                :value="o.value"
                >{{ o.label }}</a-select-option
              >
            </a-select>
          </a-form-item>
          <a-form-item
            label="关键词"
            name="keyword"
            :rules="[
              { required: true, message: '请输入关键词' },
              { pattern: /^[^,\s，]+$/, message: '不能含逗号或空格' },
            ]"
          >
            <a-input
              v-model:value="form.keyword"
              placeholder="仅支持单个关键词，不含逗号或空格"
            />
          </a-form-item>
          <a-form-item
            label="推广内容地址"
            name="contentUrl"
            :rules="[
              { required: true, message: '请输入推广地址' },
              { type: 'url', message: '请输入合法的 URL' },
            ]"
          >
            <a-input
              v-model:value="form.contentUrl"
              placeholder="https://..."
            />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" html-type="submit" :loading="pl.creating"
              >创建计划</a-button
            >
            <a-button style="margin-left: 8px" @click="formRef?.resetFields()"
              >重置</a-button
            >
          </a-form-item>
        </a-form>

        <div v-if="pl.lastPlanId" class="success-card animate-card">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-success)"
            stroke-width="2"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span
            >创建成功 — Plan ID：<code class="plan-id">{{
              pl.lastPlanId
            }}</code></span
          >
          <button class="act-btn" @click="copyPlanId">复制 ID</button>
          <button class="act-btn accent" @click="goCreateComp">
            → 立即创建作品
          </button>
        </div>
      </a-tab-pane>

      <!-- ── 批量创建 ── -->
      <a-tab-pane key="batch" tab="批量创建">
        <div style="max-width: 560px; margin-top: 8px">
          <div class="batch-tip">
            仅提交受限安全 XLSX；提交成功不代表完成，结果下载尚未开放。
          </div>
          <a-form layout="vertical">
            <a-form-item label="一代渠道">
              <a-select
                v-model:value="bForm.channelId"
                placeholder="选择渠道"
                style="width: 100%"
                @change="
                  (val: unknown) =>
                    onBatchChannelChange(typeof val === 'string' ? val : '')
                "
              >
                <a-select-option
                  v-for="o in ch.channelOptions"
                  :key="o.value"
                  :value="o.value"
                  >{{ o.label }}</a-select-option
                >
              </a-select>
            </a-form-item>
            <a-form-item label="推广任务">
              <a-select
                v-model:value="bForm.taskId"
                placeholder="选择推广任务"
                style="width: 100%"
                :disabled="!bForm.channelId"
              >
                <a-select-option
                  v-for="o in tk.taskOptions"
                  :key="o.value"
                  :value="o.value"
                  >{{ o.label }}</a-select-option
                >
              </a-select>
            </a-form-item>
            <a-form-item label="XLSX 文件">
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                class="file-input"
                @change="onFileChange"
              />
            </a-form-item>
            <a-form-item>
              <a-button
                type="primary"
                :disabled="
                  pl.batchUploading ||
                  !batchFile ||
                  !bForm.channelId ||
                  !bForm.taskId
                "
                :loading="pl.batchUploading"
                @click="submitBatch"
              >
                提交批量计划
              </a-button>
            </a-form-item>
          </a-form>
          <div v-if="pl.lastBatchTaskId" class="success-card animate-card">
            <span
              >任务 ID：<code class="plan-id">{{
                pl.lastBatchTaskId
              }}</code></span
            >
            <button class="act-btn" @click="copyBatchTaskId">复制 ID</button>
            <span>提交成功不代表完成，结果下载尚未开放</span>
          </div>
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { useZChannelStore } from "@/stores/zChannel.store";
import { useZTaskStore } from "@/stores/zTask.store";
import { useZPlanStore } from "@/stores/zPlan.store";

const ch = useZChannelStore();
const tk = useZTaskStore();
const pl = useZPlanStore();
interface FormRef {
  resetFields: () => void;
}
const router = useRouter();
const formRef = ref<FormRef>();
const activeTab = ref("single");
const form = reactive({
  channelId: "",
  secondChannelId: "",
  taskId: "",
  keyword: "",
  contentUrl: "",
});
const bForm = reactive({ channelId: "", taskId: "" });
const batchFile = ref<File | null>(null);
const secondChannelUnavailable = ref(false);

async function onChannelChange(id: string) {
  form.taskId = "";
  form.secondChannelId = "";
  secondChannelUnavailable.value = false;
  if (!id) return;
  const secondChannelRequest = ch.fetchSecondChannels(id).then((available) => {
    if (form.channelId === id) secondChannelUnavailable.value = !available;
  });
  await Promise.all([tk.fetchTasks(id), secondChannelRequest]);
}
async function onBatchChannelChange(id: string) {
  bForm.taskId = "";
  if (id) await tk.fetchTasks(id);
}
async function submitForm() {
  await pl.submitCreatePlan({
    taskId: form.taskId,
    channelId: form.channelId,
    contentUrl: form.contentUrl,
    popularizeType: 0,
    keyword: form.keyword,
    secondChannelId: form.secondChannelId || undefined,
  });
}
async function copyPlanId() {
  await navigator.clipboard.writeText(pl.lastPlanId);
  message.success("已复制");
}
function goCreateComp() {
  router.push({
    path: "/dashboard/z-compositions",
    query: {
      tab: "create",
      planId: pl.lastPlanId,
      channelId: pl.lastChannelId,
      keyword: pl.lastKeyword,
    },
  });
}
function onFileChange(e: Event) {
  batchFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}
async function submitBatch() {
  if (
    pl.batchUploading ||
    !batchFile.value ||
    !bForm.channelId ||
    !bForm.taskId
  )
    return;
  await pl.submitBatchCreate(batchFile.value, {
    taskId: bForm.taskId,
    channelId: bForm.channelId,
    popularizeType: 0,
  });
}
async function copyBatchTaskId() {
  if (!pl.lastBatchTaskId) return;
  await navigator.clipboard.writeText(pl.lastBatchTaskId);
  message.success("已复制");
}
onMounted(() => ch.fetchChannels());
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
.success-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--color-success-bg);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: var(--radius-md);
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
  flex-wrap: wrap;
}
.plan-id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-accent);
  background: var(--color-accent-subtle);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.act-btn {
  padding: 4px 10px;
  background: var(--color-bg-active);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.act-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.act-btn.accent {
  background: var(--color-accent-subtle);
  border-color: var(--color-accent-border);
  color: var(--color-accent);
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
  color: var(--color-warning);
  font-size: 12px;
}
.file-input {
  color: var(--color-text-secondary);
  font-size: 13px;
}
</style>
