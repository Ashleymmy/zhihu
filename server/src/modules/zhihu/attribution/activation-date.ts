import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { assertDuty } from '../../../core/duties';
import { businessDay, day, fail, type Scope } from './domain';
import { audit, authorize, scopeLock, select } from './store';
import { unconfirmedFactSql } from './keyword-usability';
import { assertEngineWritable } from './routing';

export async function bindingStartDay(c:PoolConnection,bindingId:string,releaseDay?:string) {
  if(releaseDay)day(releaseDay);
  const today=businessDay();
  const [row]=await select(c,`SELECT DATE_FORMAT(LEAST(COALESCE(DATE(b.assigned_at),?),
    COALESCE((SELECT MIN(DATE(co.release_time)) FROM compositions co JOIN zh_keywords k ON k.plan_id=co.plan_id
      WHERE k.id=b.keyword_id AND co.owner_id=b.executor_id),?),COALESCE(b.activated_on,?),?,?), '%Y-%m-%d') start_day
    FROM zh_keyword_bindings b WHERE b.id=? FOR SHARE`,[today,today,today,today,releaseDay??today,bindingId]);
  if(!row)fail('关键词使用记录不存在',404);
  return String(row.start_day);
}

export async function recomputeStartDateFacts(c:PoolConnection,scope:Scope,keywordId:string) {
  const facts=await select(c,`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day
    FROM zh_metric_facts f JOIN zh_attribution_results r ON r.id=f.current_result_id
    WHERE f.keyword_id=? AND f.account_id=? AND f.project_id=?
      AND r.reason_code IN ('PERIOD_AMBIGUOUS','BINDING_MISSING') AND ${unconfirmedFactSql()} ORDER BY f.id FOR UPDATE`,[keywordId,scope.accountId,scope.projectId]);
  const {attribute}=await import('./facts');
  for(const fact of facts)await attribute(c,scope,fact);
  return facts.length;
}

export async function repairActivatedOn(user:AuthUser,scope:Scope,apply=false) {
  assertDuty(user,'operations');await authorize(user,scope);
  return withTransaction(async c=>{
    await scopeLock(c,scope,user);
    if(apply)await assertEngineWritable(c,scope);
    const bindings=await select(c,`SELECT CAST(b.id AS CHAR) id,CAST(k.id AS CHAR) keyword_id,k.keyword,
      DATE_FORMAT(b.activated_on,'%Y-%m-%d') activated_on FROM zh_keyword_bindings b JOIN zh_keywords k ON k.id=b.keyword_id
      WHERE k.account_id=? AND k.project_id=? AND b.used_at IS NOT NULL AND b.released_at IS NULL AND b.executor_id IS NOT NULL
      ORDER BY b.id FOR UPDATE`,[scope.accountId,scope.projectId]);
    const changes:{bindingId:string;keyword:string;before:string|null;after:string;recalculated:number}[]=[];
    for(const b of bindings){
      const next=await bindingStartDay(c,String(b.id));
      if(b.activated_on!==null&&String(b.activated_on)<=next)continue;
      let recalculated=0;
      if(apply){
        await c.query('UPDATE zh_keyword_bindings SET activated_on=?,version=version+1 WHERE id=?',[next,b.id]);
        recalculated=await recomputeStartDateFacts(c,scope,String(b.keyword_id));
        await audit(c,user,'binding.repair-start',String(b.id),{before:b.activated_on,after:next,recalculated});
      }
      changes.push({bindingId:String(b.id),keyword:String(b.keyword),before:b.activated_on===null?null:String(b.activated_on),after:next,recalculated});
    }
    return {apply,changes};
  });
}
