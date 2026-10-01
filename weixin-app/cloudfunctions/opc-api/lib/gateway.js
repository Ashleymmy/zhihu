// Keep deployment/migration failures inside the same envelope as business errors.
function developmentPreview(environment,config){return !!environment&&config?.enabled===true&&config.mode==='ui-preview'&&config.environmentId===environment}
function previewRequest(event){
  if(event?.method==='GET')return !/^\/modules\/zhihu\/(?:alliance\/|zhihu-content(?:\/|$))/.test(event.path||'')
  return event?.method==='POST'&&['/core/auth/login','/core/auth/wechat-login','/core/auth/register','/core/auth/bind','/core/auth/logout','/core/auth/change-password','/core/auth/profile'].includes(event.path)
}
function gateway(store,api,identity,options={}) {
  const preview=developmentPreview(options.environment,options.developmentAccess)
  return async event=>{
    const context=identity()
    if(!event || event.path!=='/system/identity') {
      try {
        const migration=await store.get('settings','migration')
        if(!migration||!preview&&migration.status!=='sealed')return {statusCode:503,code:50300,data:null,message:'云端数据迁移和验收尚未完成，业务入口暂未启用'}
      } catch (_) {
        return {statusCode:503,code:50300,data:null,message:'云数据库尚未初始化或不可用，请联系管理员'}
      }
      if(preview&&!previewRequest(event))return {statusCode:409,code:40900,data:null,message:'当前为 UI 测试模式，可查看页面，业务提交和知乎同步暂未开启'}
    }
    return api.handle(event,{openid:context.OPENID,appid:context.APPID})
  }
}
module.exports={gateway,developmentPreview}
