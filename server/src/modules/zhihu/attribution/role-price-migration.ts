import type {AuthUser} from '../../../types';
import {isDeepStrictEqual} from 'node:util';
import {withTransaction} from '../../../db';
import {assertDuty} from '../../../core/duties';
import {audit,authorize,json,scopeLock,select} from './store';
import {type Scope} from './domain';
import {unconfirmedFactSql} from './keyword-usability';
import {assertEngineWritable} from './routing';
import {attribute,type AttributionSnapshot} from './facts';
import {quote} from './pricing';
import {allocations} from './allocations';

export async function migrateRolePrices(user:AuthUser,scope:Scope,apply=false){
  assertDuty(user,'finance');await authorize(user,scope);
  return withTransaction(async c=>{
    await scopeLock(c,scope,user);if(apply)await assertEngineWritable(c,scope);
    const rows=await select(c,`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day,k.task_id,k.keyword,r.snapshot_json,r.reason_code
      FROM zh_metric_facts f JOIN zh_keywords k ON k.id=f.keyword_id JOIN zh_attribution_results r ON r.id=f.current_result_id
      WHERE f.project_id=? AND f.account_id=? AND f.metric_type='new_user' AND ${unconfirmedFactSql()} ORDER BY f.id FOR UPDATE`,[scope.projectId,scope.accountId]);
    const changes=[];
    for(const fact of rows){
      const original=json<AttributionSnapshot>(fact.snapshot_json);
      if(!original.binding||original.orders===null)continue;
      // Earlier matching/date blockers must be repaired first. Quoting them
      // here would promise a change that attribute() cannot yet apply.
      if(fact.reason_code&&!['PRICE_MISSING','PRICE_OVERLAP','RISK_REVIEW_REQUIRED','RISK_EXCLUDED'].includes(String(fact.reason_code)))continue;
      let proposed=original.obligations,problem:string|null=null;
      try{proposed=await quote(c,scope,String(fact.task_id),original.binding as import('./store').RecordRow,String(fact.business_day),original.orders);}
      catch(error){if(!(error instanceof Error)||!['PRICE_MISSING','PRICE_OVERLAP'].includes(error.message))throw error;problem=error.message;proposed=[];}
      if(original.riskReview?.decision==='excluded')proposed=proposed.map(line=>({...line,amount:'0.0000'}));
      if(isDeepStrictEqual(proposed,original.obligations)&&!(String(fact.reason_code??'').startsWith('PRICE_')&&fact.reason_code!==problem))continue;
      const amount=(snapshot:AttributionSnapshot)=>{try{return allocations(snapshot)}catch{return null}};
      const change={factId:String(fact.id),keyword:String(fact.keyword),date:String(fact.business_day),quantity:original.orders,before:amount(original),after:problem?null:amount({...original,obligations:proposed}),problem};
      if(apply)await attribute(c,scope,fact);
      changes.push(change);
    }
    if(apply&&changes.length)await audit(c,user,'price.migrate-role',scope.projectId,{changes});
    return {apply,records:changes.length,changes};
  });
}
