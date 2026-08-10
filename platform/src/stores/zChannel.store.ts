// 知乎联盟渠道 store — 一代 + 二代渠道，带缓存
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { allianceChannelApi } from '@/api/alliance'
import type { AgentChannel, SecondChannel } from '@/api/alliance'

export const useZChannelStore = defineStore('zChannel', () => {
  const channels       = ref<AgentChannel[]>([])
  const loading        = ref(false)
  const loaded         = ref(false)
  const secondMap      = ref<Record<string, SecondChannel[]>>({})
  const secondLoading  = ref<Record<string, boolean>>({})
  const selectedId     = ref('')

  const channelOptions = computed(() => channels.value.map(c => ({ label: c.channel_name, value: c.channel_id })))

  async function fetchChannels(force = false) {
    if (loaded.value && !force) return
    loading.value = true
    try {
      channels.value = await allianceChannelApi.getAgentChannels()
      loaded.value = true
      if (!selectedId.value && channels.value.length) selectedId.value = channels.value[0].channel_id
    } finally { loading.value = false }
  }

  async function fetchSecondChannels(parentId: string, force = false) {
    if (secondMap.value[parentId] && !force) return
    secondLoading.value = { ...secondLoading.value, [parentId]: true }
    try {
      const res = await allianceChannelApi.getSecondChannels(parentId)
      secondMap.value = { ...secondMap.value, [parentId]: res.data }
    } finally {
      secondLoading.value = { ...secondLoading.value, [parentId]: false }
    }
  }

  function getSecondOptions(parentId: string) {
    return (secondMap.value[parentId] ?? []).map(c => ({ label: c.channel_name, value: c.channel_id }))
  }

  return { channels, loading, loaded, secondMap, secondLoading, selectedId, channelOptions, fetchChannels, fetchSecondChannels, getSecondOptions }
})
