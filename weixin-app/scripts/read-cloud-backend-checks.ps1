param(
    # 目标云环境。心跳与验收记录都是每个环境各自的，回读必须指向同一个环境。
    [string]$EnvId = 'cloud1-d4g9ou4cd3b80d764'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$directory = Join-Path $projectRoot '.runtime/cloud-migration'
. (Join-Path $PSScriptRoot 'CloudTools.ps1')
foreach ($recordId in @('worker-heartbeat','business-acceptance')) {
    $queryFile = Join-Path $directory ($recordId + '-query.json')
    Write-Utf8NoBom -Path $queryFile -Text (@{_id=$recordId} | ConvertTo-Json -Compress)
    $call = Invoke-WechatCli -Cli 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd' -Arguments @('-c','Codex','cloud_db_read_doc','--appid','wx22b91776ccf37354','--env',$EnvId,'--collection-name','opc_settings','--query-file',$queryFile,'--limit','1')
    if ($call.ExitCode -ne 0) { throw "Cloud check read failed: $recordId" }
    $raw = $call.Output
    Write-Utf8NoBom -Path (Join-Path $directory ($recordId + '-readback-' + $EnvId + '.json')) -Text ($raw -join "`r`n")
}
@'
const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2],envId=process.argv[3],result={checkedAt:new Date().toISOString(),environmentId:envId};
for(const id of ['worker-heartbeat','business-acceptance']){
 const raw=fs.readFileSync(path.join(root,'.runtime/cloud-migration',id+'-readback-'+envId+'.json'),'utf8'),response=JSON.parse(raw.slice(raw.indexOf('{')));
 if(!response.ok||!response.result?.success)throw Error('Read failed: '+id);
 const row=response.result.data?.[0];
 result[id]=!row?{observed:false}:id==='business-acceptance'?{observed:true,status:row.status,stage:row.stage,checks:row.checks,failedStage:row.failedStage||null,diagnostic:row.failure||null,checkedAt:row.checkedAt}:{observed:true,lastTriggeredAt:row.lastTriggeredAt,runs:row.runs,outcome:row.outcome,triggerName:row.triggerName};
}
fs.writeFileSync(path.join(root,'weixin-app/cloudbase/backend-checks-'+envId+'.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
'@ | node - $projectRoot $EnvId
if ($LASTEXITCODE -ne 0) { throw 'Backend check readback failed' }
