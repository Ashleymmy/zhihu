import type {PoolConnection} from 'mysql2/promise';
import type {AuthUser} from '../../../types';
import {assertDuty} from '../../../core/duties';
import {isStaffRole} from '../../../auth/roles';
import {audit,insert,select} from './store';
import {businessDay,day,fail,keywordText,type Scope} from './domain';
import {lockKeywordSpace} from './resources';
import {assignRetroInTransaction} from './retro-assignment';
import {normalizedName} from './matching';
import {resolveExecutor} from './executor';

export interface HistoricalSelection {taskId:string;executorId:string;fromDate?:string}
export async function registerHistoricalKeyword(c:PoolConnection,user:AuthUser,scope:Scope,mappingId:string,source:{keyword:string;date:string},input:HistoricalSelection){
 assertDuty(user,'operations');
 const keyword=keywordText(source.keyword),fromDate=input.fromDate??source.date;
 day(fromDate);if(fromDate>businessDay())fail('开始日期不能晚于今天');
 await lockKeywordSpace(c);
 const [task]=await select(c,'SELECT id,zhihu_task_id,popularize_type FROM tasks WHERE id=? AND project_id=?',[input.taskId,scope.projectId]);
 const [mapping]=await select(c,`SELECT m.id,m.channel_id,ch.zhihu_channel_id FROM zh_channel_mappings m JOIN channels ch ON ch.id=m.channel_id
   WHERE m.id=? AND m.account_id=? AND m.project_id=? AND m.canonical_id IS NULL AND ch.is_enabled=1`,[mappingId,scope.accountId,scope.projectId]);
 if(!task||!mapping)fail('请选择当前项目的推广活动和渠道',409);
 await resolveExecutor(c,user,scope,input.executorId);
 const words=await select(c,'SELECT id,keyword FROM zh_keywords WHERE account_id=? AND project_id=? AND channel_mapping_id=?',[scope.accountId,scope.projectId,mappingId]);
 if(words.some(word=>normalizedName(String(word.keyword))===normalizedName(keyword)))fail('已有相同名称的关键词，请选择原来的记录',409);
 const existing=await select(c,`SELECT p.*,u.role owner_role FROM plans p JOIN users u ON u.id=p.owner_id WHERE BINARY p.keyword=? FOR UPDATE`,[keyword]);
 if(existing.length>1)fail('已有多个同名关键词，需要先核对原来的记录',409);
 let planId:string,upstreamStatus='historical';
 if(existing.length){
   const plan=existing[0];
   if(String(plan.project_id)!==scope.projectId||String(plan.channel_id)!==String(mapping.zhihu_channel_id)||String(plan.zhihu_task_id)!==String(task.zhihu_task_id))fail('已有同名关键词属于其他推广活动或渠道，请保留原来的记录',409);
   if((await select(c,'SELECT id FROM zh_keywords WHERE plan_id=?',[plan.id])).length)fail('这个关键词已登记，请刷新后选择原来的记录',409);
   if(plan.sync_status!=='synced'||!String(plan.zhihu_plan_id??'').trim())fail('已有同名关键词尚未提交成功，请先核对已有记录',409);
   if(String(plan.owner_id)!==input.executorId&&!isStaffRole(String(plan.owner_role)))fail('已有同名关键词属于其他执行人，不能转给别人',409);
   // Existing successful upstream receipts and original plan ownership are retained.
   planId=String(plan.id);upstreamStatus='created';
 }else{
   planId=await insert(c,`INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,status,sync_status)
     VALUES(?,?,?,?,'',?,?,?,'active','historical')`,[scope.projectId,task.zhihu_task_id,mapping.zhihu_channel_id,keyword,task.popularize_type??1,input.executorId,user.sub]);
 }
 const id=await insert(c,`INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by,upstream_status,legacy_mode)
   VALUES(?,?,?,?,?,?,?,?,'historical_registered')`,[scope.accountId,scope.projectId,input.taskId,mappingId,planId,keyword,user.sub,upstreamStatus]);
 const binding=await assignRetroInTransaction(c,user,scope,id,{executorId:input.executorId,fromDate});
 await audit(c,user,'keyword.register-history',id,{planId,keyword,taskId:input.taskId,mappingId,executorId:input.executorId,fromDate,source:'report-analysis'});
 return {id,planId,bindingId:binding.id,executorName:binding.executorName,fromDate};
}
