# 云端操作脚本的共用工具。
#
# 本目录的脚本此前只在 PowerShell 7 下验证过，在 Windows PowerShell 5.1
# （Windows 自带、本机 pwsh 实际指向的版本）下有三处必然失败，全部集中在这里处理：
#
#   1. 无 BOM 的 UTF-8 .ps1：PS 5.1 按 GBK 误读其中的中文，微信开发者工具的
#      路径会变成乱码，报「无法将 ... 识别为 cmdlet」。因此本目录所有 .ps1
#      必须保存为「UTF-8 带 BOM」。注意：某些编辑器/工具写回时会丢掉 BOM，
#      改动后用 scripts/check.cjs 复核（已加入自动检查）。
#
#   2. Set-Content -Encoding utf8：PS 5.1 会写入 BOM，PS 7 不会。云端 CLI 的
#      JSON 解析器拒绝带 BOM 的输入文件：
#        Unexpected token '', "{"_id":"w"... is not valid JSON
#      凡是喂给 CLI 的 JSON 一律用 Write-Utf8NoBom 写。
#
#   3. 原生命令的 stderr：PS 5.1 在 $ErrorActionPreference='Stop' 下会把原生
#      命令写到 stderr 的内容当成终止性错误抛出，即使写了 2>$null。微信 CLI
#      每次调用都会向 stderr 打印一行 skill-call 日志，于是脚本必然中断。
#      统一走 Invoke-WechatCli。

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text
    )
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-WechatCli {
    param(
        [Parameter(Mandatory)][string]$Cli,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Cli @Arguments 2>$null
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ ExitCode = $code; Output = @($output) }
}
