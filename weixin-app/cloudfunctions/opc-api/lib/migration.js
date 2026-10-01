const d=require('./domain')
const {collections,PREFIX}=require('./store')
const blockedCollections=['sessions','limits','locks','requests','settings']
function validateManifest(manifest,environment){
  if(!manifest||manifest.formatVersion!==1||manifest.environmentId!==environment||!Array.isArray(manifest.batches)||!Array.isArray(manifest.blockers))d.fail('迁移清单或目标环境不正确')
  if(!manifest.targetCounts||typeof manifest.targetCounts!=='object')d.fail('缺少集合数量清单')
  const totals={},seen=new Set()
  for(const batch of manifest.batches){
    if(!batch||!collections.includes(batch.collection)||blockedCollections.includes(batch.collection)||typeof batch.file!=='string'||!/^[a-z_]+-\d+\.json$/.test(batch.file)||seen.has(batch.file)||!Number.isInteger(batch.count)||batch.count<1||batch.count>30||!/^[a-f0-9]{64}$/.test(batch.hash))d.fail('批次清单格式不正确')
    seen.add(batch.file);totals[batch.collection]=(totals[batch.collection]||0)+batch.count
  }
  if(d.hash(totals)!==d.hash(manifest.targetCounts))d.fail('批次数量与目标集合数量不匹配')
  return manifest
}
async function ensureCollection(db,name){
  try{await db.collection(name).count();return}catch(_){}
  try{await db.createCollection(name)}catch(error){
    // SDK versions use different errors for an existing collection. A successful
    // read proves it exists, without relying on localized error message text.
    try{await db.collection(name).count();return}catch(_){throw error}
  }
}
function createMigration(store,db,environment,release,reportStage=()=>{}){
  const assertImporting=async tx=>{const state=await tx.get('settings','migration');if(!state||state.status!=='importing')d.fail('迁移入口已关闭或尚未初始化',403);return state}
  async function handle(event){
    if(event.action==='initialize'){
      const manifest=validateManifest(event.manifest,environment),manifestHash=d.hash(manifest)
      const existing=await store.get('settings','migration').catch(error=>{if(/collection|not exist|不存在/i.test(error.message||error.errMsg||''))return null;throw error})
      if(existing){if(existing.manifestHash!==manifestHash||existing.status!=='importing')d.fail('已有不同迁移清单或业务已启用，禁止覆盖',409);return {manifestHash,collections:collections.map(c=>PREFIX+c)}}
      for(const name of collections){reportStage('initialize.collection:'+PREFIX+name);await ensureCollection(db,PREFIX+name)}
      reportStage('initialize.manifest')
      return store.transaction(async tx=>{
        const old=await tx.get('settings','migration')
        if(old&&(old.manifestHash!==manifestHash||old.status!=='importing'))d.fail('已有不同迁移清单或业务已启用，禁止覆盖',409)
        if(!old)await tx.put('settings','migration',{status:'importing',manifest,manifestHash,createdAt:d.now()})
        return {manifestHash,collections:collections.map(c=>PREFIX+c)}
      })
    }
    const state=await assertImporting(store)
    if(event.action==='import'){
      reportStage('import.validate')
      if(!Array.isArray(event.rows)||event.rows.length>30||JSON.stringify(event.rows).length>512*1024)d.fail('每批最多 30 条、512 KB')
      const batch=state.manifest.batches.find(b=>b.file===event.file)
      if(!batch||batch.collection!==event.collection||batch.hash!==event.hash||batch.count!==event.rows.length||d.hash(event.rows)!==event.hash)d.fail('导入内容不符合已登记清单')
      const receipt='batch-'+d.hash([state.manifestHash,event.file])
      reportStage('import.transaction:'+event.collection)
      await store.transaction(async tx=>{
        await assertImporting(tx)
        for(const row of event.rows){
          if(!row||typeof row._id!=='string'||!row._id||row._id.length>128||!row.value||typeof row.value!=='object'||Array.isArray(row.value)||'_id' in row.value)d.fail('导入记录格式不正确')
          const existing=await tx.get(event.collection,row._id)
          if(existing&&d.hash(existing)!==d.hash(row.value))d.fail('目标记录已有不同内容，停止覆盖',409)
          await tx.put(event.collection,row._id,row.value)
        }
        await tx.put('settings',receipt,{hash:event.hash,collection:event.collection,ids:event.rows.map(r=>r._id)})
      });return {count:event.rows.length,hash:event.hash}
    }
    if(event.action==='verify'||event.action==='seal'){
      const counts={},missing=[],mismatched=[]
      for(const name of collections){reportStage('verify.count:'+PREFIX+name);counts[name]=(await db.collection(PREFIX+name).count()).total}
      for(const batch of state.manifest.batches){
        reportStage('verify.batch:'+batch.collection)
        const receipt=await store.get('settings','batch-'+d.hash([state.manifestHash,batch.file]))
        if(!receipt){missing.push(batch.file);continue}
        const rows=[];for(const id of receipt.ids)rows.push({_id:id,value:await store.get(batch.collection,id)})
        if(d.hash(rows)!==batch.hash)mismatched.push(batch.file)
      }
      const invalidCounts=collections.filter(name=>!blockedCollections.includes(name)&&counts[name]!==Number(state.manifest.targetCounts[name]||0))
      const verified=!missing.length&&!mismatched.length&&!invalidCounts.length
      if(event.action==='verify')return {counts,missing,mismatched,invalidCounts,verified,blockers:state.manifest.blockers,release}
      if(!verified)d.fail('数据数量或内容核对未通过',409)
      if(state.manifest.readyToSeal!==true||state.manifest.blockers.length)d.fail('旧业务数据尚未完成语义迁移和对账，禁止启用',409)
      if(!release||release.ready!==true||release.blockers?.length)d.fail('云端接口迁移和上线验收未完成，禁止启用',409)
      if(event.confirmation!==state.manifestHash||event.cloudAcceptanceVerified!==true)d.fail('请先完成真实云环境角色与资金链路验收',409)
      const users=await store.find('users',{role:'admin',isActive:true})
      if(!users.some(u=>(u.adminDuty||'all')==='all'))d.fail('至少需要一位全量管理员')
      await store.transaction(async tx=>{const latest=await assertImporting(tx);await tx.put('settings','migration',{...latest,status:'sealed',sealedAt:d.now()})})
      return {sealed:true}
    }
    d.fail('未知迁移操作')
  }
  return {handle}
}
module.exports={createMigration,validateManifest,ensureCollection}
