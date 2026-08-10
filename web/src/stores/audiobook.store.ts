/**
 * 有声书 Store
 * 来源：docs/03-接口文档.md § 十
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAudioBooks, getAudioDownloadUrl } from '@/services/audiobook.service'
import { ElMessage } from 'element-plus'
import type { AudioBook, Pagination } from '@/types/models'

export const useAudiobookStore = defineStore('audiobook', () => {
  const items = ref<AudioBook[]>([])
  const loading = ref(false)
  const pagination = ref<Pagination>({ total: 0, offset: 0, limit: 10 })

  async function fetchList(page = 1): Promise<void> {
    loading.value = true
    try {
      const res = await getAudioBooks({
        offset: (page - 1) * pagination.value.limit,
      })
      items.value = res.data
      pagination.value = res.pagination
    } finally {
      loading.value = false
    }
  }

  // ─── 音频地址（有时效，不缓存）────────────────────────────────────────────
  const playingUrl = ref('')
  const playingSectionId = ref('')
  const urlLoading = ref(false)

  async function fetchPlayUrl(sectionId: string): Promise<string> {
    urlLoading.value = true
    playingSectionId.value = sectionId
    playingUrl.value = ''
    try {
      const res = await getAudioDownloadUrl(sectionId)
      playingUrl.value = res.url
      return res.url
    } catch {
      ElMessage.error('获取音频地址失败')
      return ''
    } finally {
      urlLoading.value = false
    }
  }

  return { items, loading, pagination, fetchList, playingUrl, playingSectionId, urlLoading, fetchPlayUrl }
})
