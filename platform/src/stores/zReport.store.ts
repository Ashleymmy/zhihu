import { defineStore } from 'pinia'
import { ref } from 'vue'
import { allianceReportApi } from '@/api/alliance'
import type { RealTimeDataItem } from '@/api/alliance'

export const useZReportStore = defineStore('zReport', () => {
  const data      = ref<RealTimeDataItem[]>([])
  const timeRange = ref('')
  const loading   = ref(false)

  async function fetchReport() {
    loading.value = true
    try {
      const res = await allianceReportApi.getRealTimeData()
      data.value      = res.data      ?? []
      timeRange.value = res.time_range ?? ''
    } finally { loading.value = false }
  }

  return { data, timeRange, loading, fetchReport }
})
