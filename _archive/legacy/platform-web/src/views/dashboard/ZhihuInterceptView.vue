<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">截流举报</h1><p class="pg-sub">查看截流词记录 / 提交新举报</p></div>
    </div>
    <a-tabs v-model:activeKey="tab" class="z-tabs">
      <a-tab-pane key="list" tab="截流词记录">
        <div class="filter-row">
          <a-input v-model:value="query.keyword" placeholder="搜索关键词…" style="width:180px" allow-clear />
          <a-select v-model:value="query.status" placeholder="全部状态" style="width:130px" allow-clear>
            <a-select-option :value="1">审核中</a-select-option>
            <a-select-option :value="2">通过</a-select-option>
            <a-select-option :value="3">拒绝</a-select-option>
          </a-select>
          <a-button type="primary" @click="fetchList">查询</a-button>
        </div>
        <div class="table-card">
          <a-table :data-source="store.items" :loading="store.loading" row-key="keyword" size="middle"
            :pagination="{ total: store.total, pageSize: store.limit, onChange: store.fetchPage }">
            <a-table-column title="关键词" data-index="keyword" />
            <a-table-column title="渠道"   data-index="channel" :width="140" />
            <a-table-column title="状态"   :width="90">
              <template #default="{ record }">
                <span :class="['badge', statusClass(record.status)]">{{ statusLabel(record.status) }}</span>
              </template>
            </a-table-column>
            <a-table-column title="审核时间" data-index="valided_at" :width="160" />
          </a-table>
        </div>
      </a-tab-pane>

      <a-tab-pane key="submit" tab="提交举报">
        <div class="alert-warn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          提交后不可撤销，请确认信息后再提交
        </div>
        <a-form :model="submitForm" layout="vertical" style="max-width:520px" @finish="handleSubmit">
          <a-form-item label="作品 ID" name="composition_id" :rules="[{required:true,message:'请输入作品 ID'}]">
            <a-input v-model:value="submitForm.composition_id" placeholder="推广作品的 composition_id" />
          </a-form-item>
          <a-form-item label="关键词" name="keyword" :rules="[{required:true,message:'请输入关键词'}]">
            <a-input v-model:value="submitForm.keyword" placeholder="截流词" />
          </a-form-item>
          <a-form-item label="截图凭证（image_tokens）" name="image_tokens">
            <a-input v-model:value="submitForm.image_tokens" placeholder="逗号分隔的 file_token（先在风险词管理页上传图片获取）" />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" html-type="submit" danger :loading="store.submitting">确认提交（不可撤销）</a-button>
          </a-form-item>
        </a-form>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useZInterceptStore } from '@/stores/zIntercept.store'

const store = useZInterceptStore()
const tab   = ref('list')
const query = reactive<{ keyword?: string; status?: number }>({})
const submitForm = reactive({ composition_id: '', keyword: '', image_tokens: '' })

const statusClass = (s: number) => s === 2 ? 'badge-success' : s === 3 ? 'badge-error' : 'badge-warning'
const statusLabel = (s: number) => s === 2 ? '通过' : s === 3 ? '拒绝' : '审核中'

async function fetchList() { await store.fetchList(query) }
async function handleSubmit() {
  await store.submit(submitForm)
  message.success('举报已提交')
  Object.assign(submitForm, { composition_id: '', keyword: '', image_tokens: '' })
  tab.value = 'list'; await fetchList()
}
onMounted(fetchList)
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.z-tabs :deep(.ant-tabs-nav) { margin-bottom: 16px; }
.filter-row { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.alert-warn { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--color-warning-bg); border: 1px solid rgba(245,158,11,0.2); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-warning); margin-bottom: 16px; }
</style>
