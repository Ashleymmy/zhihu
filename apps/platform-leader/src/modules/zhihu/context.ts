import { createZhihuApis } from '@zhihu-koc/shared-services/zhihu'
import { createHttpClient } from '@zhihu-koc/shared-services/core'
import { apis as coreApis, http as coreHttp } from '../../stores/auth'
export { useAuthStore } from '../../stores/auth'
export const http = createHttpClient({
  baseURL: '/api/v1/modules/zhihu',
  tokenStore: coreHttp.tokens,
  refreshBaseURL: '/api/v1/core',
})
export const apis = { ...coreApis, ...createZhihuApis(http) }
