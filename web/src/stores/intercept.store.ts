/**
 * 评论截流 Store
 * 来源：docs/03-接口文档.md § 十一
 *
 * ⚠️ status 请求用 1/2/3，返回用 0/1/2，Store 层统一映射。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { submitInterceptWord, getInterceptWords } from '@/services/intercept.service'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  InterceptWord,
  SubmitInterceptWordRequest,
  GetInterceptWordsQuery,
  Pagination,
} from '@/types/models'

export const useInterceptStore = defineStore('intercept', () => {
  // ─── 列表 ──────────────────────────────────────────────────────────────────
  const items = ref<InterceptWord[]>([])
  const loading = ref(false)
  const pagination = ref<Pagination>({ total: 0, offset: 0, limit: 20 })
  const lastQuery = ref<GetInterceptWordsQuery>({})

  async function fetchList(query: GetInterceptWordsQuery = {}): Promise<void> {
    loading.value = true
    lastQuery.value = query
    try {
      const res = await getInterceptWords({ ...query, limit: pagination.value.limit })
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

  // ─── 提交 ──────────────────────────────────────────────────────────────────
  const submitting = ref(false)

  async function submit(req: SubmitInterceptWordRequest): Promise<void> {
    await ElMessageBox.confirm(
      `确认举报截流词「${req.keyword}」？此操作不可撤销。`,
      '二次确认',
      { type: 'warning', confirmButtonText: '确认举报', cancelButtonText: '取消' },
    )
    submitting.value = true
    try {
      await submitInterceptWord(req)
      ElMessage.success('举报已提交，等待审核')
      await fetchList(lastQuery.value)
    } finally {
      submitting.value = false
    }
  }

  return { items, loading, pagination, fetchList, fetchPage, submitting, submit }
})
