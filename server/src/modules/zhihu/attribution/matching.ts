import type {PoolConnection} from 'mysql2/promise';
import {select,type RecordRow} from './store';
import type {Scope} from './domain';

// Keep the uploaded spelling in the source row; normalize only for comparison.
export const normalizedName=(value:string)=>value.normalize('NFKC').replace(/\s+/gu,'');
const unique=(rows:RecordRow[],key:(row:RecordRow)=>string)=>[...new Map(rows.map(row=>[key(row),row])).values()];
export async function matchChannels(c:PoolConnection,scope:Scope,name:string,date:string){
 const rows=await select(c,`SELECT id,COALESCE(canonical_id,id) stable_id,project_id,channel_id,channel_name
   FROM zh_channel_mappings WHERE account_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)`,[scope.accountId,date,date]);
 return unique(rows.filter(row=>normalizedName(String(row.channel_name))===normalizedName(name)),row=>String(row.project_id)+':'+row.stable_id);
}
export async function matchKeywords(c:PoolConnection,scope:Scope,mappingId:string,name:string){
 const rows=await select(c,'SELECT id,keyword FROM zh_keywords WHERE account_id=? AND project_id=? AND channel_mapping_id=?',[scope.accountId,scope.projectId,mappingId]);
 return rows.filter(row=>normalizedName(String(row.keyword))===normalizedName(name));
}
// An explicit answer belongs to one source row, and can never escape its scope.
export async function resolvedNames(c:PoolConnection,scope:Scope,rowId:string,raw:{channel:string;keyword:string;date:string}){
 const [choice]=await select(c,'SELECT channel_mapping_id,keyword_id FROM zh_import_row_matches WHERE source_row_id=?',[rowId]);
 const mappings=choice?.channel_mapping_id?await select(c,`SELECT id,id stable_id,project_id,channel_id,channel_name FROM zh_channel_mappings
   WHERE id=? AND account_id=? AND project_id=? AND canonical_id IS NULL`,[choice.channel_mapping_id,scope.accountId,scope.projectId]):await matchChannels(c,scope,raw.channel,raw.date);
 const code=mappings.length===0?'CHANNEL_UNMAPPED':mappings.length>1?'CHANNEL_AMBIGUOUS':String(mappings[0].project_id)!==scope.projectId?'PROJECT_MISMATCH':null;
 const words=code?[]:choice?.keyword_id?await select(c,'SELECT id,keyword FROM zh_keywords WHERE id=? AND account_id=? AND project_id=? AND channel_mapping_id=?',
   [choice.keyword_id,scope.accountId,scope.projectId,mappings[0].stable_id]):await matchKeywords(c,scope,String(mappings[0].stable_id),raw.keyword);
 return {mappings,words,code:code??(words.length!==1?'KEYWORD_UNKNOWN':null)};
}
export function nameDistance(left:string,right:string){
 const a=[...normalizedName(left)],b=[...normalizedName(right)];let previous=b.map((_,i)=>i+1);previous.unshift(0);
 for(let i=0;i<a.length;i++){
   const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,previous[j+1]+1,previous[j]+Number(a[i]!==b[j])));previous=next;
 }
 return previous[b.length];
}
export function nearestNames<T>(input:string,rows:T[],name:(row:T)=>string,limit=2){
 const length=[...normalizedName(input)].length,threshold=Math.min(4,Math.max(1,Math.ceil(length/3)));
 return rows.filter(row=>Math.abs([...normalizedName(name(row))].length-length)<=threshold)
   .map(row=>({row,distance:nameDistance(input,name(row))})).filter(item=>item.distance<=threshold)
   .sort((a,b)=>a.distance-b.distance||name(a.row).localeCompare(name(b.row),'zh-CN')).slice(0,limit).map(item=>item.row);
}
