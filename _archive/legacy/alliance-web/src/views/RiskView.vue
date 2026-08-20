<template>
  <div class="risk-view">
    <el-tabs v-model="activeTab">

      <!-- ── 风险词记录 ── -->
      <el-tab-pane label="风险词记录" name="list">
        <el-form inline style="margin-top:12px">
          <el-form-item label="关键词">
            <el-input v-model="filterKeyword" placeholder="筛选" clearable style="width:160px" />
          </el-form-item>
          <el-form-item label="风险类型">
            <el-select v-model="filterRiskType" placeholder="全部" clearable style="width:120px">
              <el-option label="截流词" :value="1" />
              <el-option label="搬运词" :value="2" />
            </el-select>
          </el-form-item>
          <el-form-item label="审核状态">
            <el-select v-model="filterStatus" placeholder="全部" clearable style="width:120px">
              <el-option label="审核中" :value="0" />
              <el-option label="判定违规" :value="1" />
              <el-option label="判定正常" :value="2" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="riskStore.loading" @click="doSearch">查询</el-button>
          </el-form-item>
        </el-form>

        <el-table :data="riskStore.items" v-loading="riskStore.loading" border empty-text="暂无记录">
          <el-table-column prop="keyword" label="风险词" min-width="140" />
          <el-table-column label="类型" width="80">
            <template #default="{ row }">
              <el-tag :type="row.risk_type === 2 ? 'danger' : 'warning'" size="small">
                {{ row.risk_type === 1 ? '截流词' : '搬运词' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="channel" label="渠道" show-overflow-tooltip />
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
            :total="riskStore.pagination.total"
            :page-size="riskStore.pagination.limit"
            layout="total, prev, pager, next"
            @current-change="riskStore.fetchPage"
          />
        </div>
      </el-tab-pane>

      <!-- ── 提交举报 ── -->
      <el-tab-pane label="提交风险词" name="submit">
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-width="120px"
          style="max-width:640px; margin-top:12px"
        >
          <el-form-item label="风险类型" prop="risk_type">
            <el-radio-group v-model="form.risk_type">
              <el-radio :value="1">截流词（risk_url 可选）</el-radio>
              <el-radio :value="2">搬运词（risk_url 必填）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="作品 ID" prop="composition_id">
            <el-input v-model="form.composition_id" />
          </el-form-item>
          <el-form-item label="风险词" prop="keyword">
            <el-input v-model="form.keyword" />
          </el-form-item>
          <el-form-item
            label="风险 URL"
            prop="risk_url"
            :required="form.risk_type === 2"
          >
            <el-input v-model="form.risk_url" placeholder="搬运词时必填" />
          </el-form-item>
          <el-form-item label="受损词">
            <el-input v-model="form.damage_keyword" placeholder="可选" />
          </el-form-item>
          <el-form-item label="举报截图" prop="image_tokens">
            <UploadButton v-model="form.image_tokens" :max-count="3" />
          </el-form-item>
          <el-form-item>
            <el-button type="danger" :loading="riskStore.submitting" @click="submitForm">
              提交举报（不可撤销）
            </el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useRiskStore } from '@/stores/risk.store'
import { AUDIT_STATUS_LABELS, AuditStatusResponse, RiskType } from '@/constants/enums'
import UploadButton from '@/components/UploadButton.vue'

const riskStore = useRiskStore()
const activeTab = ref('list')
const formRef = ref<FormInstance>()

const filterKeyword = ref('')
const filterRiskType = ref<number | null>(null)
const filterStatus = ref<AuditStatusResponse | null>(null)

function statusTagType(s: AuditStatusResponse) {
  return s === AuditStatusResponse.Violation ? 'danger'
       : s === AuditStatusResponse.Normal    ? 'success'
       : 'warning'
}

function doSearch() {
  riskStore.fetchList({
    keyword:   filterKeyword.value || undefined,
    risk_type: filterRiskType.value ?? undefined,
    status:    filterStatus.value !== null ? (filterStatus.value + 1) as 1|2|3 : undefined,
  })
}

const form = reactive({
  risk_type:      RiskType.InterceptWord as number,
  composition_id: '',
  keyword:        '',
  risk_url:       '',
  damage_keyword: '',
  image_tokens:   '',
})

const rules = computed<FormRules>(() => ({
  risk_type:      [{ required: true }],
  composition_id: [{ required: true, message: '请输入作品 ID', trigger: 'blur' }],
  keyword:        [{ required: true, message: '请输入风险词', trigger: 'blur' }],
  risk_url:       form.risk_type === 2
    ? [{ required: true, message: '搬运词时必须提供风险 URL', trigger: 'blur' },
       { type: 'url', message: '请输入合法 URL', trigger: 'blur' }]
    : [],
  image_tokens:   [{ required: true, message: '请上传至少一张截图', trigger: 'change' }],
}))

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  await riskStore.submit({
    risk_type:      form.risk_type,
    composition_id: form.composition_id,
    keyword:        form.keyword,
    image_tokens:   form.image_tokens,
    risk_url:       form.risk_url || undefined,
    damage_keyword: form.damage_keyword || undefined,
  })
  formRef.value?.resetFields()
}
</script>

<style scoped>
.risk-view { padding: 20px; }
.pagination-bar { display:flex; justify-content:flex-end; margin-top:12px; }
</style>
