# 模拟器端到端验收：登录后逐个访问全部页面，核对路由、权限判定、作用域标签与页面错误。
#
# 为什么需要它：真实五角色验收要在真机上做，但每次改代码后都上真机成本很高。
# 这个脚本用微信开发者工具的 automation 能力在模拟器里跑同一套页面链路，
# 把「路由没跳错 / 页面没报错 / 权限判定正确 / 作用域标签正确」先筛一遍，
# 真机只用于验证真实网络、真机渲染和真机存储。
#
# 期望的页面权限不写死角色名，而是按登录账号的 role + adminDuty 推出，判定口径与
# miniprogram/utils/permissions.js 一致（那份是唯一实现，这里只是它的镜像；
# 权限规则改动时两处都要更新）。
#
# 用法：
#   $env:WEIXIN_ACCEPTANCE_USERNAME = 'admin'
#   $env:WEIXIN_ACCEPTANCE_PASSWORD = '<密码>'
#   & .\scripts\simulator-acceptance.ps1
#
# 前置条件：微信开发者工具已登录，且导入了本项目；服务端口不必开启（走 skill CLI）。
param(
    [string]$Cli = 'C:/Program Files (x86)/Tencent/微信web开发者工具/wechatide.cmd',
    [string]$Project = '',
    [string]$Username = $env:WEIXIN_ACCEPTANCE_USERNAME,
    [string]$Password = $env:WEIXIN_ACCEPTANCE_PASSWORD,
    [string]$OutputDirectory = '',
    [switch]$SkipLogin,
    # 用一个必然被拒的 payload 探测门禁状态：写入未开放时返回 409，
    # 放开后返回 403/422。该请求不会产生任何写入。
    [switch]$ProbeGateWrite
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CloudTools.ps1')

if (-not $Project) { $Project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path (Split-Path $Project -Parent) 'outputs/weixin-acceptance' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# tabBar 页必须用 switchTab，其余页必须用 navigateTo；用错会静默停在当前页，
# 从而读到上一页的数据而误判为通过。
# v5 起 tabBar 为 首页/学院/收益/工具/我的；关键词/作品/钱包改为知乎工作台二级页，
# 走 navigateTo。
$tabPages = @('home', 'college', 'income', 'tools', 'mine')
$subPages = @('zhihu', 'keywords', 'keywords/create', 'works', 'wallet', 'admin', 'team', 'projects', 'prices', 'reports', 'withdrawals', 'password', 'invite', 'profile')
# 这些页面既不依赖作用域，也不自己渲染作用域标签，空值是预期结果。
# 注意 admin 虽然声明 scoped:false，但它的 fetch 会自行调用 scopes.ensure()
# 并设置 scopeLabel（渠道映射需要作用域），所以它必须有值。
$unscoped = @('home', 'mine', 'profile', 'password', 'projects', 'team', 'college', 'tools', 'zhihu')

# 与 utils/permissions.js 的 allowed() 同口径：返回该账号预期可用的页面集合。
function Get-ExpectedPages {
    param([Parameter(Mandatory)]$User)
    $known = $User -and @('admin', 'leader', 'creator') -contains $User.role
    if (-not $known) { return @() }
    $isAdmin = $User.role -eq 'admin'
    $duty = $User.adminDuty
    if (-not $duty) { $duty = 'all' }
    $dutyIs = { param($name) $isAdmin -and (@('all', $name) -contains $duty) }
    $canOperate = (-not $isAdmin) -or (& $dutyIs 'operations')
    $canFinance = (-not $isAdmin) -or (& $dutyIs 'finance')
    $pages = @('home', 'mine', 'profile', 'password', 'college', 'tools', 'income', 'zhihu', 'invite')
    if ($canOperate) { $pages += @('keywords', 'keywords/create', 'works') }
    if ($canFinance) { $pages += @('wallet', 'withdrawals') }
    if (& $dutyIs 'finance') { $pages += 'reports' }
    if (& $dutyIs 'operations') { $pages += @('admin', 'projects') }
    if ($User.role -eq 'leader' -or (& $dutyIs 'operations')) { $pages += @('team', 'prices') }
    return $pages
}

function Invoke-Tool {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $call = Invoke-WechatCli -Cli $Cli -Arguments (@('-c', 'Codex') + $Arguments)
    $raw = ($call.Output | Out-String)
    if ($call.ExitCode -ne 0 -or $raw.IndexOf('{') -lt 0) { return $null }
    try { return ($raw.Substring($raw.IndexOf('{')) | ConvertFrom-Json) } catch { return $null }
}
function Get-PageData {
    param([string]$Path = '')
    $arguments = @('automation_page_action', '--project', $Project, '--action', 'getData')
    if ($Path) { $arguments += @('--data-path', $Path) }
    $response = Invoke-Tool $arguments
    if (-not $response) { return $null }
    return $response.result.data
}
function Get-CurrentRoute {
    $response = Invoke-Tool @('automation_runtime_info', '--project', $Project, '--action', 'currentPage')
    if (-not $response) { return '' }
    return $response.result.currentPage.path
}

# 先重新编译：改过代码后如果只做 reLaunch，跑的是上一次的编译产物，
# 等于验证了旧代码。刷新会重置小程序，所以放在登录之前。
Invoke-Tool @('simulator_refresh', '--project', $Project) | Out-Null
Start-Sleep -Seconds 5
# 自动化桥会静默挂死：此时所有 automation_* 都返回 "timeout waiting for automator response"，
# 而 reLaunch 不生效会让脚本把「停在上一页」误判成页面问题（实测踩到）。
# 刷新后先确认桥是活的，否则直接给出可执行的处置办法，而不是让整轮验收跑出假失败。
if (-not (Get-CurrentRoute)) {
    Write-Output '自动化桥无响应，先刷新一次再确认…'
    Invoke-Tool @('simulator_refresh', '--project', $Project) | Out-Null
    Start-Sleep -Seconds 8
    if (-not (Get-CurrentRoute)) {
        throw '自动化桥无响应：请在开发者工具里刷新或重开项目窗口后重跑本脚本（automator 超时不是页面问题）。'
    }
}

# automation_evaluate 对返回 Promise 的函数会多包一层 {result: ...}，
# 对直接 return 的函数则直接给值。统一解包，避免取值层级写死。
function Get-Evaluated {
    param($Probe)
    if (-not $Probe -or -not $Probe.result) { return $null }
    $value = $Probe.result.result
    if ($value -and ($value.PSObject.Properties.Name -contains 'result')) { return $value.result }
    return $value
}

$user = $null
if (-not $SkipLogin) {
    if (-not $Username -or -not $Password) {
        throw '请通过 -Username/-Password 或 WEIXIN_ACCEPTANCE_USERNAME/WEIXIN_ACCEPTANCE_PASSWORD 提供测试账号。'
    }
    # 登录要按顺序做三件事，否则会踩三个坑（都实测踩到过）：
    #   1) 登录页 onLoad 会 auth.ensure()：已有会话时立刻 reLaunch 走人，
    #      不先清会话就会把上一个账号的会话当成新账号验下去；
    #   2) 清会话必须走存储键（auth.clear() 的那三个键）：点 mine 页的登出依赖
    #      「当前页正好是 mine」，页面没切过去时会静默作用在别的页面上；
    #   3) 登录是云函数往返，固定等 4 秒不够，必须轮询；
    #      而且落地页不一定是首页 —— 财务管理员按 entryPath 直接落在 wallet 页。
    $clear = 'function(){wx.removeStorageSync("zk_access_token");wx.removeStorageSync("zk_user");wx.removeStorageSync("zk_scope");return {cleared:true}}'
    $patch = ('{"username":"' + $Username + '","password":"' + $Password + '"}') -replace '"', '\"'
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Invoke-Tool @('automation_evaluate', '--project', $Project, '--fn-source', ($clear -replace '"', '\"')) | Out-Null
        Invoke-Tool @('automation_navigate', '--project', $Project, '--action', 'reLaunch', '--url', '/pages/login/index') | Out-Null
        # 等登录页真的成为当前页再写表单：reLaunch 不是瞬时的，早写会落到上一页上
        # （实测出现过「无法写入登录表单」，其实是页面还没切过去）。
        $onLogin = $false
        $arrive = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $arrive) {
            Start-Sleep -Seconds 1
            if ((Get-CurrentRoute) -eq 'pages/login/index') { $onLogin = $true; break }
        }
        if (-not $onLogin) {
            Write-Output ("第 $attempt 次没有停在登录页，重新 reLaunch。")
            Invoke-Tool @('automation_navigate', '--project', $Project, '--action', 'reLaunch', '--url', '/pages/login/index') | Out-Null
            Start-Sleep -Seconds 3
        }
        $filled = Invoke-Tool @('automation_page_action', '--project', $Project, '--action', 'setData', '--patch', $patch)
        if (-not $filled -or -not $filled.result.success) {
            Write-Output ("第 $attempt 次未能写入登录表单（当前页 " + (Get-CurrentRoute) + "），重试。")
            continue
        }
        Invoke-Tool @('automation_page_action', '--project', $Project, '--action', 'callMethod', '--method', 'submit') | Out-Null
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
            $route = Get-CurrentRoute
            $candidate = Get-PageData 'user'
            # 离开登录页且拿得到 user 就算登录成功；具体落地页由 entryPath 决定。
            if ($candidate -and $route -ne 'pages/login/index') { $user = $candidate; break }
        }
        if ($user -and $user.username -eq $Username) { break }
        if ($user) { Write-Output ("第 $attempt 次登录得到的是 $($user.username)，与目标 $Username 不符，重试。") }
    }
    if (-not $user) {
        $route = Get-CurrentRoute
        $message = Get-PageData 'error'
        throw "登录失败：当前页面 $route，页面错误 '$message'。"
    }
    if ($user.username -ne $Username) { throw "登录账号不符：期望 $Username，实际 $($user.username)。请检查是否残留了其它会话。" }
    Write-Output ("登录成功：{0}（角色 {1}，职责 {2}）" -f $user.username, $user.role, $user.adminDuty)
} else {
    $user = Get-PageData 'user'
    if (-not $user) { throw '未登录：-SkipLogin 需要小程序里已有会话。' }
}
$expected = @(Get-ExpectedPages -User $user)
Write-Output ("预期可用页面：" + (($expected) -join ', '))

