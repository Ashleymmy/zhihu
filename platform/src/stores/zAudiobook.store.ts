import { defineStore } from 'pinia'
import { ref } from 'vue'
import { allianceAudiobookApi } from '@/api/alliance'
import type { AudioBook } from '@/api/alliance'

export const useZAudiobookStore = defineStore('zAudiobook', () => {
  const items       = ref<AudioBook[]>([])
  const loading     = ref(false)
  const total       = ref(0)
  const page        = ref(1)
  const playUrl     = ref('')
  const playingId   = ref('')
  const urlLoading  = ref(false)

  async function fetchList(p = 1) {
    loading.value = true; page.value = p
    try {
      const res = await allianceAudiobookApi.getList(p)
      items.value = res.data; total.value = res.pagination?.total ?? res.data.length
    } finally { loading.value = false }
  }

  async function fetchPlayUrl(section_id: string) {
    urlLoading.value = true; playingId.value = section_id; playUrl.value = ''
    try {
      const res = await allianceAudiobookApi.getPlayUrl(section_id)
      playUrl.value = res.url
    } finally { urlLoading.value = false }
  }

  return { items, loading, total, page, playUrl, playingId, urlLoading, fetchList, fetchPlayUrl }
})
