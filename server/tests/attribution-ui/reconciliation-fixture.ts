import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseReport} from '../../src/modules/zhihu/attribution/report';

/** Private originals are supplied at runtime; never committed or sent upstream. */
export async function seedReconciliation(c:Connection){
 const read=async(file:string,kind:'combined'|'activation')=>{const buffer=await readFile(file);const rows=await parseReport({buffer,size:buffer.length,originalname:path.basename(file),mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},kind);if(rows.some(r=>r.error||r.skipped))throw Error('原件解析失败');return rows.map(r=>r.value)};
 const newUsers=await read(process.env.OPC_NEW_USER_SAMPLE!,'combined'),activation=await read(process.env.OPC_ACTIVATION_SAMPLE!,'activation');
 if(newUsers.length!==1||activation.length!==4)throw Error('需要已核对的 1 条拉新和 4 条拉活样例');
 const dates=[...newUsers,...activation].map(r=>r.date).sort(),from=dates[0],to=dates[dates.length-1];
 const [[mapping]]=await c.query<RowDataPacket[]>('SELECT m.*,ch.zhihu_channel_id FROM zh_channel_mappings m JOIN channels ch ON ch.id=m.channel_id WHERE m.canonical_id IS NULL ORDER BY m.id LIMIT 1');
 const [[task]]=await c.query<RowDataPacket[]>('SELECT * FROM tasks WHERE project_id=? LIMIT 1',[mapping.project_id]);
 const [[owner]]=await c.query<RowDataPacket[]>("SELECT id FROM users WHERE username='creator_chen'");
 const [[admin]]=await c.query<RowDataPacket[]>("SELECT id FROM users WHERE username='admin'");
 // Isolated fixture only: match the real channel and period without changing any source file.
 await c.query('UPDATE zh_channel_mappings SET effective_from=? WHERE id=?',[from,mapping.id]);
 await c.query('INSERT INTO zh_channel_mappings(account_id,project_id,channel_id,channel_name,canonical_id,effective_from,created_by) VALUES(?,?,?,?,?,?,?)',[mapping.account_id,mapping.project_id,mapping.channel_id,activation[0].channel,mapping.id,from,admin.id]);
 await c.query('UPDATE zh_engine_routes SET exclusive_from=? WHERE account_id=? AND project_id=?',[from,mapping.account_id,mapping.project_id]);
 await c.query('INSERT INTO zh_project_agencies(project_id,account_id,agency_name,updated_by) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE agency_name=VALUES(agency_name)',[mapping.project_id,mapping.account_id,activation[0].agency,admin.id]);
 const words=[];
 for(const [index,row] of activation.entries()){
  const unassigned=row.keyword===newUsers[0].keyword,creator=index===2,executor=creator?owner.id:admin.id;
  const [p]=await c.query<ResultSetHeader>("INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,status,sync_status,zhihu_plan_id) VALUES(?,?,?,?,'https://example.com/sample',1,?,?,'active','synced',?)",[mapping.project_id,task.zhihu_task_id,mapping.zhihu_channel_id,row.keyword,admin.id,admin.id,'sample-'+index]);
  const [k]=await c.query<ResultSetHeader>("INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by,upstream_status,lifecycle_status) VALUES(?,?,?,?,?,?,?,'created',?)",[mapping.account_id,mapping.project_id,task.id,mapping.id,p.insertId,row.keyword,admin.id,unassigned?'available':'active']);
  if(!unassigned){
   const [b]=await c.query<ResultSetHeader>("INSERT INTO zh_keyword_bindings(keyword_id,path_type,executor_id,assigned_at,used_at,activated_on,relation_snapshot) VALUES(?,?,?,NOW(3),NOW(3),?,'{}')",[k.insertId,creator?'direct_creator':'staff_self',executor,creator?'2026-09-30':row.date]);
   await c.query('UPDATE zh_keywords SET current_binding_id=?,used_ever_at=NOW(3) WHERE id=?',[b.insertId,k.insertId]);
   const work=async(id:unknown,date:string,number:number)=>c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,title,promo_url,release_time,sync_status,zhihu_composition_id) VALUES(?,?,'KOC抖音','sample',1,1,?,?,?,'synced',?)",[p.insertId,id,'已有作品 '+number,'https://example.com/reconciliation/'+index+'/'+number,date,'sample-'+index+'-'+number]);
   if(creator){await work(admin.id,'2026-09-23 12:00:00',0);for(let n=1;n<=3;n++)await work(owner.id,'2026-10-02 12:00:00',n);}
   else await work(executor,row.date+' 12:00:00',1);
  }
  words.push({keyword:row.keyword,keywordId:String(k.insertId),unassigned,creator});
 }
 return {from,to,words,newUsers,activation,executorId:String(owner.id)};
}
