import type {PoolConnection} from 'mysql2/promise';
import type {AuthUser} from '../../../types';
import type {AnalysisAsk} from '../../../core/analysis';
import {digest,fail,type Scope} from './domain';
import {audit,insert,json,select,type RecordRow} from './store';
import {nearestNames,normalizedName,resolvedNames} from './matching';
import {processImportRow} from './facts';
import {registerHistoricalKeyword,type HistoricalSelection} from './historical-keywords';

type NameSource={date:string;channel:string;keyword:string};
export type ChannelSelection={channelId:string}|{mappingId:string}|{upstreamId:string;generation:1|2};
export type NameSelection=ChannelSelection|HistoricalSelection|{keywordId:string};
export interface NameChoice {kind:'channel'|'keyword';ask:AnalysisAsk;rows:string[];source:NameSource;mappingId:string|null;candidates:RecordRow[]}
export async function nameChoices(c:PoolConnection,scope:Scope,batchId:string):Promise<NameChoice[]>{
 // No financial columns are read here, including when an operator asks for candidates.
 const sources=await select(c,`SELECT r.id,JSON_OBJECT('date',JSON_EXTRACT(r.normalized_json,'$.date'),
   'channel',JSON_EXTRACT(r.normalized_json,'$.channel'),'keyword',JSON_EXTRACT(r.normalized_json,'$.keyword')) source
   FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id WHERE b.id=? AND b.account_id=? AND b.project_id=?
   AND b.status IN ('committed','processed') AND r.processing_status='exception'
   AND r.error_text IN ('CHANNEL_UNMAPPED','CHANNEL_AMBIGUOUS','PROJECT_MISMATCH','KEYWORD_UNKNOWN') ORDER BY r.id`,[batchId,scope.accountId,scope.projectId]);
 if(!sources.length)return [];
 const channels=await select(c,`SELECT m.id,m.channel_name,m.channel_id,DATE_FORMAT(m.effective_to,'%Y-%m-%d') until_day
   FROM zh_channel_mappings m JOIN channels ch ON ch.id=m.channel_id WHERE m.account_id=? AND m.project_id=?
   AND m.canonical_id IS NULL AND ch.is_enabled=1 ORDER BY m.id`,[scope.accountId,scope.projectId]);
 const groups=new Map<string,NameChoice>(),wordsByMapping=new Map<string,RecordRow[]>();
 for(const row of sources){
   const source=json<NameSource>(row.source),match=await resolvedNames(c,scope,String(row.id),source);
   const kind=match.mappings.length===1&&String(match.mappings[0].project_id)===scope.projectId?'keyword':'channel';
   const mappingId=kind==='keyword'?String(match.mappings[0].stable_id):null;
   let candidates:RecordRow[];
   if(kind==='channel')candidates=nearestNames(source.channel,channels.filter(item=>!item.until_day||String(item.until_day)>source.date),item=>String(item.channel_name));
   else{
     if(!wordsByMapping.has(mappingId!))wordsByMapping.set(mappingId!,await select(c,'SELECT id,keyword FROM zh_keywords WHERE account_id=? AND project_id=? AND channel_mapping_id=?',[scope.accountId,scope.projectId,mappingId]));
     candidates=nearestNames(source.keyword,wordsByMapping.get(mappingId!)!,item=>String(item.keyword));
   }
   const groupKey=JSON.stringify([kind,normalizedName(source.channel),kind==='keyword'?normalizedName(source.keyword):null,mappingId,candidates.map(item=>String(item.id))]);
   const existing=groups.get(groupKey);
   if(existing){existing.rows.push(String(row.id));if(source.date<existing.source.date)existing.source.date=source.date;continue;}
   groups.set(groupKey,{kind,source,mappingId,candidates,rows:[String(row.id)],ask:{id:'',text:'',options:[]}});
 }
 for(const choice of groups.values()){
   const {kind,source,candidates}=choice,name=kind==='channel'?source.channel:source.keyword;
   choice.ask={id:'name:'+kind+':'+digest([batchId,choice.rows,choice.mappingId,source,candidates.map(item=>[String(item.id),item.channel_name??item.keyword,item.until_day??null])]).slice(0,40),
     text:`${choice.rows.length} 行的${kind==='channel'?'渠道':'关键词'}「${name}」需要运营确认${candidates.length?'，是不是下面这个？':'。'}`,
     options:[...candidates.slice(0,1).map(item=>({key:kind+':'+item.id,label:'是「'+String(kind==='channel'?item.channel_name:item.keyword)+'」',tone:'primary' as const})),
       {key:kind==='channel'?'other-channel':'other-keyword',label:kind==='channel'?'其他或新渠道':candidates.length?'其他或登记历史关键词':'登记并指定执行人'},
       {key:'skip',label:'暂时跳过'}]};
 }
 return [...groups.values()];
}

