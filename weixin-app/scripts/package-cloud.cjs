const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../cloudfunctions')
const source=path.join(root,'opc-api')
for(const name of ['opc-worker','opc-admin']){
  const destination=path.join(root,name)
  fs.mkdirSync(destination,{recursive:true})
  // These copies are generated deployment bundles, never application source.
  for(const folder of ['lib','vendor'])fs.cpSync(path.join(source,folder),path.join(destination,folder),{recursive:true})
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'))
  pkg.name='timo-'+name
  fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify(pkg,null,2)+'\n')
  fs.copyFileSync(path.join(source,'package-lock.json'),path.join(destination,'package-lock.json'))
  const lock=JSON.parse(fs.readFileSync(path.join(destination,'package-lock.json'),'utf8'))
  lock.name=pkg.name;lock.packages[''].name=pkg.name
  fs.writeFileSync(path.join(destination,'package-lock.json'),JSON.stringify(lock,null,2)+'\n')
  fs.copyFileSync(path.join(source,'release.json'),path.join(destination,'release.json'))
}
console.log('Prepared opc-api, opc-worker, opc-admin cloud function packages')
