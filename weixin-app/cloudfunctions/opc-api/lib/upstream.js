const d=require('./domain')
const {resolveClientEndpoint}=require('../vendor/zhihu/allianceEndpointRegistry')
const {parseAllianceUpstreamRequest,prepareAllianceRequest,projectAllianceSuccess}=require('../vendor/zhihu/allianceContracts')
const {parseZhihuJson}=require('../vendor/zhihu/json')
async function request(method,path,input,file){
  const token=process.env.ZHIHU_ACCESS_TOKEN,secret=process.env.ZHIHU_SECRET_KEY
  if(!token||!secret||token.startsWith('mock_')||secret.startsWith('mock_'))d.fail('云函数尚未配置知乎上游凭据',503)
  const endpoint=resolveClientEndpoint(method,'/alliance/api'+path)
  if(!endpoint)d.fail('上游接口不支持',422)
  let params
  try{params=prepareAllianceRequest(endpoint,parseAllianceUpstreamRequest(endpoint,input),token,secret)}catch(error){if(error.name==='ZodError')d.fail('知乎上游参数不符合当前协议',422);throw error}
  const url=new URL('https://open.zhihu.com/alliance/api'+endpoint.upstreamPath)
  if(method==='GET')for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value))
  let body=method==='GET'?undefined:JSON.stringify(params),headers={'content-type':'application/json'}
  if(endpoint.requestKind==='multipart'){
    if(!file?.buffer)d.fail('请先上传批量表格',422)
    await require('../vendor/zhihu/allianceXlsx').validateAllianceXlsx(file)
    const boundary='opc-'+require('node:crypto').randomBytes(16).toString('hex'),chunks=[]
    for(const [key,value]of Object.entries(params))chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`))
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="import.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),file.buffer,Buffer.from(`\r\n--${boundary}--\r\n`))
    body=Buffer.concat(chunks);headers={'content-type':'multipart/form-data; boundary='+boundary,'content-length':String(body.length),'X-Requested-With':'XMLHttpRequest'}
  }
  const response=await require('./http').requestText(url,{method,headers,body,timeout:15000})
  if(!response.ok)throw new d.Fault(502,'知乎上游请求失败，请核对同步记录')
  const raw=parseZhihuJson(response.text)
  return projectAllianceSuccess(endpoint,raw,{}).clientData
}
function client(store){return {request:async(...args)=>{const release=await require('./quota').acquire(store);try{return await request(...args)}finally{await release()}}}}
module.exports={request,client}
