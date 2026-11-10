import type {AnalysisRunModel} from '@zhihu-koc/shared-components'
export type NameSelection={channelId:string}|{mappingId:string}|{keywordId:string}|{upstreamId:string;generation:1|2}|{taskId:string;executorId:string;fromDate?:string}
export interface ReportAnswer{askId:string;option:string;selection?:NameSelection}
export interface NameMatch{askId:string;kind:'channel'|'keyword';date:string;channel:string;keyword:string;mappingId:string|null;candidates:{id:string;name:string}[]}
export interface RiskCase{factId:string;revisionId:string;keyword:string;riskAssessment:string}
export interface ReportTotals {
 reportedQuantity:string
 reportedSettlement:string|null
 staffAmount:string
 billableQuantity:string
 billableAmount:string
 confirmableAmount:string
 /** Only unpriced units; already priced records may still need work or other evidence. */
 pendingQuantity:string
 excludedQuantity:string
}
export type ReportRun=AnalysisRunModel&{totals?:ReportTotals;nameMatches?:NameMatch[];riskCases?:RiskCase[];agencyCheck?:{registeredName:string|null;rows:number;reportedNames:string[]}}

/** Preserve the server's record count and quantities while clarifying its unpriced subset. */
export function reportAnalysisForDisplay(run:ReportRun):ReportRun {
 const text=run.conclusion?.pendingText,quantity=run.totals?.pendingQuantity
 if(run.status!=='needs_input'||!text||!quantity||!/^\d+$/.test(quantity)||!/[1-9]/.test(quantity))return run
 const pendingText=text.replace(/，涉及 (\d+) (单|个)，/,(matched,units:string,unit:string)=>
  units===quantity?`；其中 ${units} ${unit}尚未计价；已计价的待处理记录仍需补齐资料。`:matched)
 return pendingText===text?run:{...run,conclusion:{...run.conclusion!,pendingText}}
}