$rows = @()
foreach ($page in ($tabPages + $subPages)) {
    $url = "/pages/$page/index"
    $action = if ($tabPages -contains $page) { 'switchTab' } else { 'navigateTo' }
    Invoke-Tool @('automation_navigate', '--project', $Project, '--action', $action, '--url', $url) | Out-Null
    Start-Sleep -Milliseconds 1800

    $actual = Get-CurrentRoute
    if ($actual -ne "pages/$page/index") {
        # 上一次导航可能还在飞行中（前一个账号留下的页面也算），再等一轮重读一次，
        # 避免把「还没跳完」记成「路由停在上一页」。
        Start-Sleep -Milliseconds 1500
        $actual = Get-CurrentRoute
    }
    $data = Get-PageData
    Invoke-Tool @('simulator_screenshot', '--project', $Project, '--path', (Join-Path $OutputDirectory ('page-' + ($page -replace '/', '-') + '.png')), '--optimize', 'false') | Out-Null

    $shouldAllow = $expected -contains $page
    $problems = @()
    if ($actual -ne "pages/$page/index") { $problems += "路由停在 $actual" }
    if ($data.error) { $problems += "error: $($data.error)" }
    if ($shouldAllow) {
        if ($data.allowed -ne $true) { $problems += '应可用但 allowed 不为 true' }
        if ($data.denied -eq $true) { $problems += '应可用但 denied 为 true' }
        if ($data.loading -eq $true) { $problems += 'loading 未结束' }
        $label = '' + $data.scopeLabel
        if ($unscoped -notcontains $page -and -not $label) { $problems += 'scopeLabel 为空' }
    } else {
        # 无权限页面必须停在原地并只标记 denied；跳走或报错都算失败。
        if ($data.allowed -eq $true) { $problems += '该角色不应有此权限，但 allowed 为 true' }
        if ($data.denied -ne $true) { $problems += '无权限页面未标记 denied' }
    }

    $rows += [pscustomobject]@{
        page       = $page
        expected   = $shouldAllow
        route      = $actual
        allowed    = $data.allowed
        denied     = $data.denied
        scopeLabel = '' + $data.scopeLabel
        error      = '' + $data.error
        problems   = ($problems -join '; ')
    }
    if ($subPages -contains $page) {
        Invoke-Tool @('automation_navigate', '--project', $Project, '--action', 'navigateBack', '--delta', '1') | Out-Null
        Start-Sleep -Milliseconds 700
    }
}

