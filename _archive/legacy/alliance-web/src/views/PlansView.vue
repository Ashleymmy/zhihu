<template>
  <div class="plans-view">
    <h2>创建推广计划</h2>

    <el-tabs v-model="activeTab">
      <!-- ── 单个创建 ── -->
      <el-tab-pane label="单个创建" name="single">
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-width="120px"
          style="max-width: 640px; margin-top: 16px"
        >
          <!-- 渠道 -->
          <el-form-item label="一代渠道" prop="channel_id">
            <el-select
              v-model="form.channel_id"
              placeholder="选择渠道"
              style="width: 100%"
              @change="onChannelChange"
            >
              <el-option
                v-for="opt in channelStore.channelOptions"
                :key="opt.value" :label="opt.label" :value="opt.value"
              />
            </el-select>
          </el-form-item>

          <!-- 二代渠道（可选） -->
          <el-form-item label="二代渠道">
            <el-select
              v-model="form.second_channel_id"
              placeholder="不指定（可选）"
              clearable
              style="width: 100%"
              :disabled="!form.channel_id"
              :loading="channelStore.secondLoading[form.channel_id]"
            >
              <el-option
                v-for="opt in channelStore.getSecondOptions(form.channel_id)"
                :key="opt.value" :label="opt.label" :value="opt.value"
              />
            </el-select>
          </el-form-item>

          <!-- 推广任务 -->
          <el-form-item label="推广任务" prop="task_id">
            <el-select
              v-model="form.task_id"
              placeholder="选择推广任务"
              style="width: 100%"
              :disabled="!form.channel_id"
              :loading="taskStore.loading"
            >
              <el-option
                v-for="opt in taskStore.taskOptions"
                :key="opt.value" :label="opt.label" :value="opt.value"
              />
            </el-select>
          </el-form-item>

          <!-- 关键词 -->
          <el-form-item label="关键词" prop="keyword">
            <el-input v-model="form.keyword" placeholder="仅支持单个关键词，不含逗号或空格" />
          </el-form-item>

          <!-- 推广内容地址 -->
          <el-form-item label="推广内容地址" prop="content_url">
            <el-input v-model="form.content_url" placeholder="https://..." />
          </el-form-item>

          <!-- 提交 -->
          <el-form-item>
            <el-button type="primary" :loading="planStore.creating" @click="submitForm">
              创建计划
            </el-button>
            <el-button @click="resetForm">重置</el-button>
          </el-form-item>
        </el-form>

        <!-- 创建结果 -->
        <el-alert
          v-if="planStore.lastPlanId"
          :title="`创建成功 — 计划 ID：${planStore.lastPlanId}`"
          type="success"
          show-icon
          style="max-width: 640px; margin-top: 8px"
        >
          <template #default>
            <el-button link @click="copyPlanId">复制 Plan ID</el-button>
            <el-divider direction="vertical" />
            <el-button link type="primary" @click="goCreateComposition">
              → 立即创建作品（自动带入计划 ID + 渠道）
            </el-button>
          </template>
        </el-alert>
      </el-tab-pane>

      <!-- ── 批量创建 ── -->
      <el-tab-pane label="批量创建" name="batch">
        <div style="max-width: 640px; margin-top: 16px">
          <el-alert
            title="批量创建流程"
            type="info"
            :closable="false"
            style="margin-bottom: 16px"
          >
            ① 下载模板 1 → ② 填写关键词 + 推广内容地址 → ③ 上传 Excel →
            ④ 自动轮询结果 → ⑤ 下载结果文件查看每行状态
          </el-alert>

          <el-form label-width="120px">
            <el-form-item label="一代渠道">
              <el-select v-model="batchForm.channel_id" placeholder="选择渠道" style="width: 100%">
                <el-option
                  v-for="opt in channelStore.channelOptions"
                  :key="opt.value" :label="opt.label" :value="opt.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="推广任务">
              <el-select
                v-model="batchForm.task_id"
                placeholder="选择推广任务"
                style="width: 100%"
                :disabled="!batchForm.channel_id"
              >
                <el-option
                  v-for="opt in taskStore.taskOptions"
                  :key="opt.value" :label="opt.label" :value="opt.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="Excel 文件">
              <el-upload
                :auto-upload="false"
                :on-change="(f: UploadFile) => batchFile = f.raw ?? null"
                accept=".xlsx,.xls"
                :limit="1"
              >
                <el-button>选择文件（模板 1）</el-button>
              </el-upload>
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="planStore.batchUploading || planStore.batchPolling"
                :disabled="!batchFile || !batchForm.channel_id || !batchForm.task_id"
                @click="submitBatch"
              >
                {{ planStore.batchPolling ? '等待结果...' : '上传并批量创建' }}
              </el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules, UploadFile } from 'element-plus'
import { useChannelStore } from '@/stores/channel.store'
import { useTaskStore } from '@/stores/task.store'
import { usePlanStore } from '@/stores/plan.store'
import { PopularizeType } from '@/constants/enums'

const channelStore = useChannelStore()
const taskStore = useTaskStore()
const planStore = usePlanStore()
const router = useRouter()

const activeTab = ref('single')
const formRef = ref<FormInstance>()

const form = reactive({
  channel_id: '',
  second_channel_id: '',
  task_id: '',
  keyword: '',
  content_url: '',
})

const rules: FormRules = {
  channel_id:  [{ required: true, message: '请选择渠道', trigger: 'change' }],
  task_id:     [{ required: true, message: '请选择推广任务', trigger: 'change' }],
  keyword:     [
    { required: true, message: '请输入关键词', trigger: 'blur' },
    { pattern: /^[^,\s，]+$/, message: '关键词不能含逗号或空格', trigger: 'blur' },
  ],
  content_url: [
    { required: true, message: '请输入推广内容地址', trigger: 'blur' },
    { type: 'url', message: '请输入合法的 URL', trigger: 'blur' },
  ],
}

async function onChannelChange(channelId: string) {
  form.task_id = ''
  form.second_channel_id = ''
  if (channelId) {
    await Promise.all([
      taskStore.fetchTasks(channelId),
      channelStore.fetchSecondChannels(channelId),
    ])
  }
}

async function submitForm() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    await planStore.submitCreatePlan({
      task_id: form.task_id,
      channel_id: form.channel_id,
      content_url: form.content_url,
      popularize_type: PopularizeType.KocSearch,
      keyword: form.keyword,
      second_channel_id: form.second_channel_id || undefined,
    })
  })
}

function resetForm() {
  formRef.value?.resetFields()
}

async function copyPlanId() {
  await navigator.clipboard.writeText(planStore.lastPlanId)
  ElMessage.success('已复制')
}

/** 跳转至作品创建页，自动带入 plan_id + channel_id，避免渠道不一致导致"计划未找到" */
function goCreateComposition() {
  router.push({
    path: '/compositions',
    query: {
      tab: 'create',
      plan_id: planStore.lastPlanId,
      channel_id: planStore.lastChannelId,
    },
  })
}

// 批量创建
const batchFile = ref<File | null>(null)
const batchForm = reactive({ channel_id: '', task_id: '' })

async function submitBatch() {
  if (!batchFile.value) return
  await planStore.submitBatchCreate(batchFile.value, {
    task_id: batchForm.task_id,
    channel_id: batchForm.channel_id,
    popularize_type: PopularizeType.KocSearch,
  })
}

onMounted(async () => {
  await channelStore.fetchChannels()
})
</script>

<style scoped>
.plans-view { padding: 20px; }
.plans-view h2 { margin-top: 0; margin-bottom: 16px; }
</style>