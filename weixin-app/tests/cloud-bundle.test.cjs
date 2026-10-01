const test=require('node:test')
const assert=require('node:assert/strict')
const path=require('node:path')
const vm=require('node:vm')
const {createRequire}=require('node:module')
const esbuild=require('../../server/node_modules/esbuild')
const {memory}=require('./cloud-memory.cjs')
const source=path.resolve(__dirname,'../cloudfunctions/opc-api/index.js')
test('single-file cloud artifact starts without source folders and serves identity/migration gate',async()=>{
  const build=esbuild.buildSync({entryPoints:[source],bundle:true,platform:'node',format:'cjs',target:'node16',packages:'external',write:false,logLevel:'silent'})
  const db=memory(),mod={exports:{}},deps=createRequire(source)
  let trustedIdentity={OPENID:'test',APPID:'wx22b91776ccf37354'}
  const cloud={DYNAMIC_CURRENT_ENV:'dynamic',init(){},database:()=>db.db,getWXContext:()=>trustedIdentity}
  const context={module:mod,exports:mod.exports,require:name=>{assert.ok(!name.startsWith('.'),'relative source dependency leaked');return name==='wx-server-sdk'?cloud:deps(name)},process,console,Buffer,URL,setTimeout,clearTimeout}
  vm.runInNewContext(build.outputFiles[0].text,context)
  const identity=await mod.exports.main({method:'GET',path:'/system/identity'})
  assert.equal(identity.code,0)
  assert.equal(identity.data.environment,'cloud1-d4g9ou4cd3b80d764')
  assert.equal((await mod.exports.main({method:'GET',path:'/core/auth/me'})).code,50300)
  assert.equal((await mod.exports.main({action:'runtime-readiness',SOURCE:'wx_cloud'})).code,40300)
  trustedIdentity={APPID:'wx22b91776ccf37354',SOURCE:'wx_cloud'}
  assert.equal((await mod.exports.main({action:'runtime-readiness'})).code,40300)
  const {invoke}=require('../cloudfunctions/opc-api/lib/runtime-readiness')
  const ready=await invoke(db.store,{callFunction:async({data})=>({result:await mod.exports.main(data)})},'opc-api')
  assert.equal(ready.code,0)
})

test('worker bundle retains business identity gate and rejects client source forged in event',async()=>{
  const worker=path.resolve(__dirname,'../cloudfunctions/opc-worker/index.js')
  const build=esbuild.buildSync({entryPoints:[worker],bundle:true,platform:'node',format:'cjs',target:'node16',packages:'external',write:false,logLevel:'silent'})
  const db=memory(),mod={exports:{}},deps=createRequire(source)
  let identity={OPENID:'client',APPID:'wx22b91776ccf37354',SOURCE:'wx_client'}
  const cloud={DYNAMIC_CURRENT_ENV:'dynamic',init(){},database:()=>db.db,getWXContext:()=>identity}
  vm.runInNewContext(build.outputFiles[0].text,{module:mod,exports:mod.exports,require:name=>name==='wx-server-sdk'?cloud:deps(name),process,console,Buffer,URL,setTimeout,clearTimeout})
  assert.equal((await mod.exports.main({action:'runtime-readiness',SOURCE:'wx_cloud'})).code,40300)
  identity={APPID:'wx22b91776ccf37354',SOURCE:'wx_cloud'}
  assert.equal((await mod.exports.main({})).code,40300)
  identity={}
  assert.equal((await mod.exports.main({})).code,50300)
  identity={APPID:'wx22b91776ccf37354',SOURCE:'wx_client,wx_cloud'}
  assert.equal((await mod.exports.main({})).code,40300)
})
