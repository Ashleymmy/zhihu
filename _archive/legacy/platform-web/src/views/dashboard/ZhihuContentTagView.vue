<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">内容标签查询</h1><p class="pg-sub">查询知乎内容的兴趣 / 一级领域 / 内容等级标签</p></div>
    </div>
    <a-tabs v-model:activeKey="tab" class="z-tabs">
      <a-tab-pane key="single" tab="单个查询">
        <a-form layout="vertical" style="max-width:560px;margin-top:8px" @finish="querySingle">
          <a-form-item label="知乎内容链接（问题/文章/回答）" name="url" :rules="[{required:true,message:'请输入链接'}]">
            <a-input v-model:value="url" placeholder="https://www.zhihu.com/question/..." />
          </a-form-item>
          <a-form-item label="标签类型">
            <a-checkbox-group v-model:value="tagTypes">
              <a-checkbox :value="1">兴趣标签</a-checkbox>
              <a-checkbox :value="2">一级领域</a-checkbox>
              <a-checkbox :value="3">内容等级</a-checkbox>
            </a-checkbox-group>
          </a-form-item>
          <a-form-item>
            <a-button type="primary" html-type="submit" :loading="store.singleLoading">查询</a-button>
          </a-form-item>
        </a-form>

        <div v-if="store.singleResult" class="result-card animate-card">
          <div class="result-title">查询结果</div>
          <div v-for="(val, key) in store.singleResult" :key="key" class="result-row">
            <span class="rr-key">{{ key }}</span>
            <span class="rr-val">{{ Array.isArray(val) ? val.join('、') : String(val) }}</span>
          </div>
        </div>
      </a-tab-pane>

      <a-tab-pane key="batch" tab="批量查询">
        <div style="max-width:560px;margin-top:8px">
          <div class="batch-tip">① 下载模板 3 → ② 填写内容链接 → ③ 上传 Excel → ④ 等待结果 → ⑤ 下载含标签的结果文件</div>
          <a-form layout="vertical">
            <a-form-item label="Excel 文件（模板 3）">
              <input type="file" accept=".xlsx,.xls" class="file-input" @change="onFileChange" />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" :loading="store.batchUploading || store.batchPolling" :disabled="!batchFile" @click="submitBatch">
                {{ store.batchPolling ? '等待结果…' : '上传并批量查询' }}
              </a-button>
            </a-form-item>
          </a-form>
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useZContentTagStore } from '@/stores/zContentTag.store'

const store = useZContentTagStore()
const tab       = ref('single')
const url       = ref('')
const tagTypes  = ref<number[]>([1, 2, 3])
const batchFile = ref<File | null>(null)

async function querySingle() { await store.querySingle(url.value, tagTypes.value) }
function onFileChange(e: Event) { batchFile.value = (e.target as HTMLInputElement).files?.[0] ?? null }
async function submitBatch() { if (batchFile.value) await store.submitBatch(batchFile.value) }
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.z-tabs :deep(.ant-tabs-nav) { margin-bottom: 16px; }
.result-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 20px; margin-top: 4px; }
.result-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 14px; }
.result-row { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--color-border); font-size: 13px; }
.result-row:last-child { border-bottom: none; }
.rr-key { color: var(--color-text-tertiary); min-width: 80px; flex-shrink: 0; }
.rr-val { color: var(--color-text-secondary); }
.batch-tip { padding: 10px 14px; background: var(--color-info-bg); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-info); margin-bottom: 16px; }
.file-input { color: var(--color-text-secondary); font-size: 13px; }
</style>
