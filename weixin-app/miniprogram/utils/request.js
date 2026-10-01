const env = require('../config/env')
// 唯一传输方式是 wx.cloud.callFunction。旧版曾保留一条指向 env.apiBaseUrl 的
// HTTP 分支，但 env 从未定义该字段，运行时必然抛错，已于 2026-09-18 移除。
let initialized = false
function initializeCloud() {
  if (!wx.cloud) throw new Error('当前微信版本不支持云开发，请升级后重试')
  if (!env.cloudEnv) throw new Error('请先配置微信云开发环境 ID')
  if (!initialized) { wx.cloud.init({ env: env.cloudEnv, traceUser: true }); initialized = true }
}
function errorOf(response) {
  const body=response.data||{},error=new Error(body.message||'云服务请求失败')
  error.status=response.statusCode;error.code=body.code||'NETWORK_ERROR';error.requestId=body.requestId;return error
}
function request(path,options={}) {
  const token=options.auth===false?'':wx.getStorageSync('zk_access_token')
  return new Promise((resolve,reject)=>{
    const success=response=>{
      if(token&&token!==wx.getStorageSync('zk_access_token')){const e=new Error('会话已更新，请重新加载');e.code='SESSION_CHANGED';reject(e);return}
      if(response.statusCode===401){if(options.auth!==false)getApp().handleUnauthorized();reject(errorOf(response));return}
      const body=response.data||{}
      if(response.statusCode<200||response.statusCode>=300||body.code!==undefined&&body.code!==0){reject(errorOf(response));return}
      resolve(body.code===undefined?body:body.data)
    }
    const fail=error=>{
      const detail=error.errMsg||error.message||''
      let message='无法连接微信云服务，请检查网络和云环境配置'
      if(/FUNCTION_NOT_FOUND|function.*not.*found|云函数不存在/i.test(detail))message='尚未部署 opc-bridge 云函数，请先完成云端部署'
      else if(/timeout/i.test(detail))message='云服务响应超时，请稍后重试'
      const e=new Error(message);e.code='NETWORK_ERROR';e.detail=detail;reject(e)
    }
    try{initializeCloud()}catch(error){reject(error);return}
    wx.cloud.callFunction({name:env.functionName,config:{env:env.cloudEnv},data:{path,method:options.method||'GET',data:options.data||{},token:token||undefined},
      success(result){const value=result.result;if(!value||typeof value.code!=='number'){reject(new Error('云函数返回格式不正确'));return}success({statusCode:value.statusCode|| (value.code===0?200:500),data:value})},fail})
  })
}
module.exports={send:request,initializeCloud,
  get:(path,data)=>request(path,{method:'GET',data}),
  post:(path,data)=>request(path,{method:'POST',data}),
  patch:(path,data)=>request(path,{method:'PATCH',data}),
  put:(path,data)=>request(path,{method:'PUT',data}),
  del:(path,data)=>request(path,{method:'DELETE',data})}
