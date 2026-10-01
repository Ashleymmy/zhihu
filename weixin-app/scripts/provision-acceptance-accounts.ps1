# 准备五角色验收账号：通过小程序自身的云函数链路（真实 OPENID 会话）执行，不直连数据库。
#
# 为什么要有这个脚本：真机/模拟器五角色验收需要达人、团长、运营管理员、财务管理员
# 各自可登录，而迁移过来的旧账号密码只有 admin 已知。这里由 admin 会话调用
#   POST /core/team/members/:id/reset-password   重置已有达人/团长账号的密码
#   POST /core/staff                             新建运营/财务管理员（历史数据里没有）
#   POST /core/projects/:id/members              给达人/团长项目权限，作用域页面才有数据
# 账号与密码只写入本地忽略目录（.runtime/），不进仓库、不进聊天。
#
# 每一步单独调用一次自动化：自动化的响应等待时间很短，一次调用里串太多云请求会超时。
#
# 用法：
#   $env:WEIXIN_ACCEPTANCE_PASSWORD = '<admin 密码>'
#   & .\scripts\provision-acceptance-accounts.ps1
param(
    [string]$Cli = 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd',
    [string]$Project = '',
    [string]$Environment = 'test-opc-app-d3gki762bfb61da92',
    [string]$AdminUsername = 'admin',
    [string]$AdminPassword = $env:WEIXIN_ACCEPTANCE_PASSWORD,
    # 给验收账号设置的统一密码；写入本地凭据文件，便于模拟器/真机复测。
    [string]$AccountPassword = $env:WEIXIN_ACCEPTANCE_ACCOUNT_PASSWORD,
    [string]$ProjectId = '1',
    [string]$OutputFile = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CloudTools.ps1')

if (-not $Project) { $Project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not $AdminPassword) { throw '请通过 -AdminPassword 或 WEIXIN_ACCEPTANCE_PASSWORD 提供 admin 密码。' }
if (-not $AccountPassword) { $AccountPassword = 'OpcTest#2026' }
if (-not $OutputFile) { $OutputFile = Join-Path (Split-Path $Project -Parent) '.runtime/weixin-acceptance/accounts.local.json' }
New-Item -ItemType Directory -Force -Path (Split-Path $OutputFile -Parent) | Out-Null

# 步骤清单：先重置已有账号的密码，再补建缺失的运营/财务管理员，最后给达人/团长项目权限。
$steps = @(
    [pscustomobject]@{ action='reset-password'; username='test1'; role='creator'; duty=''; label='重置达人 test1 密码' },
    [pscustomobject]@{ action='reset-password'; username='test2'; role='leader'; duty=''; label='重置团长 test2 密码' },
    # pwtest 的 parentId 是 test2：团长必须有一个自己的下属，否则「团队成员/分配/审核」这些
    # 团长专属链路无数据可测（test1 的 parent 是 admin，不在 test2 的团队里）。
    [pscustomobject]@{ action='reset-password'; username='pwtest'; role='creator'; duty=''; label='重置达人 pwtest 密码（团长 test2 的下属）' },
    [pscustomobject]@{ action='create-staff'; username='ops001'; role='operations'; duty='operations'; label='新建运营管理员 ops001' },
    [pscustomobject]@{ action='create-staff'; username='fin001'; role='finance'; duty='finance'; label='新建财务管理员 fin001' },
    [pscustomobject]@{ action='grant-project'; username='test1'; role='creator'; duty=''; label='达人 test1 加入项目' },
    [pscustomobject]@{ action='grant-project'; username='test2'; role='leader'; duty=''; label='团长 test2 加入项目' },
    [pscustomobject]@{ action='grant-project'; username='pwtest'; role='creator'; duty=''; label='达人 pwtest 加入项目' }
)

# 函数体：登录 admin → 查团队成员 → 执行一个动作，最多 4 次云调用。
$source = @'
function (input) {
  var env = input.environment;
  var call = function (path, method, data, tk) {
    return new Promise(function (resolve) {
      wx.cloud.callFunction({
        name: 'opc-api', config: { env: env },
        data: { path: path, method: method, data: data || {}, token: tk },
        success: function (r) { resolve(r.result || {}) },
        fail: function (e) { resolve({ code: 'CALL_FAIL', message: e.errMsg }) }
      })
    })
  };
  var out = { action: input.action, username: input.username, steps: [] };
  return call('/core/auth/login', 'POST', { username: input.admin.username, password: input.admin.password }).then(function (login) {
    out.login = login.code === 0 ? 'ok' : (login.code + ' ' + login.message);
    if (login.code !== 0) return out;
    var tk = login.data.token;
    return call('/core/team/members', 'GET', {}, tk).then(function (members) {
      var byName = {};
      (members.data || []).forEach(function (m) { byName[m.username] = m.id });
      var id = byName[input.username];
      if (input.action === 'reset-password') {
        if (!id) { out.steps.push('账号不存在'); return out }
        return call('/core/team/members/' + id + '/reset-password', 'POST', { password: input.accountPassword }, tk).then(function (res) {
          out.userId = id; out.mustChangePwd = res.data && res.data.mustChangePwd;
          out.steps.push('reset-password ' + res.code + (res.message ? ' ' + res.message : ''));
          return out;
        });
      }
      if (input.action === 'create-staff') {
        if (id) { out.userId = id; out.steps.push('账号已存在，跳过创建'); return out }
        return call('/core/staff', 'POST', { username: input.username, displayName: input.username, duty: input.duty }, tk).then(function (res) {
          out.steps.push('create-staff ' + res.code + (res.message ? ' ' + res.message : ''));
          if (res.code !== 0) return out;
          out.userId = res.data.id;
          return call('/core/team/members/' + res.data.id + '/reset-password', 'POST', { password: input.accountPassword }, tk).then(function (r2) {
            out.mustChangePwd = r2.data && r2.mustChangePwd;
            out.steps.push('reset-password ' + r2.code + (r2.message ? ' ' + r2.message : ''));
            return out;
          });
        });
      }
      if (input.action === 'grant-project') {
        if (!id) { out.steps.push('账号不存在'); return out }
        return call('/core/projects/' + input.projectId + '/members', 'POST', { userId: id, memberRole: 'member' }, tk).then(function (res) {
          out.userId = id;
          out.steps.push('grant-project ' + res.code + (res.message ? ' ' + res.message : ''));
          return out;
        });
      }
      out.steps.push('未知动作 ' + input.action);
      return out;
    });
  });
}
'@
$escaped = (($source -replace "`r?`n", ' ') -replace '"', '\"')

function Invoke-Step {
    param([Parameter(Mandatory)][pscustomobject]$Step)
    $payload = @{
        environment = $Environment
        admin       = @{ username = $AdminUsername; password = $AdminPassword }
        accountPassword = $AccountPassword
        projectId   = $ProjectId
        action      = $Step.action
        username    = $Step.username
        duty        = $Step.duty
    } | ConvertTo-Json -Depth 6 -Compress
    $argumentsFile = Join-Path ([System.IO.Path]::GetTempPath()) ('opc-acceptance-step-' + $Step.action + '.json')
    # automation_evaluate 的 --args-file 必须是「函数参数数组」，单元素数组也要带方括号；
    # ConvertTo-Json 在 PowerShell 5.1 下会把单元素数组拆成对象，所以这里手工补方括号。
    [System.IO.File]::WriteAllText($argumentsFile, '[' + $payload + ']', (New-Object System.Text.UTF8Encoding($false)))
    $call = Invoke-WechatCli -Cli $Cli -Arguments @('-c','Codex','automation_evaluate','--project',$Project,'--fn-source',$escaped,'--args-file',$argumentsFile)
    $raw = ($call.Output | Out-String)
    if ($call.ExitCode -ne 0 -or $raw.IndexOf('{') -lt 0) { throw ("$($Step.label) 失败：自动化调用没有返回结果。") }
    $response = $raw.Substring($raw.IndexOf('{')) | ConvertFrom-Json
    if (-not $response.ok -or -not $response.result.success) {
        $collapsed = ($raw -replace '\s+', ' ').Trim()
        throw ("$($Step.label) 失败：" + $collapsed.Substring(0, [Math]::Min(400, $collapsed.Length)))
    }
    # automation_evaluate 对返回 Promise 的函数会多包一层 result。
    $value = $response.result.result.result
    if (-not $value) { $value = $response.result.result }
    if ($value.login -ne 'ok') { throw ("$($Step.label) 失败：admin 登录 " + $value.login) }
    return $value
}

$prepared = @()
$failures = @()
foreach ($step in $steps) {
    $value = Invoke-Step -Step $step
    $detail = ($value.steps -join ' / ')
    Write-Output ("{0}：{1}" -f $step.label, $detail)
    # 40900「用户已加入项目」是幂等重跑的正常结果，不算失败。
    $ok = $value.userId -and -not ($value.steps | Where-Object { $_ -match '(reset-password|create-staff|grant-project) (?!0\b|40900\b)\d+' })
    if ($ok) {
        $source = 'existing'
        if ($step.action -eq 'create-staff') { $source = 'created' }
        $prepared += [pscustomobject]@{ username=$step.username; role=$step.role; id=$value.userId; source=$source }
    } else {
        $failures += [pscustomobject]@{ username=$step.username; detail=$detail }
    }
}

$record = [pscustomobject]@{
    preparedAt  = (Get-Date).ToUniversalTime().ToString('o')
    environment = $Environment
    admin       = $AdminUsername
    password    = $AccountPassword
    accounts    = $prepared
    failures    = $failures
}
Write-Utf8NoBom -Path $OutputFile -Text ($record | ConvertTo-Json -Depth 8)
Write-Output ("环境：" + $Environment + "；可用账号：" + (($prepared | ForEach-Object { $_.username + '(' + $_.role + ')' }) -join ', '))
if ($failures.Count) { Write-Output ("失败：" + (($failures | ForEach-Object { $_.username }) -join ', ')) }
Write-Output ("凭据写入本地文件：" + $OutputFile + "（已 ignore，不进仓库）")
