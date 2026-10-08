import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { assertDuty } from '../../../core/duties';
import type { Scope } from './domain';
import { audit, authorize, scopeLock, select } from './store';
import { unconfirmedFactSql } from './keyword-usability';
import { assertEngineWritable } from './routing';
import { attribute } from './facts';

export async function repairMissingPrices(user:AuthUser,scope:Scope,apply=false){
  assertDuty(user,'finance');await authorize(user,scope);
  return withTransaction(async c=>{
    await scopeLock(c,scope,user);
    if(apply)await assertEngineWritable(c,scope);
    const facts=await select(c,`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day,k.keyword,r.reason_code
      FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id JOIN zh_attribution_results r ON r.id=f.current_result_id
      WHERE f.account_id=? AND f.project_id=? AND f.metric_type='new_user' AND r.reason_code IN ('PRICE_MISSING','PRICE_OVERLAP')
        AND ${unconfirmedFactSql()} ORDER BY f.id FOR UPDATE`,[scope.accountId,scope.projectId]);
    const changes:{factId:string;keyword:string;before:string;after:string|null}[]=[];
    for(const fact of facts){
      if(apply)await attribute(c,scope,fact);
      const [current]=apply?await select(c,'SELECT r.reason_code FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id WHERE f.id=?',[fact.id]):[];
      changes.push({factId:String(fact.id),keyword:String(fact.keyword),before:String(fact.reason_code),after:apply?current.reason_code:null});
    }
    if(apply&&changes.length)await audit(c,user,'price.repair-missing',scope.projectId,{changes});
    return {apply,changes};
  });
}
