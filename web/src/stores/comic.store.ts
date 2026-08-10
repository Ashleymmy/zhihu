/**
 * 漫剧 Store
 * 来源：docs/03-接口文档.md § 十二
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getComicDramas, getComicEpisodes } from '@/services/comic.service'
import type { ComicDrama, ComicEpisode, Pagination } from '@/types/models'

export const useComicStore = defineStore('comic', () => {
  // ─── 剧目列表 ──────────────────────────────────────────────────────────────
  const dramas = ref<ComicDrama[]>([])
  const dramasLoading = ref(false)
  const dramasPagination = ref<Pagination>({ total: 0, offset: 0, limit: 10 })
  const searchTitle = ref('')

  async function fetchDramas(page = 1): Promise<void> {
    dramasLoading.value = true
    try {
      const res = await getComicDramas({
        title: searchTitle.value || undefined,
        offset: (page - 1) * dramasPagination.value.limit,
        limit: dramasPagination.value.limit,
      })
      dramas.value = res.data
      dramasPagination.value = res.pagination
    } finally {
      dramasLoading.value = false
    }
  }

  // ─── 剧集列表 ──────────────────────────────────────────────────────────────
  const episodes = ref<ComicEpisode[]>([])
  const episodesLoading = ref(false)
  const episodesPagination = ref<Pagination>({ total: 0, offset: 0, limit: 10 })
  const selectedDrama = ref<ComicDrama | null>(null)

  async function fetchEpisodes(drama: ComicDrama, page = 1): Promise<void> {
    selectedDrama.value = drama
    episodesLoading.value = true
    try {
      const res = await getComicEpisodes(drama.drama_id, {
        offset: (page - 1) * episodesPagination.value.limit,
        limit: episodesPagination.value.limit,
      })
      episodes.value = res.data
      episodesPagination.value = res.pagination
    } finally {
      episodesLoading.value = false
    }
  }

  return {
    dramas, dramasLoading, dramasPagination, searchTitle, fetchDramas,
    episodes, episodesLoading, episodesPagination, selectedDrama, fetchEpisodes,
  }
})
