const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const esbuild=require('../../server/node_modules/esbuild')
const root=path.resolve(__dirname,'..')
const build=path.resolve(root,'../.runtime/cloud-bundles')
// 目标环境可用 --env 指定；不指定时沿用 cloudbase/deployment.json（开发环境）。
// 迁移包必须打进目标环境自己的清单，否则云端 initialize 会以
// 「迁移清单或目标环境不正确」(42200) 拒绝。
const args=process.argv.slice(2)
const flag=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]}
const targetEnv=flag('--env')||require('../cloudbase/deployment.json').environmentId
const manifest={environmentId:targetEnv,createdAt:new Date().toISOString(),functions:[]}
let snapshot=null
if(args.includes('--migration')){
  const directory=path.resolve(root,'../.runtime/cloud-migration')
  // 为新环境准备的清单由 scripts/gen-init.cjs <envId> 生成，文件名带环境 ID。
  const targeted=path.join(directory,'manifest-'+targetEnv+'.json')
  const manifestPath=fs.existsSync(targeted)?targeted:path.join(directory,'manifest.json')
  const migration=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
  if(migration.environmentId!==targetEnv)throw Error('Migration manifest targets '+migration.environmentId+', not '+targetEnv+'; run scripts/gen-init.cjs '+targetEnv+' first')
  console.log('migration manifest: '+path.relative(path.resolve(root,'..'),manifestPath))
  const batches=migration.batches.map(b=>JSON.parse(fs.readFileSync(path.join(directory,b.file),'utf8')))
  const d=require('../cloudfunctions/opc-api/lib/domain'),assets=[]
  for(const batch of batches)for(const row of batch.rows)if(row.value.migrationSource==='withdrawal_requests'&&row.value.invoicePath){
    const folder=path.resolve(root,'../server/uploads/invoices'),file=path.resolve(folder,path.basename(row.value.invoicePath))
    if(path.dirname(file)!==folder||!fs.existsSync(file))throw Error('Historical invoice is missing')
    const buffer=fs.readFileSync(file);if(buffer.length>5*1024*1024||buffer.subarray(0,5).toString()!=='%PDF-')throw Error('Historical invoice needs manual format verification')
    assets.push({withdrawalId:row.value.id,base64:buffer.toString('base64'),hash:d.hash(buffer.toString('base64'))})
  }
  snapshot={manifest:migration,batches,assets}
}
for(const name of ['opc-api','opc-worker','opc-admin']){
  const source=path.join(root,'cloudfunctions',name),destination=path.join(build,name)
  fs.mkdirSync(destination,{recursive:true})
  const result=esbuild.buildSync({entryPoints:[path.join(source,'index.js')],outfile:path.join(destination,'index.js'),bundle:true,platform:'node',format:'cjs',target:'node16',packages:'external',metafile:true,logLevel:'silent',define:{OPC_BUNDLED_MIGRATION:name==='opc-admin'&&snapshot?JSON.stringify(snapshot):'null'}})
  // Only npm/runtime imports may remain. Local subdirectories broke during a
  // Windows DevTools deployment; the upload now contains flat root files only.
  for(const item of Object.values(result.metafile.outputs).flatMap(o=>o.imports))if(item.external&&item.path.startsWith('.'))throw Error('Unbundled local import: '+item.path)
  for(const file of ['package.json','package-lock.json','config.json'])fs.copyFileSync(path.join(source,file),path.join(destination,file))
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(destination,'index.js'))).digest('hex')
  manifest.functions.push({name,directory:destination,sha256,sourceFiles:Object.keys(result.metafile.inputs).length,containsMigrationSnapshot:name==='opc-admin'&&!!snapshot})
}
fs.writeFileSync(path.join(build,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify(manifest,null,2))
