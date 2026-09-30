import { computed, ref } from 'vue'
import type { CoreWorkspace } from '@zhihu-koc/shared-components'
import { http, useAuthStore } from './auth'
import { zhihuOperationGuide } from '@zhihu-koc/zhihu-module-views/operation-guide'
const modules = ref<CoreWorkspace['modules']['value']>([])
const projectId = ref('')
export const workspace: CoreWorkspace = {
  http,
  modules,
  projectId,
  role: computed(() => useAuthStore().user?.role ?? ''),
  operationGuide: computed(() => {
    const user = useAuthStore().user
    return user && modules.value.some(m => m.id === 'zhihu' && m.status === 'enabled')
      ? zhihuOperationGuide(user, { projectId: projectId.value }) : null
  }),
  async refreshModules() {
    modules.value = await http.get('/modules')
  },
}
