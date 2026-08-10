<template>
  <div class="tasks-view">
    <div class="page-header">
      <h2>推广任务</h2>
      <el-select
        v-model="channelStore.selectedChannelId"
        placeholder="选择渠道"
        style="width: 240px"
        @change="onChannelChange"
      >
        <el-option
          v-for="opt in channelStore.channelOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
    </div>

    <el-alert
      v-if="!channelStore.selectedChannelId"
      title="请先在顶部选择渠道，才能加载推广任务列表"
      type="info"
      show-icon
      :closable="false"
      style="margin-bottom: 16px"
    />

    <el-card v-else shadow="never">
      <el-table
        v-loading="taskStore.loading"
        :data="taskStore.tasks"
        height="500"
        empty-text="暂无推广任务"
      >
        <el-table-column prop="task_name" label="任务名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="product_name" label="产品" width="100" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="expiry_time" label="有效期" min-width="160" show-overflow-tooltip />
        <el-table-column prop="pay_caliber" label="结算口径" min-width="120" show-overflow-tooltip />
        <el-table-column label="任务 ID" min-width="200">
          <template #default="{ row }">
            <span class="id-text">{{ row.id }}</span>
            <el-button link size="small" @click="copyId(row.id)">复制</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-bar">
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="taskStore.limit"
          :total="taskStore.total"
          layout="total, prev, pager, next"
          @current-change="loadPage"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useChannelStore } from '@/stores/channel.store'
import { useTaskStore } from '@/stores/task.store'

const channelStore = useChannelStore()
const taskStore = useTaskStore()
const currentPage = ref(1)

function statusTagType(status: string) {
  if (status === '开启') return 'success'
  if (status === '暂停') return 'warning'
  return 'danger'
}

async function onChannelChange(channelId: string) {
  currentPage.value = 1
  taskStore.reset()
  if (channelId) await taskStore.fetchTasks(channelId)
}

async function loadPage(page: number) {
  if (!channelStore.selectedChannelId) return
  await taskStore.fetchTasks(channelStore.selectedChannelId, page - 1)
}

async function copyId(id: string) {
  await navigator.clipboard.writeText(id)
  ElMessage.success('已复制 Task ID')
}

onMounted(async () => {
  await channelStore.fetchChannels()
  if (channelStore.selectedChannelId) {
    await taskStore.fetchTasks(channelStore.selectedChannelId)
  }
})
</script>

<style scoped>
.tasks-view { padding: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.pagination-bar { display: flex; justify-content: flex-end; margin-top: 16px; }
.id-text { font-size: 12px; color: #606266; font-family: monospace; }
</style>
