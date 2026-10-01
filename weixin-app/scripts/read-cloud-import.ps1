param(
  [string]$Cli = 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd',
  [string[]]$CollectionsToRead = @()
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CloudTools.ps1')
$migrationDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.runtime/cloud-migration'))
$manifest = Get-Content -LiteralPath (Join-Path $migrationDirectory 'manifest.json') -Raw | ConvertFrom-Json
$destination = Join-Path $migrationDirectory 'cloud-readback'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$collections = @($manifest.targetCounts.PSObject.Properties.Name) + @('settings')
if ($CollectionsToRead.Count) { $collections = @($collections | Where-Object { $_ -in $CollectionsToRead }) }
foreach ($collection in $collections) {
  if ($collection -notmatch '^[a-z_]+$') { throw 'Invalid collection name in manifest' }
  $documents = @()
  for ($offset = 0; ; $offset += 100) {
    $call = Invoke-WechatCli -Cli $Cli -Arguments @('-c','Codex','cloud_db_read_doc','--appid','wx22b91776ccf37354','--env',$manifest.environmentId,'--collection-name',"opc_$collection",'--limit','100','--offset',$offset)
    $text = $call.Output -join "`n"
    Write-Utf8NoBom -Path (Join-Path $destination "$collection-page-$offset.response.json") -Text $text
    # Keep data out of command output, including JSON parser error messages.
    try { $response = $text.Substring($text.IndexOf('{')) | ConvertFrom-Json } catch { throw "Unable to parse readback for $collection; sensitive payload omitted" }
    if ($response.ok -ne $true -or $response.result.success -ne $true) { throw "Cloud readback failed for $collection; sensitive payload omitted" }
    $page = @($response.result.data)
    $documents += $page
    if ($page.Count -lt 100) { break }
    if ($offset -ge 2000) { throw 'Readback exceeds the bounded verification limit' }
  }
  # Parse the original JSON in Node: PowerShell can convert ISO strings to DateTime,
  # changing timezone spelling and breaking exact source-content hash comparison.
  node -e 'const fs=require("fs"),path=require("path"),[dir,name,last]=process.argv.slice(1),rows=[];for(let offset=0;offset<=Number(last);offset+=100){const raw=fs.readFileSync(path.join(dir,name+"-page-"+offset+".response.json"),"utf8");rows.push(...JSON.parse(raw.slice(raw.indexOf("{"))).result.data)}fs.writeFileSync(path.join(dir,name+".json"),JSON.stringify(rows));' $destination $collection $offset
  if ($LASTEXITCODE -ne 0) { throw "Unable to preserve raw readback for $collection" }
  Write-Output "Read opc_${collection}: $($documents.Count) documents (private local file)"
}
