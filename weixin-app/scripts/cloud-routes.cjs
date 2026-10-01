const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..'),out=path.join(root,'weixin-app/cloudbase')
const source=[]
function read(file){return fs.readFileSync(path.join(root,file),'utf8')}
function add(file,prefix,router){
  const code=read(file)
  for(const match of code.matchAll(/(\w+)\.(get|post|patch|put|delete)\(\s*['"]([^'"]+)['"]/g)){
    if(router&&router!==match[1])continue
    source.push({file,router:match[1],method:match[2].toUpperCase(),path:(prefix+(match[3]==='/'?'':match[3]))||'/'})
  }
}
const core=read('server/src/core/app.ts'),moduleCode=read('server/src/modules/zhihu/module.ts')
const coreImports={}
for(const match of core.matchAll(/import\s*{([^}]+)}\s*from\s*'([^']+)'/g))for(const name of match[1].split(',').map(s=>s.trim()))coreImports[name]=path.posix.normalize('server/src/core/'+match[2]+'.ts')
for(const match of core.matchAll(/\['([^']+)', (\w+Router)\]/g))add(coreImports[match[2]],'/core/'+match[1],match[2])
add('server/src/core/routes.ts','/core','r');add('server/src/core/finance-routes.ts','/core/finance','financeRouter');add('server/src/core/staff.ts','/core/staff','staffRouter')
const imports={}
for(const match of moduleCode.matchAll(/import { (\w+) } from '(\.\/routes\/[^']+)'/g))imports[match[1]]='server/src/modules/zhihu/'+match[2].slice(2)+'.ts'
for(const match of moduleCode.matchAll(/\['([^']+)', (\w+)\]/g))add(imports[match[2]],'/modules/zhihu/'+match[1],match[2])
add(imports.attributionRouter,'/modules/zhihu','attributionRouter')
const native=require('../cloudfunctions/opc-api/lib/api').createAPI(null,null,'inventory').routes.map(({method,path})=>({method,path}))
const norm=p=>p.replace(/:[A-Za-z]+/g,':param'),key=r=>r.method+' '+norm(r.path)
const keys=new Set(native.map(key))
const transitions=require('../cloudbase/route-transitions.json')
const rows=source.map(r=>{const decision=transitions[r.method+' '+r.path];if(decision)return {...r,...decision};const expanded=r.path==='/modules/zhihu/bindings/:id/:action'&&['assign','activate','request-release','release','stop'].every(action=>keys.has(key({...r,path:r.path.replace(':action',action)})));return {...r,status:keys.has(key(r))||expanded?'handler-present-contract-unverified':'pending'}})
const report={note:'Matching method/path indicates a handler only, not verified behavioral parity. Replaced interfaces and missing upstream contracts are counted separately, never as implemented business handlers.',counts:{source:source.length,native:native.length,matchingHandlers:rows.filter(r=>r.status==='handler-present-contract-unverified').length,replaced:rows.filter(r=>r.status==='replaced').length,upstreamBlocked:rows.filter(r=>r.status==='upstream-contract-blocked').length,pending:rows.filter(r=>r.status==='pending').length},additionalPending:['Live upstream acceptance of the implemented alliance quota, durable jobs and multipart protocols','Real CloudBase permissions, transactions, indexes and large-report recovery acceptance'],sourceLimitations:['Original callbacks module stores configuration only; no dispatcher or inbound signed callback implementation existed'],routes:rows}
fs.writeFileSync(path.join(out,'source-routes.json'),JSON.stringify(source,null,2)+'\n')
fs.writeFileSync(path.join(out,'native-routes.json'),JSON.stringify(native,null,2)+'\n')
fs.writeFileSync(path.join(out,'route-coverage.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report.counts))
