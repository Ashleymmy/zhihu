import type { PoolConnection } from 'mysql2/promise';
import { rateRuleFor } from '../../../core/rates';
import { count, fail, money, moneyText, type Scope } from './domain';
import type { RecordRow } from './store';
import type { Obligation } from './pricing';

export async function quoteActivation(c: PoolConnection, scope: Scope, binding: RecordRow, date: string, quantity: string, settlement: string | null) {
  const units=count(quantity);
  const paths: [string,string][]=[];
  if(binding.path_type==='leader_self')paths.push(['leader_self',String(binding.leader_id)]);
  else if(binding.path_type==='team_creator')paths.push(['creator',String(binding.executor_id)],['leader_override',String(binding.leader_id)]);
  else if(binding.path_type==='direct_creator')paths.push(['creator',String(binding.executor_id)]);
  else if(binding.path_type==='staff_self')paths.push(['staff_self',String(binding.executor_id)]);
  if(!paths.length)fail('执行人尚未分配',409);
  const obligations:Obligation[]=[];
  const rate=async(ruleCode:string)=>{
    try {
      const rule=await rateRuleFor(c,{projectId:scope.projectId,moduleId:'zhihu',metricType:'activation',ruleCode,date});
      if(!rule)fail('PRICE_MISSING',409);
      return rule;
    } catch(error) {
      if(error instanceof Error&&error.message==='RATE_OVERLAP')fail('PRICE_OVERLAP',409);
      throw error;
    }
  };
  for(const [ruleCode,payeeId] of paths){
    const rule=await rate(ruleCode);
    obligations.push({relation:'activation:'+ruleCode,payerKind:'agency',payerId:'1',payeeId,versionId:rule.id,unitPrice:rule.unitPrice,amount:moneyText(units*money(rule.unitPrice)),priceSource:'role_rate'});
  }
  const upstream=await rate('upstream'),expected=moneyText(units*money(upstream.unitPrice));
  return {obligations,settlementMismatch:settlement!==null&&money(settlement)!==money(expected)?{expected,actual:settlement}:null};
}