# reports 页三个分区各走不同接口，顶层 onShow 不覆盖它们。只有该角色能进这个页面时才探测。
$sectionProblems = @()
if ($expected -contains 'reports') {
    Invoke-Tool @('automation_navigate', '--project', $Project, '--action', 'navigateTo', '--url', '/pages/reports/index') | Out-Null
    Start-Sleep -Seconds 2
    foreach ($section in @('imports', 'exceptions', 'metric-revisions')) {
        $fn = 'function(){var p=getCurrentPages().slice(-1)[0];return p.section({currentTarget:{dataset:{section:"' + $section + '"}}}).then(function(){return {section:p.data.section,error:p.data.error}})}'
        $probe = Invoke-Tool @('automation_evaluate', '--project', $Project, '--fn-source', ($fn -replace '"', '\"'))
        $value = Get-Evaluated $probe
        if (-not $value -or $value.section -ne $section -or $value.error) {
            $sectionProblems += ($section + ': ' + ($value | ConvertTo-Json -Compress))
        } else {
            Write-Output ("reports 分区 " + $section + " 加载正常")
        }
    }
} else {
    Write-Output 'reports 分区探测跳过：当前账号无报表权限（预期行为）。'
}
if ($sectionProblems.Count) { Write-Output ("reports 分区异常: " + ($sectionProblems -join ' | ')) }

