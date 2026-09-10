import { computed, ref } from 'vue'
import type { CoreWorkspace } from '@zhihu-koc/shared-components'
import { http, useAuthStore } from './auth'
const modules = ref<CoreWorkspace['modules']['value']>([])
const projectId = ref('')
export const workspace: CoreWorkspace = {
  http,
  modules,
  projectId,
  role: computed(() => useAuthStore().user?.role ?? ''),
  async refreshModules() {
    modules.value = await http.get('/modules')
  },
}
