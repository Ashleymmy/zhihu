param(
  [switch]$ResumeAfterFailure,
  # 目标云环境。索引是每个环境各自创建的，部署到生产环境后需要在新环境重跑一次。
  [string]$EnvId = 'cloud1-d4g9ou4cd3b80d764'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot 'CloudTools.ps1')
$cli = 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd'
# 进度按环境分开保存：共用一份时，第二个环境的运行会因为 environmentId 不符而直接中止。
$stateFile = Join-Path $projectRoot ('weixin-app/cloudbase/index-apply-state-' + $EnvId + '.json')
$auditFile = Join-Path $projectRoot ('weixin-app/cloudbase/index-audit-' + $EnvId + '.json')
$directory = Join-Path $projectRoot ('.runtime/cloud-indexes/' + $EnvId)
$envId = $EnvId
New-Item -ItemType Directory -Force -Path $directory | Out-Null
function Invoke-Official([string[]]$Arguments) {
    $call = Invoke-WechatCli -Cli $cli -Arguments (@('-c','Codex') + $Arguments)
    $raw = ($call.Output | Out-String)
    if ($call.ExitCode -ne 0 -or $raw.IndexOf('{') -lt 0) { throw 'Official index operation failed; no write will be retried automatically.' }
    $response = $raw.Substring($raw.IndexOf('{')) | ConvertFrom-Json
    if (-not $response.ok) { throw 'Official index operation rejected; inspect the tool result before retrying.' }
    return $response.result
}
function Save-State { Write-Utf8NoBom -Path $stateFile -Text ($state | ConvertTo-Json -Depth 12) }
# 索引写入会返回一个待确认任务。实测该确认由开发者工具自动放行（约 3 秒），
# 因此原地轮询即可在单次运行内推进多个集合，无需人工点击或反复重跑脚本。
function Wait-Confirmation([string]$TaskId, [int]$Attempts = 30, [int]$DelaySeconds = 2) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        Start-Sleep -Seconds $DelaySeconds
        $call = Invoke-WechatCli -Cli $cli -Arguments @('-c','Codex','polling_task_result','--task-id',$TaskId)
        $raw = ($call.Output | Out-String)
        if ($call.ExitCode -ne 0 -or $raw.IndexOf('{') -lt 0) { return 'unknown' }
        try { $response = $raw.Substring($raw.IndexOf('{')) | ConvertFrom-Json } catch { return 'unknown' }
        if (-not $response.ok -or -not $response.result) { return 'unknown' }
        if ($response.result.status -ne 'pending') { return $response.result.status }
    }
    return 'pending'
}
$state = if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{ environmentId=$envId; pendingTask=$null; completedCollections=@() } }
if ($state.environmentId -ne $envId) { throw 'Index state belongs to a different environment.' }
if ($state.pendingTask) {
    $pending = $state.pendingTask
    $result = Invoke-Official @('polling_task_result','--task-id',$pending.taskId)
    $pending.status = $result.status
    Save-State
    if ($result.status -eq 'pending') { Write-Output "Waiting for the existing DevTools confirmation: $($pending.collection). No duplicate request was sent."; return }
    if ($result.status -ne 'success') {
        if ($result.status -notin @('failed','cancelled','expired') -or -not $ResumeAfterFailure) { Write-Output "Previous request: $($result.status). Review it before explicitly running with -ResumeAfterFailure."; return }
    }
    $state.pendingTask = $null
    Save-State
}
# Refresh actual definitions before every continuation; never rely on a stale plan.
& (Join-Path $PSScriptRoot 'audit-cloud-indexes.ps1') -EnvId $envId
$audit = Get-Content -LiteralPath $auditFile -Raw | ConvertFrom-Json
foreach ($group in @($audit.checks | Where-Object { -not $_.present } | Group-Object collection)) {
    $create = @($group.Group | ForEach-Object { @{IndexName=$_.indexName; MgoKeySchema=@{MgoIndexKeys=@($_.fields | ForEach-Object { @{Name=$_; Direction='1'} }); MgoIsUnique=$false}} })
    $optionsFile = Join-Path $directory ($group.Name + '-create.json')
    Write-Utf8NoBom -Path $optionsFile -Text (@{CreateIndexes=$create} | ConvertTo-Json -Depth 12)
    $result = Invoke-Official @('cloud_db_write_struct','--appid','wx22b91776ccf37354','--env',$envId,'--action','updateCollection','--collection-name',$group.Name,'--update-options-file',$optionsFile)
    if ($result.status -eq 'pending' -and $result.taskId) {
        $state.pendingTask = [pscustomobject]@{taskId=$result.taskId; tool='cloud_db_write_struct'; collection=$group.Name; indexCount=$create.Count; status='pending'}
        Save-State
        Write-Output "Submitted $($create.Count) index(es) for $($group.Name); awaiting confirmation..."
        $confirmed = Wait-Confirmation -TaskId $result.taskId
        if ($confirmed -eq 'success') {
            $state.pendingTask = $null
        } else {
            $state.pendingTask.status = $confirmed
            Save-State
            Write-Output "Confirmation for $($group.Name) is '$confirmed'. Confirm it in DevTools, then run this script again."
            return
        }
    } elseif (-not $result.success) {
        throw "Index creation was not confirmed successful: $($group.Name). No retry was sent."
    }
    $state.completedCollections = @($state.completedCollections) + $group.Name
    Save-State
}
& (Join-Path $PSScriptRoot 'audit-cloud-indexes.ps1') -EnvId $envId
