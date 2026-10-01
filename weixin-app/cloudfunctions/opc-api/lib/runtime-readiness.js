const d=require('./domain')
const crypto=require('node:crypto')
function serverOnly(identity){
  const sources=String(identity.SOURCE||'').split(',').map(value=>value.trim())
  // Business worker calls retain the strict identity gate. Runtime diagnostics
  // use a separate one-use capability and cannot execute business jobs.
  if(identity.OPENID||sources.some(value=>value.includes('client')))return false
  return !identity.APPID
}
async function check(store,identity,options={}){
  // WeChat cloud-to-cloud calls can inherit caller metadata. A one-use, short
  // lived capability issued by authenticated opc-admin proves this specific
  // diagnostic call without changing business or worker authorization.
  const probe=options.probe,target=options.functionName
  if(!probe||!/^[a-f0-9]{32}$/.test(probe.id)||!/^[a-f0-9]{64}$/.test(probe.token)||!['opc-api','opc-worker'].includes(target))return denied()
  const accepted=await store.transaction(async tx=>{
    const id='runtime-readiness-'+probe.id,row=await tx.get('settings',id)
    if(!row||row.target!==target||!Number.isFinite(row.expiresAt)||row.expiresAt<=Date.now()||row.tokenHash!==d.hash(probe.token))return false
    await tx.remove('settings',id);return true
  })
  if(!accepted)return denied()
  const configured=value=>typeof value==='string'&&!!value&&!value.startsWith('mock_')
  const credentialsConfigured=configured(process.env.ZHIHU_ACCESS_TOKEN)&&configured(process.env.ZHIHU_SECRET_KEY)
  const result={node:process.version,credentialsConfigured,callbackEncryptionConfigured:/^[a-f0-9]{64}$/i.test(process.env.OPC_CALLBACK_KEY||''),upstreamReadVerified:false}
  if(options.upstream&&credentialsConfigured){
    try{await require('./upstream').client(store).request('GET','/get_agent_channels',{});result.upstreamReadVerified=true}
    catch(error){result.upstreamError=error instanceof d.Fault?error.message:'知乎只读验证未通过';result.upstreamErrorType=error.name}
  }
  return {code:0,data:result}
}
function denied(){return {code:40300,message:'运行配置检查需要有效的一次性服务端凭据'}}
async function invoke(store,cloud,name){
  if(!['opc-api','opc-worker'].includes(name))d.fail('不支持的运行配置检查目标')
  const probe={id:crypto.randomBytes(16).toString('hex'),token:crypto.randomBytes(32).toString('hex')},id='runtime-readiness-'+probe.id
  await store.put('settings',id,{target:name,tokenHash:d.hash(probe.token),expiresAt:Date.now()+120000})
  try{return (await cloud.callFunction({name,data:{action:'runtime-readiness',probe}})).result}
  finally{await store.remove('settings',id)}
}
module.exports={check,serverOnly,invoke}
