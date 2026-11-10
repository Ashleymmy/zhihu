import { computed, ref } from 'vue'
import { createEvidenceApi, createSettlementApi, createEvidenceCommentApi } from '@zhihu-koc/shared-services/core'
import type { CoreWorkspace } from '@zhihu-koc/shared-components'
import { http, useAuthStore } from './auth'
import { zhihuOperationGuide } from '@zhihu-koc/zhihu-module-views/operation-guide'
const modules = ref<CoreWorkspace['modules']['value']>([])
const projectId = ref('')
export const workspace: CoreWorkspace = {
  http,
  evidenceApi: createEvidenceApi(http),
  settlementApi: createSettlementApi(http),
  evidenceComments: key => createEvidenceCommentApi(http, key),
  modules,
  projectId,
  role: computed(() => useAuthStore().user?.role ?? ''),
  userName: computed(() => useAuthStore().user?.displayName ?? ''),
  duty: computed(() => useAuthStore().user?.adminDuty ?? ''),
  operationGuide: computed(() => {
    const user = useAuthStore().user
    // 开发者面向系统与队列，不展示业务操作引导
    if (user?.role === 'developer') return null
    return user && modules.value.some(m => m.id === 'zhihu' && m.status === 'enabled')
      ? zhihuOperationGuide(user, { projectId: projectId.value }) : null
  }),
  async refreshModules() {
    modules.value = await http.get('/modules')
  },
}
