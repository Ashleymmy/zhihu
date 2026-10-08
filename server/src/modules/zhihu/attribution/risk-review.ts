import type {AuthUser} from '../../../types';
import {assertDuty} from '../../../core/duties';
import {fail,type Scope} from './domain';
import {audit,insert,json,mutate,select} from './store';
import {attribute,type FactSnapshot} from './facts';

export async function reviewRisk(user:AuthUser,scope:Scope,factId:string,key:string,input:{expectedRevisionId:string;decision:'accepted'|'excluded';reason:string}){
 assertDuty(user,'operations');
 if(!input.reason.trim())fail('请填写一句核实说明');
 return mutate(user,scope,'report.risk-review',key,{factId,...input},async c=>{
   const [fact]=await select(c,"SELECT *,DATE_FORMAT(business_date,'%Y-%m-%d') business_day FROM zh_metric_facts WHERE id=? AND account_id=? AND project_id=? FOR UPDATE",[factId,scope.accountId,scope.projectId]);
   if(!fact)fail('这条记录不存在或不属于当前项目',404);
   if(String(fact.current_revision_id)!==input.expectedRevisionId)fail('报表数字已变化，请重新核对风险内容',409);
   const [revision]=await select(c,'SELECT snapshot_json FROM zh_metric_revisions WHERE id=?',[fact.current_revision_id]);
   if(!revision||!json<FactSnapshot>(revision.snapshot_json).riskAssessment)fail('当前报表没有需要核实的风险标记',409);
   if((await select(c,'SELECT id FROM zh_risk_reviews WHERE fact_id=? AND revision_id=?',[factId,fact.current_revision_id])).length)fail('这条风险已核实，请刷新查看处理结果',409);
   const id=await insert(c,'INSERT INTO zh_risk_reviews(fact_id,revision_id,decision,reason,reviewed_by) VALUES(?,?,?,?,?)',[factId,fact.current_revision_id,input.decision,input.reason.trim(),user.sub]);
   // An explicit risk decision may append a financial correction. Confirmed
   // entries remain immutable; only finance can confirm the resulting delta.
   await attribute(c,scope,fact);
   await audit(c,user,'report.risk-review',id,{factId,revisionId:input.expectedRevisionId,decision:input.decision,reason:input.reason.trim()});
   return {id,factId,decision:input.decision};
 });
}
