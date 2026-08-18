import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { channelsApi } from "@/api/channels";
import type { Channel } from "@/types/api";

export const useZChannelStore = defineStore("zChannel", () => {
  const channels = ref<Channel[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const secondMap = ref<Record<string, never[]>>({});
  const secondLoading = ref<Record<string, boolean>>({});
  const selectedId = ref("");
  const secondChannelUnavailable = ref(true);

  const channelOptions = computed(() =>
    channels.value.map((channel) => ({
      label: channel.name,
      value: channel.zhihuChannelId,
    })),
  );

  async function fetchChannels(force = false) {
    if (loaded.value && !force) return;
    loading.value = true;
    try {
      const response = await channelsApi.list({ page: 1, pageSize: 100 });
      channels.value = response.list;
      loaded.value = true;
      if (!selectedId.value && channels.value.length)
        selectedId.value = channels.value[0].zhihuChannelId;
    } finally {
      loading.value = false;
    }
  }

  async function fetchSecondChannels(parentId: string, _force = false) {
    secondLoading.value = { ...secondLoading.value, [parentId]: false };
    secondMap.value = { ...secondMap.value, [parentId]: [] };
    secondChannelUnavailable.value = true;
    return false;
  }

  function getSecondOptions(parentId: string) {
    void parentId;
    return [] as { label: string; value: string }[];
  }

  return {
    channels,
    loading,
    loaded,
    secondMap,
    secondLoading,
    selectedId,
    secondChannelUnavailable,
    channelOptions,
    fetchChannels,
    fetchSecondChannels,
    getSecondOptions,
  };
});
