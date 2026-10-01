const https=require('node:https')
// Node 16 is still the runtime provided by this WeChat environment.
function requestText(url,options={},transport=https){
  return new Promise((resolve,reject)=>{
    let settled=false
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result)}
    const req=transport.request(url,{method:options.method||'GET',headers:options.headers},res=>{
      if(res.statusCode>=300&&res.statusCode<400){res.resume();finish(Error('Redirect refused'));return}
      const chunks=[];let size=0
      res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){req.destroy(Error('Response too large'));return}chunks.push(chunk)})
      res.on('error',finish);res.on('aborted',()=>finish(Error('Response aborted')))
      res.on('end',()=>finish(null,{ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,text:Buffer.concat(chunks).toString('utf8')}))
    })
    const timer=setTimeout(()=>req.destroy(Error('Upstream deadline exceeded')),options.timeout||15000)
    req.on('error',finish)
    if(options.body)req.write(options.body)
    req.end()
  })
}
module.exports={requestText}
