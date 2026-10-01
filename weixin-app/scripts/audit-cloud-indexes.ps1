param(
  # 目标云环境。索引是每个环境各自创建的：回读必须与创建指向同一个环境，
  # 否则会把开发环境的 44 条索引误当成新环境已就绪。
  [string]$EnvId = 'cloud1-d4g9ou4cd3b80d764'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot 'CloudTools.ps1')
$directory = Join-Path $projectRoot ('.runtime/cloud-indexes/' + $EnvId)
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$plan = Get-Content (Join-Path $projectRoot 'weixin-app/cloudbase/indexes.json') -Raw | ConvertFrom-Json
foreach ($name in $plan.indexes.PSObject.Properties.Name) {
    $call = Invoke-WechatCli -Cli 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd' -Arguments @('-c','Codex','cloud_db_read_struct','--appid','wx22b91776ccf37354','--env',$EnvId,'--action','listIndexes','--collection-name',$name)
    if ($call.ExitCode -ne 0) { throw "Index read failed: $name" }
    $response = $call.Output
    Write-Utf8NoBom -Path (Join-Path $directory ($name + '.json')) -Text ($response -join "`r`n")
}
@'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[2],envId=process.argv[3],plan=JSON.parse(fs.readFileSync(path.join(root,'weixin-app/cloudbase/indexes.json'),'utf8')),checks=[];
for(const [name,desired]of Object.entries(plan.indexes)){
  const raw=fs.readFileSync(path.join(root,'.runtime/cloud-indexes',envId,name+'.json'),'utf8'),response=JSON.parse(raw.slice(raw.indexOf('{')));
  if(!response.ok||!response.result?.success)throw Error('Index read failed: '+name);
  const indexes=response.result.indexes||[];
  for(const fields of desired){
    const present=indexes.find(index=>JSON.stringify(index.Keys?.map(k=>k.Name))===JSON.stringify(fields)&&index.Keys.every(k=>String(k.Direction)==='1'));
    const indexName='opc_q_'+crypto.createHash('sha256').update(fields.join('|')).digest('hex').slice(0,12);
    checks.push({collection:name,indexName:present?.Name||indexName,fields,present:!!present});
  }
}
const report={checkedAt:new Date().toISOString(),environmentId:envId,status:checks.every(c=>c.present)?'definitions-present-build-status-unverified':'missing',desired:checks.length,present:checks.filter(c=>c.present).length,missing:checks.filter(c=>!c.present).length,checks};
fs.writeFileSync(path.join(root,'weixin-app/cloudbase/index-audit-'+envId+'.json'),JSON.stringify(report,null,2)+'\n');
const md=['# 待创建的查询索引（'+envId+'）','','云开发控制台 → 数据库 → 对应集合 → 索引管理。下表均为升序、非唯一索引；已有 _id/_openid 索引保留。不要删除其他索引。','', '| 集合 | 索引名 | 字段顺序（全部升序） |','|---|---|---|'];
for(const row of checks.filter(c=>!c.present))md.push('| '+row.collection+' | '+row.indexName+' | '+row.fields.join(' → ') +' |');
md.push('','创建后等状态为正常，再运行 `scripts/audit-cloud-indexes.ps1 -EnvId '+envId+'` 回读。字段存在不等于查询计划和负载性能已通过；需结合真实数据复核。','');
fs.writeFileSync(path.join(root,'weixin-app/cloudbase/INDEXES-TO-APPLY-'+envId+'.md'),md.join('\n'));
console.log(JSON.stringify({environmentId:envId,desired:report.desired,present:report.present,missing:report.missing}));
'@ | node - $projectRoot $EnvId
if ($LASTEXITCODE -ne 0) { throw 'Index audit failed' }
