# T27/UI 工坊 云端 Windows VM 构建脚本（在 C:\ke-cloud\repo 内运行；不修改仓库提交）
# 用法: powershell -ExecutionPolicy Bypass -File cloud_build.ps1 [-Repo C:\ke-cloud\repo]
param([string]$Repo = 'C:\ke-cloud\repo')
$ErrorActionPreference = 'Stop'
$root = $Repo
if (-not (Test-Path (Join-Path $root 'package.json'))) { throw "repo 不存在或路径错误: $root" }
if (-not (Test-Path (Join-Path $root 'node_modules'))) { & npm ci --prefix $root 2>&1 | Out-Null }

function Build-Installer([string]$Label, [bool]$Workshop) {
    Write-Host "==> 构建 [$Label] workshop=$Workshop"
    if ($Workshop) { $env:VITE_KE_WORKSHOP='1'; $env:VITE_KE_CORE_SAVE='1' } else { Remove-Item Env:VITE_KE_WORKSHOP -ErrorAction SilentlyContinue; Remove-Item Env:VITE_KE_CORE_SAVE -ErrorAction SilentlyContinue }
    Push-Location $root
    try {
        & powershell -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'scripts/build.ps1 失败' }
        Push-Location (Join-Path $root 'desktop')
        try {
            $env:CI='true'
            & npm run build
            if ($LASTEXITCODE -ne 0) { throw 'tauri build 失败' }
        } finally { Pop-Location }
    } finally { Pop-Location }
    $bundle = Get-ChildItem -Path $root -Recurse -Filter '*_x64-setup.exe' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\bundle\\nsis\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $bundle) { throw '未找到 NSIS 安装包' }
    $outDir = 'C:\ke-cloud\installers'; New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $dest = Join-Path $outDir ("AstraNota-{0}_x64-setup.exe" -f $Label)
    Copy-Item -Force $bundle.FullName $dest
    $hash = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLowerInvariant()
    Write-Host "==> 安装包: $dest`n    sha256=$hash`n    size=$((Get-Item $dest).Length)"
    return [ordered]@{ label = $Label; path = $dest; sha256 = $hash; size = (Get-Item $dest).Length; workshop = $Workshop }
}

$results = @()
Push-Location $root
try {
    # 候选（默认生产包）+ 候选（workshop-enabled）
    $results += Build-Installer -Label 'candidate-default' -Workshop $false
    $results += Build-Installer -Label 'candidate-workshop' -Workshop $true
    # 基线旧版（v1.2.9；仅用于 U1 安装起点）
    & git checkout -q v1.2.9 2>$null
    if ($LASTEXITCODE -eq 0) { $results += Build-Installer -Label 'baseline-v1.2.9-default' -Workshop $false }
    else { Write-Warning '无法 checkout v1.2.9（tag 缺失），请手工提供基线安装包' }
} finally { Pop-Location }
$manifest = [ordered]@{ generatedAt=(Get-Date).ToString('o'); repo=$root; head=(& git -C $root rev-parse --short HEAD); installers=$results }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 'C:\ke-cloud\installers\build-manifest.json'
Write-Host "==> manifest: C:\ke-cloud\installers\build-manifest.json"
