<template>
  <div class="intercept-view">
    <el-tabs v-model="activeTab">

      <!-- ── 举报列表 ── -->
      <el-tab-pane label="截流词记录" name="list">
        <el-form inline style="margin-top:12px">
          <el-form-item label="关键词">
            <el-input v-model="filterKeyword" placeholder="筛选关键词" clearable style="width:180px" />
          </el-form-item>
          <el-form-item label="审核状态">
            <el-select v-model="filterStatus" placeholder="全部" clearable style="width:120px">
              <el-option label="审核中" :value="0" />
              <el-option label="判定违规" :value="1" />
              <el-option label="判定正常" :value="2" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="doSearch" :loading="interceptStore.loading">查询</el-button>
          </el-form-item>
        </el-form>

        <el-table :data="interceptStore.items" v-loading="interceptStore.loading" border empty-text="暂无记录">
          <el-table-column prop="keyword" label="截流词" min-width="140" />
          <el-table-column prop="channel" label="渠道" min-width="120" show-overflow-tooltip />
          <el-table-column label="审核状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" size="small">
                {{ AUDIT_STATUS_LABELS[row.status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="valided_at" label="生效时间" min-width="160" />
        </el-table>
        <div class="pagination-bar">
          <el-pagination
            :total="interceptStore.pagination.total"
            :page-size="interceptStore.pagination.limit"
            layout="total, prev, pager, next"
            @current-change="interceptStore.fetchPage"
          />
        </div>
      </el-tab-pane>

      <!-- ── 提交举报 ── -->
      <el-tab-pane label="提交举报" name="submit">
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-width="120px"
          style="max-width:640px; margin-top:12px"
        >
          <el-form-item label="作品 ID" prop="composition_id">
            <el-input v-model="form.composition_id" placeholder="被截流的作品 composition_id" />
          </el-form-item>
          <el-form-item label="截流词" prop="keyword">
            <el-input v-model="form.keyword" placeholder="在作品评论区的引流词" />
          </el-form-item>
          <el-form-item label="举报截图" prop="image_tokens">
            <UploadButton v-model="form.image_tokens" :max-count="3" />
          </el-form-item>
          <el-form-item>
            <el-button
              type="danger"
              :loading="interceptStore.submitting"
              @click="submitForm"
            >
              提交举报（不可撤销）
            </el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useInterceptStore } from '@/stores/intercept.store'
import { AUDIT_STATUS_LABELS, AuditStatusResponse } from '@/constants/enums'
import UploadButton from '@/components/UploadButton.vue'

const interceptStore = useInterceptStore()
const activeTab = ref('list')
const formRef = ref<FormInstance>()

const filterKeyword = ref('')
const filterStatus = ref<AuditStatusResponse | null>(null)

function statusTagType(status: AuditStatusResponse) {
  if (status === AuditStatusResponse.Violation) return 'danger'
  if (status === AuditStatusResponse.Normal) return 'success'
  return 'warning'
}

function doSearch() {
  interceptStore.fetchList({
    keyword: filterKeyword.value || undefined,
    // ⚠️ 返回值 0/1/2，查询参数用 1/2/3，需 +1 转换
    status: filterStatus.value !== null ? (filterStatus.value + 1) as 1 | 2 | 3 : undefined,
  })
}

const form = reactive({ composition_id: '', keyword: '', image_tokens: '' })

const rules: FormRules = {
  composition_id: [{ required: true, message: '请输入作品 ID', trigger: 'blur' }],
  keyword:        [{ required: true, message: '请输入截流词', trigger: 'blur' }],
  image_tokens:   [{ required: true, message: '请上传至少一张截图', trigger: 'change' }],
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  await interceptStore.submit({
    composition_id: form.composition_id,
    keyword: form.keyword,
    image_tokens: form.image_tokens,
  })
  formRef.value?.resetFields()
}

onMounted(() => interceptStore.fetchList())
</script>

<style scoped>
.intercept-view { padding: 20px; }
.pagination-bar { display:flex; justify-content:flex-end; margin-top:12px; }
</style>
