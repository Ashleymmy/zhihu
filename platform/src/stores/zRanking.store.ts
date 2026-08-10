import { defineStore } from 'pinia'
import { ref } from 'vue'
import { allianceRankingApi } from '@/api/alliance'
import type { RankingLabel, RankingContent, RankingContentDetail, NewContent } from '@/api/alliance'

export const useZRankingStore = defineStore('zRanking', () => {
  const labels          = ref<RankingLabel[]>([])
  const labelsLoaded    = ref(false)
  const labelsLoading   = ref(false)
  const contents        = ref<RankingContent[]>([])
  const contentsLoading = ref(false)
  const contentsTotal   = ref(0)
  const contentsPage    = ref(1)
  const currentRuleId   = ref('')
  const currentRuleType = ref(1)
  const detail          = ref<RankingContentDetail | null>(null)
  const detailLoading   = ref(false)
  const newContents     = ref<NewContent[]>([])
  const newLoading      = ref(false)

  async function fetchLabels(force = false) {
    if (labelsLoaded.value && !force) return
    labelsLoading.value = true
    try {
      labels.value = await allianceRankingApi.getLabels()
      labelsLoaded.value = true
    } finally { labelsLoading.value = false }
  }

  async function fetchContents(rule_id: string, page = 1, ruleType = 1) {
    contentsLoading.value = true
    currentRuleId.value = rule_id; currentRuleType.value = ruleType; contentsPage.value = page
    try {
      const res = await allianceRankingApi.getContents(rule_id, page)
      contents.value    = res.data
      contentsTotal.value = res.pagination?.total ?? res.data.length
    } finally { contentsLoading.value = false }
  }

  async function fetchDetail(content_id: string) {
    detailLoading.value = true; detail.value = null
    try { detail.value = await allianceRankingApi.getDetail(content_id) }
    finally { detailLoading.value = false }
  }

  async function fetchNewContents() {
    newLoading.value = true
    try { newContents.value = await allianceRankingApi.getNewContents() }
    finally { newLoading.value = false }
  }

  return { labels, labelsLoaded, labelsLoading, contents, contentsLoading, contentsTotal, contentsPage, currentRuleId, currentRuleType, detail, detailLoading, newContents, newLoading, fetchLabels, fetchContents, fetchDetail, fetchNewContents }
})
