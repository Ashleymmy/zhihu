import { http } from './http'
import type {
  Composition,
  CompositionListReq,
  CompositionListResp,
  CreateCompositionReq,
  UpdateCompositionReq,
} from '@/types/api'

export const compositionsApi = {
  list: (params?: CompositionListReq) =>
    http.get<CompositionListResp>('/compositions', params as Record<string, unknown>),

  get: (id: string) =>
    http.get<Composition>(`/compositions/${id}`),

  create: (data: CreateCompositionReq) =>
    http.post<Composition>('/compositions', data),

  update: (id: string, data: UpdateCompositionReq) =>
    http.patch<Composition>(`/compositions/${id}`, data),
}
