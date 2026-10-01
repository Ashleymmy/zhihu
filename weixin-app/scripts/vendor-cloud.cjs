const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const ts=require('../../server/node_modules/typescript')
const source=path.resolve(__dirname,'../../server/src/modules/zhihu')
const target=path.resolve(__dirname,'../cloudfunctions/opc-api/vendor')
const files=['zhihu/allianceEndpointRegistry.ts','zhihu/allianceContracts.ts','zhihu/allianceXlsx.ts','zhihu/json.ts','zhihu/composition.ts','sign/zhihu.ts','attribution/report.ts','attribution/domain.ts']
const provenance={}
for(const relative of files){
  const original=fs.readFileSync(path.join(source,relative),'utf8')
  provenance[relative]=crypto.createHash('sha256').update(original).digest('hex')
  let code=ts.transpileModule(original,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  if(['attribution/domain.ts','zhihu/composition.ts'].includes(relative))code=code.replace('require("../../../middleware/errors")','require("../errors")')
  const file=path.join(target,relative.replace(/\.ts$/,'.js'));fs.mkdirSync(path.dirname(file),{recursive:true})
  fs.writeFileSync(file,'// Generated from server/src/modules/zhihu/'+relative+'; do not edit.\n'+code)
}
fs.writeFileSync(path.join(target,'errors.js'),"class AppError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code } }\nmodule.exports = { AppError }\n")
fs.writeFileSync(path.join(target,'provenance.json'),JSON.stringify(provenance,null,2)+'\n')
console.log('Generated cloud adapters from '+files.length+' existing TypeScript sources')
