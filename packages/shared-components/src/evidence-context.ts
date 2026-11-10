import type { EvidenceQuery } from '@zhihu-koc/shared-contracts/core'

export interface EvidenceContext {
 scope:Pick<EvidenceQuery,'projectId'|'accountId'|'moduleId'>
 taskRef?:string
 from?:string
 to?:string
}
/** Separate scalar sources keep equivalent scope objects from acting like navigation. */
export function evidenceContextSources(context:EvidenceContext) {
 return [()=>context.scope.projectId,()=>context.scope.accountId,()=>context.scope.moduleId,()=>context.taskRef,()=>context.from,()=>context.to]
}
export function evidenceFilterSources(filter:{from:string;to:string;metricType:string}) {
 return [()=>filter.from,()=>filter.to,()=>filter.metricType]
}
