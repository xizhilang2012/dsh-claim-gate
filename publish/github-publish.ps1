# 把 dsh-claim-gate 发布到 GitHub（不需要 git / gh，全部走 REST API）
#
# 你只需要一个 token：
#   1. 打开 https://github.com/settings/tokens/new
#   2. Note 随便写，Expiration 选 7 天
#   3. 勾选 repo（第一项，含全部子项）
#   4. 生成，复制
#
# 这个脚本会：建仓库 → 上传所有文件 → 建 v0.1.0 Release → 上传 tgz 安装包。
# token 只在内存里用，不落盘、不进日志。
param(
    [string]$Token = '',
    [string]$Owner = 'xizhilang2012',
    [string]$Repo  = 'dsh-claim-gate'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot          # plugins/claim-gate
$Api  = 'https://api.github.com'

if ($Token -eq '') {
    $secure = Read-Host -Prompt '粘贴 GitHub token（输入不回显）' -AsSecureString
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ($Token.Trim() -eq '') { throw '没有 token，退出。' }

$Headers = @{
    Authorization = "Bearer $($Token.Trim())"
    Accept        = 'application/vnd.github+json'
    'User-Agent'  = 'dsh-claim-gate-publish'
}

function Call-Api {
    param([string]$Method, [string]$Url, $Body, [string]$ContentType = 'application/json')
    $req = @{ Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = 60 }
    if ($null -ne $Body) {
        $req.Body = if ($ContentType -eq 'application/json') { $Body | ConvertTo-Json -Depth 6 } else { $Body }
        $req.ContentType = $ContentType
    }
    try { return Invoke-RestMethod @req }
    catch {
        $detail = ''
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $detail = $reader.ReadToEnd()
        } catch { }
        throw "$Method $Url 失败：$($_.Exception.Message) $detail"
    }
}

# ── 0. 验证 token
$me = Call-Api GET "$Api/user"
Write-Host "登录身份：$($me.login)" -ForegroundColor Cyan
if ($me.login -ne $Owner) {
    Write-Host "注意：token 属于 $($me.login)，但脚本要发布到 $Owner。" -ForegroundColor Yellow
    $Owner = $me.login
}

# ── 1. 建仓库（已存在就跳过）
$exists = $true
try { $null = Call-Api GET "$Api/repos/$Owner/$Repo" } catch { $exists = $false }

if (-not $exists) {
    $desc = (Get-Content (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).description
    $null = Call-Api POST "$Api/user/repos" @{
        name        = $Repo
        description = $desc
        private     = $false
        has_issues  = $true
        has_wiki    = $false
        auto_init   = $false
    }
    Write-Host "已创建仓库：$Owner/$Repo" -ForegroundColor Green
} else {
    Write-Host "仓库已存在，继续上传：$Owner/$Repo" -ForegroundColor Yellow
}

# ── 2. 上传文件
$skip = '\\dist\\|\\node_modules\\|\\\.git\\'
$files = Get-ChildItem -Path $Root -Recurse -File |
    Where-Object { $_.FullName -notmatch $skip } |
    Where-Object { $_.Length -lt 45MB }

$count = 0
foreach ($f in $files) {
    $rel = $f.FullName.Substring($Root.Length + 1).Replace('\', '/')
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $b64 = [Convert]::ToBase64String($bytes)

    $body = @{ message = "add $rel"; content = $b64 }

    # 已存在则带上 sha（覆盖更新）
    try {
        $cur = Call-Api GET "$Api/repos/$Owner/$Repo/contents/$rel"
        if ($cur.sha) { $body.sha = $cur.sha }
    } catch { }

    $null = Call-Api PUT "$Api/repos/$Owner/$Repo/contents/$rel" $body
    $count++
    Write-Host ("  [{0}] {1}" -f $count, $rel) -ForegroundColor DarkGray
}
Write-Host "上传完成：$count 个文件" -ForegroundColor Green

# ── 3. Release + 安装包
$tgz = Join-Path $Root 'dist\dsh-claim-gate-0.1.0.tgz'
$tag = 'v0.1.0'

$release = $null
try { $release = Call-Api GET "$Api/repos/$Owner/$Repo/releases/tags/$tag" } catch { }
if ($null -eq $release) {
    $release = Call-Api POST "$Api/repos/$Owner/$Repo/releases" @{
        tag_name   = $tag
        name       = "dsh-claim-gate $tag"
        body       = "发出去之前，先自证。`n`n安装：``dsh plugin --profile <profile> add https://github.com/$Owner/$Repo``"
        draft      = $false
        prerelease = $false
    }
    Write-Host "已创建 Release $tag" -ForegroundColor Green
} else {
    Write-Host "Release $tag 已存在" -ForegroundColor Yellow
}

if (Test-Path $tgz) {
    $assetName = Split-Path $tgz -Leaf
    $upUrl = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$assetName"
    try {
        $null = Invoke-RestMethod -Method POST -Uri $upUrl -Headers $Headers `
            -ContentType 'application/octet-stream' -InFile $tgz -TimeoutSec 120
        Write-Host "已上传安装包：$assetName" -ForegroundColor Green
    } catch {
        Write-Host "安装包上传失败（可能已存在）：$($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── 4. 收尾
Write-Host ''
Write-Host '完成。接下来：' -ForegroundColor Cyan
Write-Host "  仓库     https://github.com/$Owner/$Repo"
Write-Host "  安装     dsh plugin --profile desktop add https://github.com/$Owner/$Repo"
Write-Host '  上架     把仓库地址发给 dsh-plugin-catalog 的维护方（PR / issue）'
Write-Host ''
Write-Host '记得去 https://github.com/settings/tokens 把这个 token 删掉。' -ForegroundColor Yellow
