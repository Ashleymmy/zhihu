import { defineStore } from 'pinia'
import { ref } from 'vue'
import { allianceInterceptApi } from '@/api/alliance'
import type { InterceptWord } from '@/api/alliance'

export const useZInterceptStore = defineStore('zIntercept', () => {
  const items      = ref<InterceptWord[]>([])
  const loading    = ref(false)
  const submitting = ref(false)
  const total      = ref(0)
  const offset     = ref(0)
  const limit      = ref(20)
  const lastQuery  = ref<Record<string, unknown>>({})

  async function fetchList(query: Record<string, unknown> = {}) {
    loading.value = true; lastQuery.value = query; offset.value = 0
    try {
      const res = await allianceInterceptApi.getWords({ ...query, offset: 0, limit: limit.value } as any)
      items.value = res.data; total.value = res.pagination?.total ?? res.data.length
    } finally { loading.value = false }
  }

  async function fetchPage(page: number) {
    loading.value = true; offset.value = (page - 1) * limit.value
    try {
      const res = await allianceInterceptApi.getWords({ ...lastQuery.value, offset: offset.value, limit: limit.value } as any)
      items.value = res.data; total.value = res.pagination?.total ?? res.data.length
    } finally { loading.value = false }
  }

  async function submit(req: Parameters<typeof allianceInterceptApi.submitWord>[0]) {
    submitting.value = true
    try { await allianceInterceptApi.submitWord(req) }
    finally { submitting.value = false }
  }

  return { items, loading, submitting, total, offset, limit, fetchList, fetchPage, submit }
})