$gate = $null
if ($ProbeGateWrite) {
    $fn = 'function(){return new Promise(function(resolve){wx.cloud.callFunction({name:"opc-api",data:{path:"/core/finance/funding",method:"POST",data:{},token:wx.getStorageSync("zk_access_token")},success:function(r){resolve({statusCode:r.result.statusCode,code:r.result.code,message:r.result.message})},fail:function(e){resolve({error:e.errMsg})}})})}'
    $probe = Invoke-Tool @('automation_evaluate', '--project', $Project, '--fn-source', ($fn -replace '"', '\"'))
    $gate = Get-Evaluated $probe
    $state = if ($gate.statusCode -eq 409) { '写入未开放（UI 测试模式门禁生效）' } elseif ($gate.statusCode) { '写入已开放' } else { '探测失败' }
    Write-Output ("门禁探测: HTTP " + $gate.statusCode + " - " + $state)
}

$rows | Format-Table -AutoSize
$failed = @($rows | Where-Object { $_.problems })
$report = [pscustomobject]@{
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    project   = $Project
    account   = [pscustomobject]@{ username = $user.username; role = $user.role; adminDuty = $user.adminDuty }
    expectedPages = $expected
    pages     = $rows
    passed    = ($rows.Count - $failed.Count)
    failed    = $failed.Count
    reportsSections = $(if ($sectionProblems.Count) { $sectionProblems } else { 'ok' })
    gateProbe = $gate
}
Write-Utf8NoBom -Path (Join-Path $OutputDirectory ('page-acceptance-' + $user.username + '.json')) -Text ($report | ConvertTo-Json -Depth 8)
if ($failed.Count -or $sectionProblems.Count) {
    $detail = @()
    if ($failed.Count) { $detail += "$($failed.Count) 个页面有问题" }
    if ($sectionProblems.Count) { $detail += "reports 分区异常: $($sectionProblems -join ' | ')" }
    throw ("验收未通过：" + ($detail -join '；') + "（见 " + (Join-Path $OutputDirectory ('page-acceptance-' + $user.username + '.json')) + '）')
}
Write-Output ("页面验收通过：$($rows.Count) 个页面（账号 $($user.username)），截图与报告写入 $OutputDirectory")
