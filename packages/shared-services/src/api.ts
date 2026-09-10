import {createCoreApis} from './core-api'
import {createZhihuApis} from './zhihu'
import type {HttpClient} from './http'
export * from './core-api'
export * from './zhihu'
export function createApis(http:HttpClient){return {...createCoreApis(http),...createZhihuApis(http)}}
export type ApiBundle=ReturnType<typeof createApis>
