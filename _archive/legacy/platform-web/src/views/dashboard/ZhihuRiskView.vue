<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">风险词管理</h1><p class="pg-sub">查看风险词记录 / 提交截流词或搬运词举报</p></div>
    </div>
    <a-tabs v-model:activeKey="tab" class="z-tabs">
      <a-tab-pane key="list" tab="风险词记录">
        <div class="filter-row">
          <a-input v-model:value="query.keyword" placeholder="搜索关键词…" style="width:180px" allow-clear />
          <a-select v-model:value="query.risk_type" placeholder="全部类型" style="width:120px" allow-clear>
            <a-select-option :value="1">截流词</a-select-option>
            <a-select-option :value="2">搬运词</a-select-option>
          </a-select>
          <a-select v-model:value="query.status" placeholder="全部状态" style="width:120px" allow-clear>
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
            <a-table-column title="类型" :width="90">
              <template #default="{ record }">
                <span :class="['badge', record.risk_type===2?'badge-error':'badge-warning']">{{ record.risk_type===2?'搬运词':'截流词' }}</span>
              </template>
            </a-table-column>
            <a-table-column title="渠道" data-index="channel" :width="140" />
            <a-table-column title="状态" :width="90">
              <template #default="{ record }">
                <span :class="['badge', record.status===2?'badge-success':record.status===3?'badge-error':'badge-warning']">{{ record.status===2?'通过':record.status===3?'拒绝':'审核中' }}</span>
              </template>
            </a-table-column>
            <a-table-column title="审核时间" data-index="valided_at" :width="160" />
          </a-table>
        </div>
      </a-tab-pane>

      <a-tab-pane key="submit" tab="提交风险词">
        <div class="alert-warn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          提交后不可撤销，请确认信息后再提交
        </div>
        <a-form :model="sf" layout="vertical" style="max-width:520px" @finish="handleSubmit">
          <a-form-item label="风险类型" name="risk_type" :rules="[{required:true}]">
            <a-radio-group v-model:value="sf.risk_type">
              <a-radio :value="1">截流词</a-radio>
              <a-radio :value="2">搬运词</a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item label="作品 ID" name="composition_id" :rules="[{required:true,message:'请输入作品 ID'}]">
            <a-input v-model:value="sf.composition_id" placeholder="推广作品的 composition_id" />
          </a-form-item>
          <a-form-item label="关键词" name="keyword" :rules="[{required:true,message:'请输入关键词'}]">
            <a-input v-model:value="sf.keyword" placeholder="风险词" />
          </a-form-item>
          <a-form-item v-if="sf.risk_type===2" label="搬运原文链接" name="risk_url" :rules="[{required:true,message:'搬运词必须填写原文链接'}]">
            <a-input v-model:value="sf.risk_url" placeholder="https://..." />
          </a-form-item>
          <a-form-item label="截图凭证（image_tokens）">
            <a-input v-model:value="sf.image_tokens" placeholder="逗号分隔的 file_token" />
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
import { useZRiskStore } from '@/stores/zRisk.store'

const store = useZRiskStore()
const tab   = ref('list')
const query = reactive<{ keyword?: string; risk_type?: number; status?: number }>({})
const sf    = reactive({ risk_type: 1, composition_id: '', keyword: '', risk_url: '', image_tokens: '' })

async function fetchList() { await store.fetchList(query) }
async function handleSubmit() {
  await store.submit({ ...sf, risk_url: sf.risk_type===2 ? sf.risk_url : undefined } as any)
  message.success('已提交')
  Object.assign(sf, { composition_id:'',keyword:'',risk_url:'',image_tokens:'' })
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
