const d=require('./domain')
const auth=require('./auth')
const PUBLIC_PATHS=['/core/auth/login','/core/auth/wechat-login','/core/auth/register','/core/auth/bind']
function createAPI(store,cloud,environment,extra={}){
  const routes=[]
  const r=(method,path,handler)=>{const names=[];const pattern=path.replace(/:[A-Za-z_]+/g,key=>{names.push(key.slice(1));return '([^/]+)'});routes.push({method,path,regex:new RegExp('^'+pattern+'$'),names,handler})}
  r('POST','/core/auth/login',c=>auth.login(c.store,c.data,c.identity))
  r('POST','/core/auth/wechat-login',c=>auth.wechatLogin(c.store,c.data,c.identity))
  r('POST','/core/auth/register',c=>auth.registerAccount(c.store,c.data,c.identity))
  r('POST','/core/auth/bind',c=>auth.bindWechat(c.store,c.data,c.identity))
  r('GET','/core/auth/me',c=>d.safeUser(c.user))
  r('POST','/core/auth/logout',async c=>{await c.store.remove('sessions',d.hash(c.token));return null})
  r('POST','/core/auth/change-password',c=>auth.changePassword(c.store,c.user,c.data))
  r('POST','/core/auth/profile',c=>auth.updateProfile(c.store,c.user,c.data))
  for(const feature of [require('./core'),require('./keywords'),require('./prices'),require('./finance'),require('./files'),require('./imports'),require('./catalog'),require('./management'),require('./courses'),require('./routing'),require('./legacy-finance'),require('./attribution-tools'),require('./platform'),require('./relay'),require('./statements'),require('./legacy-operations'),require('./legacy-jobs'),require('./callbacks'),require('./transitions'),require('./alliance'),require('./invite')])feature.register(r)
  // The Zhihu project screens use the same platform project/membership service.
  for(const route of routes.slice())if(route.path==='/core/projects'||route.path.startsWith('/core/projects/:id')&&!route.path.includes('/integrations'))r(route.method,route.path.replace('/core/projects','/modules/zhihu/projects'),route.handler)
  async function handle(event,identity){
    const requestId=d.uid()
    try{
      if(!identity?.openid||identity.appid!=='wx22b91776ccf37354')d.fail('请从本小程序调用云函数',403)
      if(!event||typeof event.path!=='string'||event.path.length>200||!['GET','POST','PUT','PATCH','DELETE'].includes(event.method))d.fail('请求格式不正确')
      if(event.path==='/system/identity'&&event.method==='GET')return {statusCode:200,code:0,data:{openid:identity.openid,environment},message:'ok',requestId}
      const requestLimit=event.method==='POST'&&/^\/core\/files\/[^/]+\/upload-chunk$/.test(event.path)?require('./file-relay').REQUEST_BYTES:128*1024
      if(event.data&&JSON.stringify(event.data).length>requestLimit)d.fail('请求过大，请分片上传文件',413)
      const found=routes.find(route=>route.method===event.method&&route.regex.test(event.path))
      if(!found)d.fail('此接口尚未迁入云端，请查看迁移清单',501)
      const user=PUBLIC_PATHS.includes(event.path)?null:await auth.authenticate(store,event.token,identity)
      if(user?.mustChangePwd&&!['/core/auth/me','/core/auth/change-password','/core/auth/logout'].includes(event.path))d.fail('请先修改临时密码',403)
      const params={},matched=event.path.match(found.regex);found.names.forEach((key,i)=>params[key]=matched[i+1])
      const data=event.data||{},context={store,cloud,environment,identity,user,params,data,key:event.requestKey||data.requestKey,token:event.token,upstream:extra.upstream||require('./upstream').client(store)}
      const result=await found.handler(context)
      return {statusCode:200,code:0,data:result??null,message:'ok',requestId}
    }catch(error){
      const status=error.status||422*(error.name==='ZodError')||500
      if(status===500)console.error(JSON.stringify({requestId,message:'cloud_api_error',code:error.code||error.errCode||'unknown'}))
      const diagnostic=status===500&&environment==='acceptance'?require('./migration-diagnostic').diagnostic(error,'acceptance.api:'+event.path):undefined
      return {statusCode:status,code:error.code&&typeof error.code==='number'?error.code:status*100,data:null,message:status===500?'云服务暂时不可用，请联系管理员并提供请求编号':error.name==='ZodError'?'请求参数不正确':error.message,requestId,...(diagnostic?{diagnostic}:{})}
    }
  }
  return {handle,routes}
}
module.exports={createAPI}
