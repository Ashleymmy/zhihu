import type {PoolConnection} from 'mysql2/promise';
import type {AuthUser} from '../../../types';
import type {Scope} from './domain';
import {audit,json,select} from './store';
import {normalizedName,resolvedNames} from './matching';
import {unconfirmedFactSql} from './keyword-usability';

// Callers hold scopeLock and keep the repair in the original transaction.
export async function refreshUnconfirmedKeyword(c:PoolConnection,scope:Scope,keywordId:string){
 const facts=await select(c,`SELECT f.*,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_day FROM zh_metric_facts f
   JOIN zh_engine_routes route ON route.account_id=f.account_id AND route.project_id=f.project_id
   WHERE f.keyword_id=? AND f.account_id=? AND f.project_id=? AND route.mode<>'stopped'
   AND f.business_date>=route.exclusive_from AND ${unconfirmedFactSql()} ORDER BY f.id FOR UPDATE`,[keywordId,scope.accountId,scope.projectId]);
 const {attribute}=await import('./facts');
 for(const fact of facts)await attribute(c,scope,fact);
 return facts.length;
}

// Exact identities repaired in settings also resume previous report rows.
export async function processResolvedNames(c:PoolConnection,user:AuthUser,scope:Scope,filter?:{from:string;to:string;keywordIds:string[]}){
 const words=filter?await select(c,'SELECT id,keyword FROM zh_keywords WHERE account_id=? AND project_id=? AND id IN (?)',[scope.accountId,scope.projectId,filter.keywordIds.length?filter.keywordIds:['0']]):[];
 if(filter&&!words.length)return 0;
 const [route]=await select(c,"SELECT mode,DATE_FORMAT(exclusive_from,'%Y-%m-%d') start FROM zh_engine_routes WHERE account_id=? AND project_id=?",[scope.accountId,scope.projectId]);
 if(!route||route.mode==='stopped')return 0;
 const processed:string[]=[],{processImportRow}=await import('./facts');
 let after='0';
 for(;;){
 const rows=await select(c,`SELECT r.id,b.report_kind,JSON_OBJECT('date',JSON_EXTRACT(r.normalized_json,'$.date'),
   'channel',JSON_EXTRACT(r.normalized_json,'$.channel'),'keyword',JSON_EXTRACT(r.normalized_json,'$.keyword')) source
   FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id WHERE b.account_id=? AND b.project_id=? AND r.id>?
   AND b.status IN ('processed','committed') AND r.fact_id IS NULL AND r.processing_status='exception'
   AND r.error_text IN ('CHANNEL_UNMAPPED','CHANNEL_AMBIGUOUS','PROJECT_MISMATCH','KEYWORD_UNKNOWN')
   ${filter?"AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.date')) BETWEEN ? AND ?":''}
   ${filter?`AND (EXISTS(SELECT 1 FROM zh_import_row_matches m WHERE m.source_row_id=r.id AND m.keyword_id IN (?)) OR
     REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_json,'$.keyword')),'[[:space:]　]+','') COLLATE utf8mb4_unicode_ci IN (?))`:''}
   ORDER BY r.id LIMIT 256`,[scope.accountId,scope.projectId,after,...(filter?[filter.from,filter.to,words.map(w=>String(w.id)),words.map(w=>normalizedName(String(w.keyword)))]:[])]);
 if(!rows.length)break;
 after=String(rows[rows.length-1].id);
 for(const row of rows){
   const source=json<{date:string;channel:string;keyword:string}>(row.source);
   if(row.report_kind==='activation'&&process.env.ZHIHU_ACTIVATION_ENABLED!=='true'||source.date<String(route.start))continue;
   const match=await resolvedNames(c,scope,String(row.id),source);
   if(match.code||filter&&!match.words.some(word=>filter.keywordIds.includes(String(word.id))))continue;
   await c.query("UPDATE zh_import_rows SET processing_status='pending',error_text=NULL WHERE id=?",[row.id]);
   await processImportRow(c,user,scope,String(row.id));processed.push(String(row.id));
 }
 }
 if(processed.length)await audit(c,user,'report.names-reprocess',processed[0],{rowIds:processed});
 return processed.length;
}
