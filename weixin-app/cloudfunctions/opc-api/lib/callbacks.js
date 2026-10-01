const crypto=require('node:crypto'),d=require('./domain')
const {authorize}=require('./store')
const {visible}=require('./legacy-finance')
function encryptionKey(){if(!/^[a-f0-9]{64}$/i.test(process.env.OPC_CALLBACK_KEY||''))d.fail('尚未配置回传密钥加密配置',503);return Buffer.from(process.env.OPC_CALLBACK_KEY,'hex')}
function encrypt(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv),bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return {ciphertext:bytes.toString('base64'),iv:iv.toString('base64'),authTag:cipher.getAuthTag().toString('base64'),lastFour:value.slice(-4)}}
function decrypt(row){const cipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(row.iv,'base64'));cipher.setAuthTag(Buffer.from(row.authTag,'base64'));return Buffer.concat([cipher.update(Buffer.from(row.ciphertext,'base64')),cipher.final()]).toString('utf8')}
function fields(data,partial=false){
  const patch={}
  if(!partial||data.callbackUrl!==undefined){const url=new URL(d.url(data.callbackUrl));if(url.protocol!=='https:')d.fail('回传地址须为 HTTPS');patch.callbackUrl=url.href}
  if(!partial||data.events!==undefined){if(!Array.isArray(data.events)||!data.events.length||data.events.length>30)d.fail('事件列表不正确');patch.events=data.events.map(x=>d.text(x,'事件名称',64))}
  if(!partial||data.status!==undefined){patch.status=data.status||'active';if(!['active','inactive'].includes(patch.status))d.fail('回传规则状态不正确')}
  return patch
}
function register(r){
  r('GET','/modules/zhihu/callbacks/rules',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const result=[];for(const row of await c.store.find('callback_rules',scope))if(await visible(c.store,c.user,row,'ownerId'))result.push(row);return d.page(result,c.data)})
  r('POST','/modules/zhihu/callbacks/rules',async c=>{
    d.duty(c.user,'operations');const scope=d.scopeOf(c.data),input={...fields(c.data),planId:d.id(c.data.planId)}
    return c.store.mutate(c.user,scope,'callback.rule.create',c.key,input,async tx=>{const plan=await require('./legacy-operations').plan(tx,c.user,scope,input.planId);const row=await tx.add('callback_rules',{...scope,...input,ownerId:plan.ownerId,createdBy:c.user.id});return {id:row.id}})
  })
  for(const method of ['PATCH','DELETE'])r(method,'/modules/zhihu/callbacks/rules/:id',async c=>{d.duty(c.user,'operations');const scope=d.scopeOf(c.data),patch=method==='DELETE'?{status:'inactive'}:fields(c.data,true);return c.store.mutate(c.user,scope,'callback.rule.update',c.key,{id:c.params.id,patch},async tx=>{const row=d.belongs(await tx.get('callback_rules',c.params.id),scope);await tx.put('callback_rules',row.id,{...row,...patch,updatedAt:d.now()});return {id:row.id}})})
  r('GET','/modules/zhihu/callbacks/secret',async c=>{d.duty(c.user,'all');const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const row=await c.store.get('callback_secrets',d.hash(scope));if(!row)d.fail('尚未生成回传密钥',404);return {signKey:'sk_live_****'+row.lastFour}})
  r('POST','/modules/zhihu/callbacks/secret/rotate',async c=>{
    d.duty(c.user,'all');const scope=d.scopeOf(c.data),encrypted=encrypt('sk_live_'+crypto.randomBytes(32).toString('hex'))
    const row=await c.store.mutate(c.user,scope,'callback.secret.rotate',c.key,scope,async tx=>{const next={...encrypted,...scope,rotatedBy:c.user.id,rotatedAt:d.now()};await tx.put('callback_secrets',d.hash(scope),next);return next})
    return {signKey:decrypt(row)}
  })
  r('GET','/modules/zhihu/callbacks/logs',async c=>{d.operate(c.user);const scope=d.scopeOf(c.data);await authorize(c.store,c.user,scope);const result=[];for(const row of await c.store.find('callback_logs',scope)){const rule=await c.store.get('callback_rules',row.ruleId);if(rule&&await visible(c.store,c.user,rule,'ownerId')&&(!c.data.status||row.status===c.data.status))result.push(row)}return d.page(result,c.data)})
}
module.exports={register}
