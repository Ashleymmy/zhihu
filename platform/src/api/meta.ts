import { http } from './http'
import type { EnumsResp } from '@/types/api'

export const metaApi = {
  enums: () =>
    http.get<EnumsResp>('/meta/enums'),
}
