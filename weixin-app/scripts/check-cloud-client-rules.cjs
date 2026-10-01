// Default read-only; --write uses temporary, non-business probes and cleans them.
// Document IDs and contents never leave the simulator.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module')
const automator=createRequire(path.resolve(__dirname,'../../.runtime/wechat-tools/package.json'))('miniprogram-automator')
const environmentId=require('../cloudbase/deployment.json').environmentId
const collections=require('../cloudfunctions/opc-api/lib/store').collections.map(name=>'opc_'+name)
const checkWrites=process.argv.includes('--write')
async function main(){
  const mini=await automator.connect({wsEndpoint:process.env.WECHAT_AUTO_WS||'ws://127.0.0.1:9420'})
  try{
    const checks=[]
    for(let offset=0;offset<collections.length;offset+=5)checks.push(...await mini.evaluate(async({environmentId,collections,checkWrites})=>{
      wx.cloud.init({env:environmentId})
      const db=wx.cloud.database({env:environmentId}),results=[]
      for(const name of collections){
        const row={collection:name}
        try{const result=await db.collection(name).field({_id:true}).limit(1).get();Object.assign(row,{clientReadDenied:false,returnedAnyDocument:!!result.data?.length})}
        catch(error){Object.assign(row,{clientReadDenied:error.errCode===-502003,errorCode:error.errCode||null})}
        if(checkWrites){
          const id='client-rule-probe-'+Date.now()+'-'+Math.random().toString(36).slice(2)
          try{const added=await db.collection(name).add({data:{_id:id,purpose:'readiness-check-no-business-data'}});row.clientWriteDenied=false;try{await db.collection(name).doc(added._id).remove();row.probeCleanupSucceeded=true}catch(_){row.probeCleanupSucceeded=false}}
          catch(error){row.clientWriteDenied=error.errCode===-502003;row.writeErrorCode=error.errCode||null}
        }
        results.push(row)
      }
      return results
    },{environmentId,collections:collections.slice(offset,offset+5),checkWrites}))
    const report={checkedAt:new Date().toISOString(),environmentId,readOnly:!checkWrites,allClientReadsDenied:checks.every(row=>row.clientReadDenied),writesVerified:checkWrites,allClientWritesDenied:checkWrites&&checks.every(row=>row.clientWriteDenied),checks}
    fs.writeFileSync(path.resolve(__dirname,'../cloudbase/client-rules-check.json'),JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify({checkedCollections:checks.length,readsDenied:checks.filter(row=>row.clientReadDenied).map(row=>row.collection),writesDenied:checks.filter(row=>row.clientWriteDenied).map(row=>row.collection),writesStillAllowed:checks.filter(row=>row.clientWriteDenied===false).map(row=>row.collection),cleanupFailures:checks.filter(row=>row.probeCleanupSucceeded===false).map(row=>row.collection)},null,2))
    if(!report.allClientReadsDenied||checkWrites&&!report.allClientWritesDenied)process.exitCode=1
  }finally{mini.disconnect()}
}
const deadline=setTimeout(()=>{console.error('Simulator rule check timed out; inspect any unfinished probe before retrying');process.exit(1)},150000)
main().catch(error=>{fs.writeFileSync(path.resolve(__dirname,'../../.runtime/cloud-migration/rules-check-error.json'),JSON.stringify({name:error.name,message:error.message}));console.error('Simulator rule check failed; diagnostic saved privately');process.exitCode=1}).finally(()=>clearTimeout(deadline))
