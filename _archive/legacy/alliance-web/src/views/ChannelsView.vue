<template>
  <div class="channels-view">
    <div class="page-header">
      <h2>代理渠道</h2>
      <el-button :loading="channelStore.loading" @click="channelStore.fetchChannels(true)">
        刷新
      </el-button>
    </div>

    <el-row :gutter="16">
      <el-col :span="10">
        <el-card header="一代渠道" shadow="never">
          <el-skeleton :loading="channelStore.loading" animated>
            <el-table
              :data="channelStore.channels"
              highlight-current-row
              @current-change="handleChannelSelect"
              height="500"
              empty-text="暂无数据"
            >
              <el-table-column prop="channel_id" label="渠道 ID" width="200" show-overflow-tooltip />
              <el-table-column prop="channel_name" label="渠道名称" />
            </el-table>
          </el-skeleton>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <span>二代渠道</span>
            <span v-if="selectedChannel" class="sub-title">
              — {{ selectedChannel.channel_name }}
            </span>
          </template>
          <el-empty v-if="!selectedChannel" description="请先选择左侧一代渠道" :image-size="80" />
          <template v-else>
            <el-skeleton :loading="secondLoading" animated>
              <el-table
                :data="secondChannels"
                height="500"
                empty-text="该渠道暂无二代渠道"
              >
                <el-table-column prop="channel_id" label="二代渠道 ID" show-overflow-tooltip />
                <el-table-column prop="channel_name" label="二代渠道名称" />
              </el-table>
            </el-skeleton>
          </template>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useChannelStore } from '@/stores/channel.store'
import type { AgentChannel } from '@/types/models'

const channelStore = useChannelStore()

const selectedChannel = ref<AgentChannel | null>(null)
const secondLoading = computed(
  () => selectedChannel.value
    ? (channelStore.secondLoading[selectedChannel.value.channel_id] ?? false)
    : false,
)
const secondChannels = computed(
  () => selectedChannel.value
    ? (channelStore.secondChannelsMap[selectedChannel.value.channel_id] ?? [])
    : [],
)

async function handleChannelSelect(row: AgentChannel | null) {
  selectedChannel.value = row
  if (row) await channelStore.fetchSecondChannels(row.channel_id)
}

onMounted(() => channelStore.fetchChannels())
</script>

<style scoped>
.channels-view { padding: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
.sub-title { color: #909399; font-size: 14px; margin-left: 4px; }
</style>
