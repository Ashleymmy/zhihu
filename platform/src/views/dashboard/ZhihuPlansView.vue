<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">创建推广计划</h1><p class="pg-sub">向知乎联盟提交推广计划，支持单个与批量创建</p></div>
    </div>

    <a-tabs v-model:activeKey="activeTab" class="z-tabs">
      <!-- ── 单个创建 ── -->
      <a-tab-pane key="single" tab="单个创建">
        <a-form ref="formRef" :model="form" layout="vertical" style="max-width:560px;margin-top:8px" @finish="submitForm">
          <a-form-item label="一代渠道" name="channel_id" :rules="[{required:true,message:'请选择渠道'}]">
            <a-select v-model:value="form.channel_id" placeholder="选择渠道" @change="(val: any) => onChannelChange(val)">
              <a-select-option v-for="o in ch.channelOptions" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="二代渠道（可选）">
            <a-select v-model:value="form.second_channel_id" placeholder="不指定（可选）" allow-clear :disabled="!form.channel_id">
              <a-select-option v-for="o in ch.getSecondOptions(form.channel_id)" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="推广任务" name="task_id" :rules="[{required:true,message:'请选择推广任务'}]">
            <a-select v-model:value="form.task_id" placeholder="选择推广任务" :disabled="!form.channel_id" :loading="tk.loading">
              <a-select-option v-for="o in tk.taskOptions" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="关键词" name="keyword" :rules="[{required:true,message:'请输入关键词'},{pattern:/^[^,\s，]+$/,message:'不能含逗号或空格'}]">
            <a-input v-model:value="form.keyword" placeholder="仅支持单个关键词，不含逗号或空格" />
          </a-form-item>
          <a-form-item label="推广内容地址" name="content_url" :rules="[{required:true,message:'请输入推广地址'},{type:'url',message:'请输入合法的 URL'}]">
            <a-input v-model:value="form.content_url" placeholder="https://..." />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" html-type="submit" :loading="pl.creating">创建计划</a-button>
            <a-button style="margin-left:8px" @click="formRef?.resetFields()">重置</a-button>
          </a-form-item>
        </a-form>

        <div v-if="pl.lastPlanId" class="success-card animate-card">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <span>创建成功 — Plan ID：<code class="plan-id">{{ pl.lastPlanId }}</code></span>
          <button class="act-btn" @click="copyPlanId">复制 ID</button>
          <button class="act-btn accent" @click="goCreateComp">→ 立即创建作品</button>
        </div>
      </a-tab-pane>

      <!-- ── 批量创建 ── -->
      <a-tab-pane key="batch" tab="批量创建">
        <div style="max-width:560px;margin-top:8px">
          <div class="batch-tip">① 下载模板 1 → ② 填写关键词 + 推广内容地址 → ③ 上传 Excel → ④ 等待结果 → ⑤ 下载结果文件</div>
          <a-form layout="vertical">
            <a-form-item label="一代渠道">
              <a-select v-model:value="bForm.channel_id" placeholder="选择渠道" style="width:100%">
                <a-select-option v-for="o in ch.channelOptions" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="推广任务">
              <a-select v-model:value="bForm.task_id" placeholder="选择推广任务" :disabled="!bForm.channel_id" style="width:100%">
                <a-select-option v-for="o in tk.taskOptions" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="Excel 文件（模板 1）">
              <input type="file" accept=".xlsx,.xls" class="file-input" @change="onFileChange" />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" :loading="pl.batchUploading||pl.batchPolling" :disabled="!batchFile||!bForm.channel_id||!bForm.task_id" @click="submitBatch">
                {{ pl.batchPolling ? '等待结果…' : '上传并批量创建' }}
              </a-button>
            </a-form-item>
          </a-form>
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { useZChannelStore } from '@/stores/zChannel.store'
import { useZTaskStore }    from '@/stores/zTask.store'
import { useZPlanStore }    from '@/stores/zPlan.store'

const ch = useZChannelStore(); const tk = useZTaskStore(); const pl = useZPlanStore()
const router = useRouter(); const formRef = ref<any>(); const activeTab = ref('single')
const form  = reactive({ channel_id: '', second_channel_id: '', task_id: '', keyword: '', content_url: '' })
const bForm = reactive({ channel_id: '', task_id: '' }); const batchFile = ref<File|null>(null)

async function onChannelChange(id: string) {
  form.task_id = ''; form.second_channel_id = ''
  if (id) await Promise.all([tk.fetchTasks(id), ch.fetchSecondChannels(id)])
}
async function submitForm() {
  await pl.submitCreatePlan({ task_id: form.task_id, channel_id: form.channel_id, content_url: form.content_url, popularize_type: 0, keyword: form.keyword, second_channel_id: form.second_channel_id || undefined })
}
async function copyPlanId() { await navigator.clipboard.writeText(pl.lastPlanId); message.success('已复制') }
function goCreateComp() { router.push({ path: '/dashboard/z-compositions', query: { tab: 'create', planId: pl.lastPlanId, channel_id: pl.lastChannelId } }) }
function onFileChange(e: Event) { batchFile.value = (e.target as HTMLInputElement).files?.[0] ?? null }
async function submitBatch() {
  if (!batchFile.value) return
  await pl.submitBatchCreate(batchFile.value, { task_id: bForm.task_id, channel_id: bForm.channel_id, popularize_type: 0 })
}
onMounted(() => ch.fetchChannels())
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.z-tabs :deep(.ant-tabs-nav) { margin-bottom: 16px; }
.success-card { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: var(--color-success-bg); border: 1px solid rgba(16,185,129,0.2); border-radius: var(--radius-md); margin-top: 12px; font-size: 13px; color: var(--color-text-secondary); flex-wrap: wrap; }
.plan-id { font-family: var(--font-mono); font-size: 12px; color: var(--color-accent); background: var(--color-accent-subtle); padding: 2px 6px; border-radius: var(--radius-sm); }
.act-btn { padding: 4px 10px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 12px; color: var(--color-text-secondary); cursor: pointer; transition: all var(--transition-fast); }
.act-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.act-btn.accent { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent); }
.batch-tip { padding: 10px 14px; background: var(--color-info-bg); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-info); margin-bottom: 16px; }
.file-input { color: var(--color-text-secondary); font-size: 13px; }
</style>
