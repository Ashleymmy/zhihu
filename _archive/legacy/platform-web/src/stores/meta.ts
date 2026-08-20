import { defineStore } from 'pinia'
import { metaApi } from '@/api/meta'
import type { EnumsResp, EnumItem } from '@/types/api'

export const useMetaStore = defineStore('meta', {
  state: () => ({
    enums: null as EnumsResp | null,
    loaded: false,
  }),

  getters: {
    planStatusOptions: (s): EnumItem[] => s.enums?.planStatus ?? [],
    compositionTypeOptions: (s): EnumItem[] => s.enums?.compositionType ?? [],
    mediaTypeOptions: (s): EnumItem[] => s.enums?.mediaType ?? [],
  },

  actions: {
    async loadEnums() {
      if (this.loaded) return
      try {
        this.enums = await metaApi.enums()
        this.loaded = true
      } catch {
        // Non-fatal — views will fall back to hard-coded labels
      }
    },
  },
})
