import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
export async function seedFeedback(c:Connection){
 const [[mapping]]=await c.query<RowDataPacket[]>('SELECT m.*,ch.zhihu_channel_id FROM zh_channel_mappings m JOIN channels ch ON ch.id=m.channel_id WHERE m.canonical_id IS NULL ORDER BY m.id LIMIT 1');
 const [[task]]=await c.query<RowDataPacket[]>('SELECT * FROM tasks WHERE project_id=? LIMIT 1',[mapping.project_id]);
 const [[owner]]=await c.query<RowDataPacket[]>("SELECT id FROM users WHERE username='creator_chen'");
 const [[admin]]=await c.query<RowDataPacket[]>("SELECT id FROM users WHERE username='admin'");
 const plan=async(keyword:string,ownerId:unknown)=>{const [r]=await c.query<ResultSetHeader>("INSERT INTO plans(project_id,zhihu_task_id,channel_id,keyword,landing_url,popularize_type,owner_id,created_by,status,sync_status,zhihu_plan_id) VALUES(?,?,?,?,'https://example.com/original',1,?,?,'active','synced',?)",[mapping.project_id,task.zhihu_task_id,mapping.zhihu_channel_id,keyword,ownerId,ownerId,'feedback-'+keyword]);return r.insertId};
 const old=await plan('旧词复核甲',admin.id);
 await c.query("UPDATE plans SET status='pending' WHERE id=?",[old]);
 await c.query("INSERT INTO compositions(plan_id,owner_id,media_type,media_account,composition_type,composition_sub_type,promo_url,release_time,sync_status,zhihu_composition_id) VALUES(?,?,'KOC抖音','original',1,1,'https://example.com/original-work',DATE_SUB(NOW(),INTERVAL 10 DAY),'synced','feedback-work')",[old,admin.id]);
 for(const name of ['旧词复核乙','历史执行复核','代理名称复核']){
  const p=await plan(name,name==='旧词复核乙'?admin.id:owner.id);
  const [k]=await c.query<ResultSetHeader>("INSERT INTO zh_keywords(account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by,upstream_status,lifecycle_status) VALUES(?,?,?,?,?,?,?,'created','assigned')",[mapping.account_id,mapping.project_id,task.id,mapping.id,p,name,admin.id]);
  if(name==='旧词复核乙')continue;
  const [b]=await c.query<ResultSetHeader>("INSERT INTO zh_keyword_bindings(keyword_id,path_type,executor_id,assigned_at,relation_snapshot) VALUES(?,'direct_creator',?,NOW(3),'{}')",[k.insertId,owner.id]);
  await c.query('UPDATE zh_keywords SET current_binding_id=? WHERE id=?',[b.insertId,k.insertId]);
  if(name==='代理名称复核'){
   await c.query("UPDATE zh_keyword_bindings SET used_at=NOW(3),activated_on=DATE_SUB(CURDATE(),INTERVAL 10 DAY),verification_status='passed' WHERE id=?",[b.insertId]);
   await c.query("UPDATE zh_keywords SET used_ever_at=NOW(3),lifecycle_status='active' WHERE id=?",[k.insertId]);
  }
 }
}
