import type {AnalysisComparison} from '../../../core/analysis';
import type {FactSnapshot} from './facts';

// Compare source values as strings, including large quantities and decimal money.
// A risk-only change still shows the unchanged quantity so the decision has context.
export function reportComparison(previous:FactSnapshot|null,incoming:FactSnapshot,metricType:string):AnalysisComparison[]{
 const primary=metricType==='activation'?'activations':'orders';
 const fields=[['orders','订单量（单）'],['activations','拉活量（个）'],['search','搜索量'],['revenue','报表收益（元）'],['settlement','结算金额（元）'],['agency','代理名称'],['riskAssessment','风险标记']] as const;
 return fields.filter(([field])=>field===primary||(previous?.[field]??null)!==(incoming[field]??null)).map(([field,label])=>({label,previous:String(previous?.[field]??'未提供'),incoming:String(incoming[field]??'未提供'),changed:(previous?.[field]??null)!==(incoming[field]??null)}));
}
