import { defineStore } from 'pinia'
import { ref } from 'vue'
import { allianceComicApi } from '@/api/alliance'
import type { ComicDrama, ComicEpisode } from '@/api/alliance'

export const useZComicStore = defineStore('zComic', () => {
  const dramas         = ref<ComicDrama[]>([])
  const dramasLoading  = ref(false)
  const dramasTotal    = ref(0)
  const dramasPage     = ref(1)
  const searchTitle    = ref('')
  const episodes       = ref<ComicEpisode[]>([])
  const episodesLoading = ref(false)
  const episodesTotal  = ref(0)
  const episodesPage   = ref(1)
  const selectedDrama  = ref<ComicDrama | null>(null)

  async function fetchDramas(page = 1) {
    dramasLoading.value = true; dramasPage.value = page
    try {
      const res = await allianceComicApi.getDramas({ title: searchTitle.value || undefined, page })
      dramas.value = res.data; dramasTotal.value = res.pagination?.total ?? res.data.length
    } finally { dramasLoading.value = false }
  }

  async function fetchEpisodes(drama: ComicDrama, page = 1) {
    selectedDrama.value = drama; episodesLoading.value = true; episodesPage.value = page
    try {
      const res = await allianceComicApi.getEpisodes(drama.id, page)
      episodes.value = res.data; episodesTotal.value = res.pagination?.total ?? res.data.length
    } finally { episodesLoading.value = false }
  }

  return { dramas, dramasLoading, dramasTotal, dramasPage, searchTitle, episodes, episodesLoading, episodesTotal, episodesPage, selectedDrama, fetchDramas, fetchEpisodes }
})
