/**
 * 数据报表 Store
 * 来源：docs/03-接口文档.md § 八
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getRealTimeData, defaultReportQuery } from '@/services/report.service'
import type { RealTimeDataItem } from '@/types/models'

export const useReportStore = defineStore('report', () => {
  const data = ref<RealTimeDataItem[]>([])
  const timeRange = ref('')
  const loading = ref(false)

  async function fetchReport(fields = 'search_num,order_num,created_at'): Promise<void> {
    loading.value = true
    try {
      const res = await getRealTimeData({ ...defaultReportQuery(), fields })
      data.value = res.data
      timeRange.value = res.time_range
    } finally {
      loading.value = false
    }
  }

  return { data, timeRange, loading, fetchReport }
})
