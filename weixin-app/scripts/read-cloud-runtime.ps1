param(
    # 目标云环境。运行时验收记录每个环境各存一份。
    [string]$EnvId = 'cloud1-d4g9ou4cd3b80d764'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeDirectory = Join-Path $projectRoot '.runtime/cloud-migration'
$queryPath = Join-Path $runtimeDirectory 'runtime-query.json'
$rawPath = Join-Path $runtimeDirectory ('runtime-readback-' + $EnvId + '.json')
. (Join-Path $PSScriptRoot 'CloudTools.ps1')
Write-Utf8NoBom -Path $queryPath -Text '{"_id":"runtime-acceptance"}'
$call = Invoke-WechatCli -Cli 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd' -Arguments @('-c','Codex','cloud_db_read_doc','--appid','wx22b91776ccf37354','--env',$EnvId,'--collection-name','opc_settings','--query-file',$queryPath,'--limit','1')
if ($call.ExitCode -ne 0) { throw 'Cloud runtime readback failed' }
$result = $call.Output
Write-Utf8NoBom -Path $rawPath -Text ($result -join "`r`n")
@'
const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2],envId=process.argv[3],raw=fs.readFileSync(path.join(root,'.runtime/cloud-migration/runtime-readback-'+envId+'.json'),'utf8');
const response=JSON.parse(raw.slice(raw.indexOf('{')));
if(!response.ok||!response.result?.success)throw Error('Official cloud read failed');
const record=response.result.data?.[0];
if(!record)throw Error('Runtime acceptance record not available');
const {_id,...result}=record;
const report={environmentId:envId,readBackAt:new Date().toISOString(),...result};
fs.writeFileSync(path.join(root,'weixin-app/cloudbase/runtime-acceptance-'+envId+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
'@ | node - $projectRoot $EnvId
if ($LASTEXITCODE -ne 0) { throw 'Cloud runtime report validation failed' }
