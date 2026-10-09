export interface BillEntry {
 id:string;factId:string;revisionId:string;reasonCode:string;riskAssessment?:string;riskReview?:{decision:string;reason:string};
 priceSources?:('agreement'|'role_rate')[];keywordId:string;canAssignRetro?:boolean;retroFromDate?:string;bindingId?:string;executorName?:string;legacyMode?:string;
 metricType:'new_user'|'activation';quantity:string|null;settlementMismatch?:{expected:string;actual:string}|null;
 reportedSettlement?:string|null;
 keyword:string;date:string;orders:string|null;payerName:string;payeeName:string;payeeId:string;parentId:string|null;role:string;
 amount:string|null;confirmedAmount:string;pendingAmount:string;status:string;kind:string;ownPayable:boolean;ownReceivable:boolean;
 blocked:string;reason:string;next:string;ready:boolean;internal?:boolean;
 calculation?:{quantity:string;unitPrice:string;beforeRiskAmount:string};
 comparison?:import('@zhihu-koc/shared-components').AnalysisComparison[];
}
export function moneyValue(raw:string){const negative=raw.startsWith('-'),[whole='0',fraction='']=raw.replace(/^-/,'').split('.');return(BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0').slice(0,4)))*(negative?-1n:1n)}
export function cashText(value:bigint){const cents=((value<0n?-value:value)+50n)/100n;return(value<0n&&cents?'-':'')+String(cents/100n).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+String(cents%100n).padStart(2,'0')}
