/**
 * 盐选内容榜单 Store
 * 来源：docs/03-接口文档.md § 九
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  getRankingLabels,
  getRankingContents,
  getRankingContentDetail,
  getOnlineSections,
} from '@/services/ranking.service'
import type {
  RankingLabel,
  RankingContent,
  RankingContentDetail,
  NewContent,
  Pagination,
} from '@/types/models'

export const useRankingStore = defineStore('ranking', () => {
  // ─── § 9.1 榜单列表 ────────────────────────────────────────────────────────
  const labels = ref<RankingLabel[]>([])
  const labelsLoading = ref(false)
  const labelsLoaded = ref(false)

  async function fetchLabels(force = false): Promise<void> {
    if (labelsLoaded.value && !force) return
    labelsLoading.value = true
    try {
      labels.value = await getRankingLabels()
      labelsLoaded.value = true
    } finally {
      labelsLoading.value = false
    }
  }

  // ─── § 9.2 榜单内容列表 ────────────────────────────────────────────────────
  const contents = ref<RankingContent[]>([])
  const contentsLoading = ref(false)
  const contentsPagination = ref<Pagination>({ total: 0, offset: 0, limit: 20 })
  const currentRuleId = ref('')
  const currentRuleType = ref(1) // 1 常规 2 推荐

  async function fetchContents(ruleId: string, page = 1, ruleType = 1): Promise<void> {
    currentRuleId.value = ruleId
    currentRuleType.value = ruleType
    contentsLoading.value = true
    try {
      const res = await getRankingContents({
        rule_id: ruleId,
        offset: (page - 1) * contentsPagination.value.limit,
        limit: contentsPagination.value.limit,
      })
      contents.value = res.data
      contentsPagination.value = res.pagination
    } finally {
      contentsLoading.value = false
    }
  }

  // ─── § 9.3 内容详情 ────────────────────────────────────────────────────────
  const detail = ref<RankingContentDetail | null>(null)
  const detailLoading = ref(false)

  async function fetchDetail(contentId: string): Promise<void> {
    detailLoading.value = true
    try {
      detail.value = await getRankingContentDetail(contentId, currentRuleType.value)
    } finally {
      detailLoading.value = false
    }
  }

  // ─── § 9.4 上新内容 ────────────────────────────────────────────────────────
  const newContents = ref<NewContent[]>([])
  const newContentsLoading = ref(false)

  async function fetchNewContents(): Promise<void> {
    newContentsLoading.value = true
    try {
      newContents.value = await getOnlineSections()
    } finally {
      newContentsLoading.value = false
    }
  }

  return {
    labels, labelsLoading, labelsLoaded, fetchLabels,
    contents, contentsLoading, contentsPagination, currentRuleId, currentRuleType,
    fetchContents,
    detail, detailLoading, fetchDetail,
    newContents, newContentsLoading, fetchNewContents,
  }
})
