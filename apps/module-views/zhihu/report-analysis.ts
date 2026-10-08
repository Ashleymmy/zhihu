import type {AnalysisRunModel} from '@zhihu-koc/shared-components'
export type NameSelection={channelId:string}|{mappingId:string}|{keywordId:string}|{upstreamId:string;generation:1|2}|{taskId:string;executorId:string;fromDate?:string}
export interface ReportAnswer{askId:string;option:string;selection?:NameSelection}
export interface NameMatch{askId:string;kind:'channel'|'keyword';date:string;channel:string;keyword:string;mappingId:string|null;candidates:{id:string;name:string}[]}
export interface RiskCase{factId:string;revisionId:string;keyword:string;riskAssessment:string}
export type ReportRun=AnalysisRunModel&{nameMatches?:NameMatch[];riskCases?:RiskCase[]}
