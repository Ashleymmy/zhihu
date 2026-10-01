// Read-only smoke through the real WeChat simulator and cloud environment.
// Enable automation first: cli.bat auto --project <project> --auto-port 9420
const fs=require('node:fs')
const path=require('node:path')
const {createRequire}=require('node:module')
const toolsRoot=path.resolve(__dirname,'../../.runtime/wechat-tools/package.json')
const automator=createRequire(toolsRoot)('miniprogram-automator')
const env=require('../cloudbase/deployment.json').environmentId
const preview=require('../cloudfunctions/opc-api/lib/gateway').developmentPreview(env,require('../cloudfunctions/opc-api/development-access.json'))
async function main(){
  const mini=await automator.connect({wsEndpoint:process.env.WECHAT_AUTO_WS||'ws://127.0.0.1:9420'})
  try{
    const report=await mini.evaluate(async environment=>{
      wx.cloud.init({env:environment})
      const invoke=async(name,data)=>{
        try{const response=await wx.cloud.callFunction({name,config:{env:environment},data});return response.result}
        catch(error){return {error:error.errMsg||error.message}}
      }
      const identity=await invoke('opc-api',{method:'GET',path:'/system/identity'})
      const gate=await invoke('opc-api',{method:'GET',path:'/core/auth/me'})
      const worker=await invoke('opc-worker',{})
      const admin=await invoke('opc-admin',{action:'verify'})
      const runtimeApi=await invoke('opc-api',{action:'runtime-readiness'})
      const runtimeWorker=await invoke('opc-worker',{action:'runtime-readiness'})
      const mutation=await invoke('opc-api',{method:'POST',path:'/modules/zhihu/keywords',data:{}})
      return {identity:{code:identity.code,environment:identity.data&&identity.data.environment,hasOpenid:!!(identity.data&&identity.data.openid),error:identity.error},gate,worker,admin,runtimeApi,runtimeWorker,mutation}
    },env)
    const expected=report.identity.code===0&&report.identity.environment===env&&report.identity.hasOpenid&&report.gate.code===(preview?40100:50300)&&report.mutation.code===(preview?40900:50300)&&report.worker.code===40300&&report.admin.code===40300&&report.runtimeApi.code===40300&&report.runtimeWorker.code===40300
    const result={checkedAt:new Date().toISOString(),environmentId:env,ok:expected,phase:preview?'development-ui-preview':'deployment-before-business-acceptance',...report}
    const output=path.resolve(__dirname,'../cloudbase/deployment-smoke.json')
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n')
    console.log(JSON.stringify(result,null,2))
    if(!expected)process.exitCode=1
  }finally{mini.disconnect()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