async function canonicalForSelection(c:PoolConnection,user:AuthUser,scope:Scope,choice:NameChoice,selection:ChannelSelection){
 if('mappingId' in selection){
   const [mapping]=await select(c,`SELECT m.id FROM zh_channel_mappings m JOIN channels ch ON ch.id=m.channel_id
     WHERE m.id=? AND m.account_id=? AND m.project_id=? AND m.canonical_id IS NULL AND ch.is_enabled=1
     AND (m.effective_to IS NULL OR m.effective_to>?)`,[selection.mappingId,scope.accountId,scope.projectId,choice.source.date]);
   if(!mapping)fail('请选择当前项目的有效渠道名称',409);return String(mapping.id);
 }
 let channelId:string;
 if('channelId' in selection){
   const [channel]=await select(c,'SELECT id FROM channels WHERE id=? AND project_id=? AND is_enabled=1',[selection.channelId,scope.projectId]);
   if(!channel)fail('请选择当前项目的渠道',409);channelId=String(channel.id);
 }else{
   const existing=await select(c,'SELECT id FROM channels WHERE project_id=? AND zhihu_channel_id=?',[scope.projectId,selection.upstreamId]);
   if(existing.length)fail('这个知乎渠道已登记，请从现有渠道中选择',409);
   if(choice.source.channel.length>128)fail('渠道名称过长，请先核对报表中的名称');
   channelId=await insert(c,'INSERT INTO channels(project_id,zhihu_channel_id,generation,name) VALUES(?,?,?,?)',[scope.projectId,selection.upstreamId,selection.generation,choice.source.channel]);
 }
 const mappings=await select(c,`SELECT id FROM zh_channel_mappings WHERE account_id=? AND project_id=? AND channel_id=? AND canonical_id IS NULL
   AND (effective_to IS NULL OR effective_to>?) ORDER BY effective_from DESC`,[scope.accountId,scope.projectId,channelId,choice.source.date]);
 if(mappings.length>1)fail('这个渠道有多个有效名称，请直接选择上面的名称',409);
 if(mappings.length)return String(mappings[0].id);
 const id=await insert(c,'INSERT INTO zh_channel_mappings(account_id,project_id,channel_id,channel_name,effective_from,created_by) VALUES(?,?,?,?,?,?)',
   [scope.accountId,scope.projectId,channelId,choice.source.channel,choice.source.date,user.sub]);
 await audit(c,user,'channel.create',id,{channelId,name:choice.source.channel,from:choice.source.date,source:'report-analysis'});
 return id;
}

