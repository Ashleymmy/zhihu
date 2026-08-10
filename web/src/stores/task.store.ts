/**
 * 推广任务 Store（PopularizeTask）
 * 来源：docs/03-接口文档.md § 七
 *
 * 负责管理推广任务列表（task_id 的来源）。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getPopularizeTasks } from '@/services/task.service'
import type { PopularizeTask } from '@/types/models'

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<PopularizeTask[]>([])
  const loading = ref(false)
  const total = ref(0)
  const offset = ref(0)
  const limit = ref(20)

  /** 仅显示「开启」状态的任务（用于创建计划时的选择器） */
  const activeTasks = computed(() =>
    tasks.value.filter(t => t.status === '开启'),
  )

  const taskOptions = computed(() =>
    activeTasks.value.map(t => ({
      label: `${t.task_name}（${t.product_name}）`,
      value: t.id,
    })),
  )

  async function fetchTasks(channelId: string, page = 0): Promise<void> {
    loading.value = true
    try {
      const res = await getPopularizeTasks({
        channel_id: channelId,
        offset: page * limit.value,
        limit: limit.value,
      })
      tasks.value = res.data ?? []
      total.value = res.pagination.total
      offset.value = res.pagination.offset
    } finally {
      loading.value = false
    }
  }

  function reset() {
    tasks.value = []
    total.value = 0
    offset.value = 0
  }

  return { tasks, loading, total, offset, limit, activeTasks, taskOptions, fetchTasks, reset }
})
