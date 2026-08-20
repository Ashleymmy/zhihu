/**
 * 渠道 Store
 * 来源：docs/03-接口文档.md § 五
 *
 * 渠道数据变化频率极低，Store 内做缓存，避免重复消耗日配额。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getAgentChannels, getSecondChannels } from '@/services/channel.service'
import type { AgentChannel, SecondChannel } from '@/types/models'

export const useChannelStore = defineStore('channel', () => {
  // ─── 一代渠道 ────────────────────────────────────────────────────────────────
  const channels = ref<AgentChannel[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  const channelOptions = computed(() =>
    channels.value.map(c => ({ label: c.channel_name, value: c.channel_id })),
  )

  /** 获取一代渠道列表（有缓存则跳过，force=true 强制刷新） */
  async function fetchChannels(force = false): Promise<void> {
    if (loaded.value && !force) return
    loading.value = true
    try {
      channels.value = await getAgentChannels()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  // ─── 二代渠道（按一代 channel_id 懒加载）────────────────────────────────────
  const secondChannelsMap = ref<Record<string, SecondChannel[]>>({})
  const secondLoading = ref<Record<string, boolean>>({})

  /** 获取指定一代渠道的二代渠道列表 */
  async function fetchSecondChannels(parentChannelId: string, force = false): Promise<void> {
    if (secondChannelsMap.value[parentChannelId] && !force) return
    secondLoading.value[parentChannelId] = true
    try {
      const res = await getSecondChannels({ channel_id: parentChannelId, limit: 100 })
      secondChannelsMap.value[parentChannelId] = res.data
    } finally {
      secondLoading.value[parentChannelId] = false
    }
  }

  function getSecondOptions(parentChannelId: string) {
    return (secondChannelsMap.value[parentChannelId] ?? []).map(c => ({
      label: c.channel_name,
      value: c.channel_id,
    }))
  }

  // ─── 当前全局选中的渠道（供跨组件共享）──────────────────────────────────────
  const selectedChannelId = ref<string>('')

  return {
    channels,
    loading,
    loaded,
    channelOptions,
    fetchChannels,
    secondChannelsMap,
    secondLoading,
    fetchSecondChannels,
    getSecondOptions,
    selectedChannelId,
  }
})
