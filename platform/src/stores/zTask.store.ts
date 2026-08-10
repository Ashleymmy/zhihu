import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { tasksApi } from '@/api/tasks'
import type { PopularizeTask } from '@/api/alliance'
import type { Task } from '@/types/api'

function rawString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function toPopularizeTask(task: Task): PopularizeTask {
  const raw = task.rawJson ?? {}
  return {
    id: task.zhihuTaskId,
    task_name: rawString(raw, 'taskName') ?? task.name,
    product_name: rawString(raw, 'productName') ?? task.name,
    status: task.status ?? '',
    pay_caliber: rawString(raw, 'payCaliber') ?? task.settleType ?? '',
    expiry_time: rawString(raw, 'expiryTime') ?? task.endTime ?? '',
    media_platform: rawString(raw, 'mediaPlatform'),
    attribution: rawString(raw, 'attribution'),
    limit: rawString(raw, 'limit'),
  }
}

export const useZTaskStore = defineStore('zTask', () => {
  const tasks   = ref<PopularizeTask[]>([])
  const loading = ref(false)
  const total   = ref(0)
  const offset  = ref(0)
  const limit   = ref(20)

  const activeTasks  = computed(() => tasks.value.filter(t => ['active', '开启'].includes(t.status)))
  const taskOptions  = computed(() => tasks.value.map(t => ({ label: t.task_name, value: t.id })))

  async function fetchTasks(_channelId = '', page = 0) {
    loading.value = true
    offset.value = page * limit.value
    try {
      const res = await tasksApi.list({ page: page + 1, pageSize: limit.value })
      tasks.value = res.list.map(toPopularizeTask)
      total.value = res.total
    } finally { loading.value = false }
  }

  function reset() { tasks.value = []; total.value = 0; offset.value = 0 }

  return { tasks, loading, total, offset, limit, activeTasks, taskOptions, fetchTasks, reset }
})
