const d=require('./domain'),crypto=require('node:crypto')
const {isolatedStore,cleanup}=require('./acceptance-store'),{createAPI}=require('./api')
const scope={projectId:'1',accountId:'10'}
// 512 KiB 分片：用约 1.2 MiB 合成内容跑出 3 片（末片为短片），覆盖分片边界与末片大小校验。
const CHUNK=512*1024,CHUNKS=3,SIZE=CHUNK*(CHUNKS-1)+1234

function ensure(value,message){if(!value){const error=Error('Storage acceptance failed');error.acceptanceCheck=message;throw error}}

// 在隔离命名空间里跑一次完整的分片上传协议，验证的是**真实云存储**：
//   prepare → upload-chunk(3 片) → finish-upload → 从云存储回读比对哈希
//   → 归属隔离 → 分片幂等 → 清理
// 隔离命名空间保证不触碰任何真实业务记录；结束后删除云存储对象与隔离记录。
async function run(base,db,cloud){
  const runId=crypto.randomBytes(12).toString('hex')
  const store=isolatedStore(db,runId)
  const checks={},objects=[],trace=[]
  const step=name=>trace.push(name)
  const api=createAPI(store,cloud,'acceptance',{upstream:{request:async()=>{throw Error('Storage acceptance must not contact upstream')}}})
  const finance={openid:'storage-'+runId,appid:'wx22b91776ccf37354'}
  const other={openid:'other-'+runId,appid:'wx22b91776ccf37354'}
  const call=(identity,token,method,path,data={})=>api.handle({token,method,path,data},identity)

  const content=crypto.randomBytes(SIZE)
  const sha256=crypto.createHash('sha256').update(content).digest('hex')

  try{
    const password=crypto.createHash('sha256').update('storage-password:'+runId).digest('hex')
    const passwordHash=await require('bcryptjs').hash(password,4)
    // 只建本次验收需要的最小作用域：一个财务管理员 + 一个无关账号（用于归属隔离）。
    await store.transaction(async tx=>{
      await tx.put('users','1',{id:'1',username:'sa-finance',displayName:'sa-finance',role:'admin',adminDuty:'finance',parentId:null,passwordHash,isActive:true,sessionVersion:0,mustChangePwd:false})
      await tx.put('users','2',{id:'2',username:'sa-other',displayName:'sa-other',role:'creator',adminDuty:'all',parentId:null,passwordHash,isActive:true,sessionVersion:0,mustChangePwd:false})
      await tx.put('keys',d.hash(['username','sa-finance']),{owner:'1'})
      await tx.put('keys',d.hash(['username','sa-other']),{owner:'2'})
      await tx.put('projects','1',{id:'1',name:'Storage acceptance project',isEnabled:true})
      await tx.put('accounts','10',{id:'10',moduleId:'zhihu',status:'active'})
      await tx.put('links',d.hash(scope),scope)
      await tx.put('members',d.hash(['1','2']),{projectId:'1',userId:'2'})
      await tx.put('routes',d.hash(scope),{id:d.hash(scope),...scope,exclusiveFrom:'2020-01-01',mode:'enabled'})
    })
    checks.seed=true;step('seed')

    const login=async(name,identity)=>{
      const response=await call(identity,null,'POST','/core/auth/login',{username:name,password})
      ensure(response.code===0&&response.data&&response.data.token,'登录失败 '+name+' '+response.code)
      return response.data.token
    }
    const adminToken=await login('sa-finance',finance)
    const otherToken=await login('sa-other',other)
    checks.login=true;step('login')

    const prepared=await call(finance,adminToken,'POST','/core/files/prepare',{...scope,purpose:'report',name:'acceptance-report.xlsx'})
    ensure(prepared.code===0,'prepare '+prepared.code)
    const descriptor=prepared.data.upload
    ensure(descriptor&&descriptor.transport==='cloud-function','prepare 未返回 cloud-function 描述符')
    ensure(descriptor.chunkBytes===CHUNK,'chunkBytes 与前端约定不一致')
    ensure(descriptor.maxBytes>=SIZE,'maxBytes 小于测试文件')
    const fileId=prepared.data.id
    checks.prepare=true;step('prepare')

    const totalChunks=Math.ceil(SIZE/CHUNK)
    ensure(totalChunks===CHUNKS,'分片数计算与预期不符')
    for(let index=0;index<totalChunks;index++){
      const start=index*CHUNK,end=Math.min(start+CHUNK,SIZE)
      const response=await call(finance,adminToken,'POST','/core/files/'+fileId+'/upload-chunk',{index,totalBytes:SIZE,base64:content.subarray(start,end).toString('base64')})
      ensure(response.code===0,'upload-chunk '+index+' '+response.code)
      ensure(response.data.received===true,'第 '+(index+1)+' 片未被确认接收')
    }
    checks.chunks=true;step('chunks')

    // 归属隔离：另一个账号不得往他人的文件里写分片（access() 校验 file.userId）。
    const denied=await call(other,otherToken,'POST','/core/files/'+fileId+'/upload-chunk',{index:0,totalBytes:SIZE,base64:content.subarray(0,CHUNK).toString('base64')})
    ensure(denied.code===40300,'其他账号可以写他人的文件，期望 403 实际 '+denied.code)
    checks.isolation=true;step('isolation')

    const finished=await call(finance,adminToken,'POST','/core/files/'+fileId+'/finish-upload',{})
    ensure(finished.code===0,'finish-upload '+finished.code)
    ensure(finished.data.complete===true,'合并未标记完成')
    ensure(finished.data.size===SIZE,'合并后大小不符')
    ensure(finished.data.sha256===sha256,'合并后哈希与原始内容不符')
    checks.finish=true;step('finish')

    const record=await store.get('files',fileId)
    ensure(record&&typeof record.fileID==='string'&&record.fileID,'合并后未记录云存储 fileID')
    objects.push(record.fileID)
    // 分片对象应在合并后被回收；把残留也纳入清理集合，避免污染云存储。
    for(const row of Object.values(record.upload?.chunks||{}))if(row.fileID)objects.push(row.fileID)

    const downloaded=await cloud.downloadFile({fileID:record.fileID})
    const buffer=downloaded.fileContent
    ensure(Buffer.isBuffer(buffer)&&buffer.length===SIZE,'从云存储回读的内容大小不符')
    ensure(crypto.createHash('sha256').update(buffer).digest('hex')===sha256,'从云存储回读的内容哈希不符')
    checks.readback=true;step('readback')

    // 分片幂等：同一片重发必须被识别为已接收，而不是替换内容。
    const replay=await call(finance,adminToken,'POST','/core/files/'+fileId+'/upload-chunk',{index:0,totalBytes:SIZE,base64:content.subarray(0,CHUNK).toString('base64')})
    ensure(replay.code===0&&replay.data.received===true,'重发第 1 片未被识别为已接收')
    checks.idempotency=true;step('idempotency')

    return {status:'passed',checks,bytes:SIZE,chunks:totalChunks,sha256,trace}
  }catch(error){
    return {status:'failed',checks,failedCheck:error.acceptanceCheck||null,diagnostic:require('./migration-diagnostic').diagnostic(error,'acceptance.storage'),trace}
  }finally{
    // 云存储对象与隔离记录都必须清掉：这是真实环境，不能留下测试残留。
    let objectsRemoved=false,recordsRemoved=null
    try{if(objects.length)await cloud.deleteFile({fileList:[...new Set(objects)]});objectsRemoved=true}catch(_){objectsRemoved=false}
    try{recordsRemoved=await cleanup(store)}catch(_){recordsRemoved=null}
    checks.cleanup=objectsRemoved===true&&recordsRemoved!==null
    checks.objectsRemoved=objectsRemoved
    checks.recordsRemoved=recordsRemoved
  }
}
module.exports={run}
