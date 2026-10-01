param(
  [string]$Cli = 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  # 必须显式指定目标云环境，避免把体验版后端误传到旧开发环境。
  # 注意本脚本上传的是代码，不注册触发器：触发器要用
  #   tcb fn trigger create opc-worker --trigger-name opc-jobs-every-minute --cron "0 * * * * * *"
  # 上传后请回读 worker-heartbeat 确认心跳，代码部署成功不等于触发器已生效。
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Environment
)
$ErrorActionPreference = 'Stop'
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$environment = $Environment
if (!(Test-Path -LiteralPath $Cli)) { throw '未找到微信开发者工具 CLI，请通过 -Cli 指定安装路径。' }
Push-Location $project
try {
  foreach ($task in @('cloud:package', 'test', 'check:wechat', 'cloud:routes', 'cloud:check')) {
    & npm.cmd run $task
    if ($LASTEXITCODE -ne 0) { throw "检查未通过：$task" }
  }
  & npm.cmd run cloud:bundle -- --env $environment
  if ($LASTEXITCODE -ne 0) { throw '目标环境云函数打包失败。' }
  $ErrorActionPreference = 'Continue'
  $inventory = (& $Cli cloud env list --project $project 2>&1 | Out-String)
  $ErrorActionPreference = 'Stop'
  # Some DevTools versions exit 0 even after reporting a CLI failure.
  if ($LASTEXITCODE -ne 0 -or $inventory -match '\[error\]|服务端口已关闭|service port disabled') {
    Write-Output $inventory
    throw '无法连接开发者工具。请在主窗口“设置 → 安全设置”开启服务端口，并确认已登录。'
  }
  if (!$inventory.Contains($environment)) { throw '当前开发者工具账号未返回指定云环境，停止部署。' }
  $bundleRoot = [System.IO.Path]::GetFullPath((Join-Path $project '../.runtime/cloud-bundles'))
  $paths = @('opc-api','opc-worker','opc-admin') | ForEach-Object { Join-Path $bundleRoot $_ }
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    $result = (& $Cli cloud functions deploy --env $environment --paths $paths --appid wx22b91776ccf37354 --remote-npm-install 2>&1 | Out-String)
    Write-Output $result
    if ($LASTEXITCODE -eq 0 -and $result -notmatch '\[error\]') { break }
    if ($attempt -lt 2 -and $result -match 'Creating状态') {
      Write-Output '首次创建仍在进行，15 秒后重新上传同一代码包。'
      Start-Sleep -Seconds 15
      continue
    }
    throw '云函数部署失败，请检查上方输出。'
  }
  Write-Output '云函数上传命令已完成。仍须核对运行时、环境变量、权限规则、触发器及迁移验收；业务入口不会自动开放。'
} finally { Pop-Location }
