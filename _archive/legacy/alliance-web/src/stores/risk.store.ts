/**
 * 风险举报 Store
 * 来源：docs/03-接口文档.md § 十四
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { submitRiskWord, getRiskWords } from '@/services/risk.service'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  RiskWord,
  SubmitRiskWordRequest,
  GetRiskWordsQuery,
  Pagination,
} from '@/types/models'

export const useRiskStore = defineStore('risk', () => {
  const items = ref<RiskWord[]>([])
  const loading = ref(false)
  const pagination = ref<Pagination>({ total: 0, offset: 0, limit: 20 })
  const lastQuery = ref<GetRiskWordsQuery>({})

  async function fetchList(query: GetRiskWordsQuery = {}): Promise<void> {
    loading.value = true
    lastQuery.value = query
    try {
      const res = await getRiskWords({ ...query, limit: pagination.value.limit })
      items.value = res.data
      pagination.value = res.pagination
    } finally {
      loading.value = false
    }
  }

  async function fetchPage(page: number): Promise<void> {
    await fetchList({
      ...lastQuery.value,
      offset: (page - 1) * pagination.value.limit,
    })
  }

  const submitting = ref(false)

  async function submit(req: SubmitRiskWordRequest): Promise<void> {
    const typeLabel = req.risk_type === 1 ? '截流词' : '搬运词'
    await ElMessageBox.confirm(
      `确认举报${typeLabel}「${req.keyword}」？此操作不可撤销。`,
      '二次确认',
      { type: 'warning', confirmButtonText: '确认举报', cancelButtonText: '取消' },
    )
    submitting.value = true
    try {
      await submitRiskWord(req)
      ElMessage.success('风险词举报已提交，等待审核')
      await fetchList(lastQuery.value)
    } finally {
      submitting.value = false
    }
  }

  return { items, loading, pagination, fetchList, fetchPage, submitting, submit }
})