export async function applyNameChoice(c:PoolConnection,user:AuthUser,scope:Scope,choice:NameChoice,option:string,selection?:NameSelection){
 if(option==='skip')return;
 let mappingId=choice.mappingId,keywordId:string|null=null;
 if(choice.kind==='channel'){
   if(option==='other-channel'){
     if(!selection||!('channelId' in selection||'mappingId' in selection||'upstreamId' in selection))fail('请选择一个渠道，或登记新的知乎渠道');
     mappingId=await canonicalForSelection(c,user,scope,choice,selection);
   }else mappingId=option.slice('channel:'.length);
   const [mapping]=await select(c,`SELECT id,channel_id,channel_name,DATE_FORMAT(effective_to,'%Y-%m-%d') until_day FROM zh_channel_mappings
     WHERE id=? AND account_id=? AND project_id=? AND canonical_id IS NULL`,[mappingId,scope.accountId,scope.projectId]);
   if(!mapping)fail('渠道已变化，请重新确认',409);
   // Remember a new spelling from the report day. Ambiguities remain row-specific;
   // never replace another channel's existing identity or historical mapping.
   const names=await select(c,`SELECT channel_name FROM zh_channel_mappings WHERE account_id=?
     AND effective_from<COALESCE(?,'9999-12-31') AND (effective_to IS NULL OR effective_to>?)`,[scope.accountId,mapping.until_day,choice.source.date]);
   if(!names.some(item=>normalizedName(String(item.channel_name))===normalizedName(choice.source.channel))){
     const alias=await insert(c,'INSERT INTO zh_channel_mappings(account_id,project_id,channel_id,canonical_id,channel_name,effective_from,effective_to,created_by) VALUES(?,?,?,?,?,?,?,?)',
       [scope.accountId,scope.projectId,mapping.channel_id,mappingId,choice.source.channel,choice.source.date,mapping.until_day,user.sub]);
     await audit(c,user,'channel.create',alias,{canonicalId:mappingId,from:choice.source.date,name:choice.source.channel,source:'report-analysis'});
   }
 }else if(option==='other-keyword'){
   if(selection&&'keywordId' in selection){
     if(!choice.candidates.some(item=>String(item.id)===selection.keywordId))fail('关键词候选已变化，请重新选择',409);
     keywordId=selection.keywordId;
   }else{
     if(!selection||!('executorId' in selection))fail('请选择执行人和推广活动');
     keywordId=(await registerHistoricalKeyword(c,user,scope,mappingId!,choice.source,selection)).id;
   }
 }else keywordId=option.slice('keyword:'.length);
 for(const rowId of choice.rows){
   await c.query(`INSERT INTO zh_import_row_matches(source_row_id,channel_mapping_id,keyword_id,confirmed_by) VALUES(?,?,?,?)
     ON DUPLICATE KEY UPDATE channel_mapping_id=VALUES(channel_mapping_id),keyword_id=VALUES(keyword_id),confirmed_by=VALUES(confirmed_by),confirmed_at=NOW(3)`,[rowId,mappingId,keywordId,user.sub]);
   await c.query("UPDATE zh_import_rows SET processing_status='pending',error_text=NULL WHERE id=? AND processing_status='exception'",[rowId]);
   await processImportRow(c,user,scope,rowId);
 }
 await audit(c,user,'report.names-confirm',choice.rows[0],{rowIds:choice.rows,mappingId,keywordId,originalChannel:choice.source.channel,originalKeyword:choice.source.keyword});
 await processResolvedNames(c,user,scope);
}

// Other reports with this now-known identity also continue without re-upload.
async function processResolvedNames(c:PoolConnection,user:AuthUser,scope:Scope){
 const rows=await select(c,`SELECT r.id,b.report_kind,JSON_OBJECT('date',JSON_EXTRACT(r.normalized_json,'$.date'),
   'channel',JSON_EXTRACT(r.normalized_json,'$.channel'),'keyword',JSON_EXTRACT(r.normalized_json,'$.keyword')) source
   FROM zh_import_rows r JOIN zh_import_batches b ON b.id=r.batch_id WHERE b.account_id=? AND b.project_id=?
   AND b.status IN ('processed','committed') AND r.fact_id IS NULL AND r.processing_status='exception'
   AND r.error_text IN ('CHANNEL_UNMAPPED','CHANNEL_AMBIGUOUS','PROJECT_MISMATCH','KEYWORD_UNKNOWN') ORDER BY r.id`,[scope.accountId,scope.projectId]);
 const [route]=await select(c,"SELECT DATE_FORMAT(exclusive_from,'%Y-%m-%d') start FROM zh_engine_routes WHERE account_id=? AND project_id=?",[scope.accountId,scope.projectId]);
 const processed:string[]=[];
 for(const row of rows){
   const source=json<NameSource>(row.source);
   if(row.report_kind==='activation'&&process.env.ZHIHU_ACTIVATION_ENABLED!=='true'||route&&source.date<String(route.start))continue;
   if((await resolvedNames(c,scope,String(row.id),source)).code)continue;
   await c.query("UPDATE zh_import_rows SET processing_status='pending',error_text=NULL WHERE id=?",[row.id]);
   await processImportRow(c,user,scope,String(row.id));processed.push(String(row.id));
 }
 if(processed.length)await audit(c,user,'report.names-reprocess',processed[0],{rowIds:processed});
}
