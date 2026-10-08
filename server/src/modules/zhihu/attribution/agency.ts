import type {PoolConnection} from 'mysql2/promise';
import type {AuthUser} from '../../../types';
import {isStaffRole} from '../../../auth/roles';
import {withTransaction} from '../../../db';
import {fail,type Scope} from './domain';
import {authorize,audit,mutate,select} from './store';
import {unconfirmedFactSql} from './keyword-usability';

function staff(user:AuthUser){if(!isStaffRole(user.role))fail('代理名称仅管理人员可设置',403);}
export async function agencyName(c:PoolConnection,scope:Scope){
 const [row]=await select(c,'SELECT agency_name FROM zh_project_agencies WHERE project_id=? AND account_id=?',[scope.projectId,scope.accountId]);
 return row?String(row.agency_name):null;
}
export async function agencyCheck(c:PoolConnection,scope:Scope,reported:string|null|undefined){
 // The report specification explicitly makes this column optional.
 if(!reported?.trim())return null;
 const registered=await agencyName(c,scope);
 return !registered?'AGENCY_NOT_CONFIGURED':registered.trim()!==reported.trim()?'AGENCY_MISMATCH':null;
}
export async function getAgency(user:AuthUser,scope:Scope){
 staff(user);await authorize(user,scope);
 return withTransaction(async c=>{
  const rows=await select(c,`SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.agency')) name
    FROM zh_metric_facts f JOIN zh_metric_revisions v ON v.id=f.current_revision_id
    WHERE f.project_id=? AND f.account_id=? AND f.metric_type='activation' AND ${unconfirmedFactSql()}
    AND JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.agency')) NOT IN ('','null') ORDER BY name LIMIT 30`,[scope.projectId,scope.accountId]);
  return {agencyName:await agencyName(c,scope),reportedNames:rows.map(row=>String(row.name))};
 });
}
export async function setAgency(user:AuthUser,scope:Scope,key:string,name:string,expected:string|null){
 staff(user);name=name.trim();if(!name||name.length>200)fail('请填写不超过 200 字的代理名称');
 return mutate(user,scope,'agency.set',key,{name,expected},async c=>{
  const before=await agencyName(c,scope);
  if(before!==expected)fail('代理名称已被其他人更新，请重新读取后再保存',409);
  await c.query(`INSERT INTO zh_project_agencies(project_id,account_id,agency_name,updated_by) VALUES(?,?,?,?)
    ON DUPLICATE KEY UPDATE agency_name=VALUES(agency_name),updated_by=VALUES(updated_by)`,[scope.projectId,scope.accountId,name,user.sub]);
  const facts=await select(c,`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day FROM zh_metric_facts f
    JOIN zh_engine_routes route ON route.account_id=f.account_id AND route.project_id=f.project_id
    WHERE f.project_id=? AND f.account_id=? AND f.metric_type='activation' AND route.mode<>'stopped'
    AND f.business_date>=route.exclusive_from AND ${unconfirmedFactSql()} ORDER BY f.id FOR UPDATE`,[scope.projectId,scope.accountId]);
  const {attribute}=await import('./facts');
  for(const fact of facts)await attribute(c,scope,fact);
  await audit(c,user,'agency.set',scope.projectId,{before,after:name,refreshed:facts.length});
  return {agencyName:name,refreshed:facts.length};
 });
}
