const fs=require('node:fs')
const path=require('node:path')
const mysql=require('../../server/node_modules/mysql2/promise')
const d=require('../cloudfunctions/opc-api/lib/domain')
const {migrateLegacy}=require('./legacy-migration.cjs')
function camel(value){if(Buffer.isBuffer(value))return {base64:value.toString('base64')};if(value instanceof Date)return value.toISOString();if(Array.isArray(value))return value.map(camel);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),camel(v)]));return value}
async function main(){
  const output=path.resolve(process.env.OPC_EXPORT_DIR||path.join(__dirname,'../../.runtime/cloud-migration'))
  fs.mkdirSync(output,{recursive:true})
  let tables={};const counts={}
  if(process.env.OPC_SOURCE_SNAPSHOT){
    tables=JSON.parse(fs.readFileSync(path.resolve(process.env.OPC_SOURCE_SNAPSHOT),'utf8')).tables
    if(!tables||typeof tables!=='object')throw Error('Invalid snapshot')
    for(const [name,rows]of Object.entries(tables))counts[name]=rows.length
  }else{
  const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3308),database:process.env.DB_NAME||'zhihu_koc_dev',user:process.env.DB_USER||'zhihu_dev',password:process.env.DB_PASS,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true})
  try{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
    const [names]=await db.query('SHOW TABLES')
    for(const row of names){
      const name=Object.values(row)[0];if(!/^[a-zA-Z0-9_]+$/.test(name))throw Error('Invalid table name')
      const [rows]=await db.query('SELECT * FROM `'+name+'`')
      tables[name]=rows.map(camel);counts[name]=rows.length
    }
    await db.commit()
  }finally{await db.end()}
  }
  const collections={},handled=new Set(),ignored=new Set(['schema_migrations','roles','token_sessions','module_installations','zh_agency_spaces','zh_engine_gate','zhihu_account_settings'])
  const add=(name,id,value)=>{(collections[name]??=[]).push({_id:String(id),value:d.clean(value)})}
  function map(table,collection,convert){handled.add(table);for(const row of tables[table]||[]){const result=convert(row);if(result)add(collection,result._id||result.id,result.value||result)}}
  map('users','users',u=>({...u,id:String(u.id),parentId:u.parentId?String(u.parentId):null,role:u.role==='member'?'creator':u.role,isActive:!!u.isActive,mustChangePwd:!!u.mustChangePwd,adminDuty:u.adminDuty||'all',sessionVersion:0}))
  for(const row of collections.users||[])add('keys',d.hash(['username',row.value.username.toLowerCase()]),{kind:'username',owner:row.value.id,value:row.value.username.toLowerCase()})
  map('projects','projects',p=>({id:String(p.id),name:p.name,slug:p.slug||'project-'+p.id,isEnabled:!!p.isEnabled,createdAt:p.createdAt}))
  for(const row of collections.projects||[])add('keys',d.hash(['project-slug',row.value.slug]),{kind:'project-slug',owner:row.value.id,value:row.value.slug})
  map('project_members','members',m=>m.leftAt?null:{_id:d.hash([String(m.projectId),String(m.userId)]),value:{projectId:String(m.projectId),userId:String(m.userId),memberRole:m.memberRole,joinedAt:m.joinedAt}})
  map('integration_accounts','accounts',a=>({id:String(a.id),moduleId:a.moduleId,accountKey:a.accountKey,name:a.name,status:a.status}))
  map('project_integrations','links',l=>{const scope={projectId:String(l.projectId),accountId:String(l.accountId)};return {_id:d.hash(scope),value:scope}})
  map('channels','channels',c=>({...c,id:String(c.id),projectId:String(c.projectId),zhihuChannelId:String(c.zhihuChannelId),isEnabled:!!c.isEnabled}))
  map('tasks','tasks',t=>({...t,id:String(t.id),projectId:String(t.projectId),zhihuTaskId:String(t.zhihuTaskId)}))
  map('team_applications','applications',a=>({...a,id:String(a.id),creatorId:String(a.creatorId),leaderId:String(a.leaderId)}))
  map('announcements','announcements',a=>({...a,id:String(a.id),published:a.status==='published'||!!a.isActive}))
  map('mcn_accounts','mcn',a=>({...a,id:String(a.id),ownerUserId:String(a.ownerUserId)}))
  map('story_items','story',a=>({...a,id:String(a.id),ownerId:String(a.ownerId)}))
  map('audit_logs','audit',a=>({...a,id:String(a.id),userId:a.userId?String(a.userId):null}))
  map('zh_engine_routes','routes',r=>{const scope={projectId:String(r.projectId),accountId:String(r.accountId)};return {_id:d.hash(scope),value:{...r,...scope,id:d.hash(scope),exclusiveFrom:r.exclusiveFrom,sampleVerified:!!r.sampleVerified}}})
  const historical=migrateLegacy(tables,add,handled)
  for(const [table,rows] of Object.entries(tables)){if(handled.has(table)||ignored.has(table))continue;for(let index=0;index<rows.length;index++)add('legacy',d.hash([table,String(rows[index].id??index)]),{table,sourceId:String(rows[index].id??index),data:rows[index]})}
  const blockers=[...historical.blockers,...Object.entries(counts).filter(([name,count])=>count>0&&!handled.has(name)&&!ignored.has(name)).map(([table,count])=>({table,count,reason:'Needs semantic migration and reconciliation; raw snapshot retained'}))]
  fs.writeFileSync(path.join(output,'reconciliation.json'),JSON.stringify(historical.reconciliation,null,2))
  fs.writeFileSync(path.join(output,'mysql-snapshot.json'),JSON.stringify({createdAt:d.now(),tables},null,2))
  const batches=[]
  for(const [collection,rows]of Object.entries(collections)){
    for(let start=0;start<rows.length;start+=25){const items=rows.slice(start,start+25),name=collection+'-'+String(start).padStart(6,'0')+'.json';const batch={action:'import',file:name,collection,rows:items,hash:d.hash(items)};fs.writeFileSync(path.join(output,name),JSON.stringify(batch));batches.push({file:name,collection,count:items.length,hash:batch.hash})}
  }
  const manifest={formatVersion:1,environmentId:'cloud1-d4g9ou4cd3b80d764',createdAt:d.now(),counts,targetCounts:Object.fromEntries(Object.entries(collections).map(([key,rows])=>[key,rows.length])),batches,blockers,readyToSeal:blockers.length===0}
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2))
  console.log(JSON.stringify({output,tables:Object.keys(counts).length,targetCollections:Object.keys(collections).length,blockers,readyToSeal:manifest.readyToSeal},null,2))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
