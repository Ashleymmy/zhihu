const d=require('./domain')
const {authorize}=require('./store')
const {ALLIANCE_ENDPOINT_DEFINITIONS,resolvePublicEndpoint}=require('../vendor/zhihu/allianceEndpointRegistry')
const {parseAllianceIngress,adaptAllianceIngress}=require('../vendor/zhihu/allianceContracts')
function register(r){
  for(const definition of ALLIANCE_ENDPOINT_DEFINITIONS)r(definition.method,'/modules/zhihu/alliance/api'+definition.publicPath,async c=>{
    // Direct upstream operations are administrative tools. Member workflows use local ownership checks.
    d.duty(c.user,definition.requiredPermission==='earning.view_all'?'finance':'operations')
    const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope)
    const path=definition.dynamicCompositionId?definition.publicPath.replace(':composition_id',c.params.composition_id):definition.publicPath
    const endpoint=resolvePublicEndpoint(definition.method,path);if(!endpoint)d.fail('知乎接口路径不正确')
    const ingress=parseAllianceIngress(endpoint,c.data.payload||{},c.params.composition_id),payload=adaptAllianceIngress(endpoint,ingress)
    if(definition.method==='GET')return c.upstream.request('GET',path,payload)
    let upload=null
    if(definition.requestKind==='multipart'){
      const {owned,download}=require('./files'),file=await owned(c.store,c.user,scope,d.id(c.data.fileId),'alliance-xlsx'),buffer=await download(c.cloud,file)
      await require('../vendor/zhihu/allianceXlsx').validateAllianceXlsx({buffer,originalname:file.name,mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:buffer.length})
      const hash=d.hash(buffer.toString('base64')),saved=await c.cloud.uploadFile({cloudPath:'sealed-alliance/'+scope.accountId+'/'+hash+'.xlsx',fileContent:buffer})
      upload={fileID:saved.fileID,hash,name:'import.xlsx'}
    }
    return c.store.mutate(c.user,scope,'alliance.request',c.key,{method:definition.method,path,payload,fileId:c.data.fileId||null,hash:upload?.hash||null},async tx=>{
      const row=await tx.add('jobs',{type:'alliance-write',scope,method:definition.method,path,payload,upload,requestedBy:c.user.id,status:'pending',attempts:0,nextAt:Date.now()})
      return {jobId:row.id,status:'queued',message:'请通过 jobs 查询结果；结果未知时必须先核对上游，不能直接重发。'}
    })
  })
}
async function execute(store,upstream,cloud,job,lease){
  let file
  if(job.upload){const buffer=await require('./files').download(cloud,job.upload);if(d.hash(buffer.toString('base64'))!==job.upload.hash)d.fail('上游批量文件内容已变化',409);file={buffer,originalname:job.upload.name,mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:buffer.length}}
  const result=await upstream.request(job.method,job.path,job.payload,file)
  await store.transaction(async tx=>{const current=await tx.get('jobs',job.id);if(current?.lease!==lease)d.fail('任务租约已变化',409);await tx.put('jobs',job.id,{...current,status:'completed',result,completedAt:d.now(),lease:null})})
}
module.exports={register,execute}
