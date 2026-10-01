const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),source=path.join(root,'cloudfunctions/opc-api')
const workerConfig=JSON.parse(fs.readFileSync(path.join(root,'cloudfunctions/opc-worker/config.json'),'utf8'))
const timer=workerConfig.triggers?.find(item=>item.name==='opc-jobs-every-minute')
assert.equal(timer?.type,'timer','worker timer trigger missing')
// https://docs.cloudbase.net/cloud-function/timer-trigger requires seven fields,
// including the year. Code deployment does not upload the trigger definition.
assert.match(timer?.config||'', /^\S+(?:\s+\S+){6}$/,'CloudBase timer config must use seven cron fields including year')
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'?[]:walk(path.join(dir,e.name))):[path.join(dir,e.name)])
for(const file of walk(path.join(root,'cloudfunctions')).filter(f=>!f.includes('quickstartFunctions'))){if(file.endsWith('.js'))new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});if(file.endsWith('.json'))JSON.parse(fs.readFileSync(file,'utf8'))}
for(const [relative,hash]of Object.entries(JSON.parse(fs.readFileSync(path.join(source,'vendor/provenance.json'))))){const file=path.resolve(root,'../server/src/modules/zhihu',relative);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,'Vendor source changed: '+relative)}
for(const name of ['opc-worker','opc-admin'])for(const file of walk(source).filter(f=>/[/\\](lib|vendor)[/\\]/.test(f)&&!f.includes('node_modules'))){const copy=path.join(root,'cloudfunctions',name,path.relative(source,file));assert.ok(fs.existsSync(copy),'Run npm run cloud:package');assert.ok(fs.readFileSync(file).equals(fs.readFileSync(copy)),'Stale package: '+copy)}
const routes=require('../cloudfunctions/opc-api/lib/api').createAPI(null,null,'check').routes,keys=routes.map(r=>r.method+' '+r.path)
assert.equal(new Set(keys).size,keys.length,'Duplicate cloud API route')
console.log('Cloud syntax, vendored sources and deployment copies verified; '+routes.length+' registered handlers')
console.log('Release readiness: '+(require('../cloudfunctions/opc-api/release.json').ready?'requires cloud acceptance':'blocked; see cloudfunctions/opc-api/release.json'))
