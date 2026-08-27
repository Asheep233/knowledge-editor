# KnowledgeEditor 构建与测试脚本
# 用法: .\scripts\build.ps1 [-SkipSidecar]
# 功能: backend 单元测试 + sidecar 源码构建（可跳过）+ frontend 生产构建
#       + 产物校验（exe 版本与源码一致）+ hash manifest（versions.json + manifest.sha256）；
#       可选 Authenticode 签名（P4-6）。
# P1-16：预编译 exe 不入库；sidecar 为构建期产物（唯一事实源 = backend 源码 + spec）。
param([switch]$SkipSidecar)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# 后端 python 解释器探测：优先 backend\.venv，回退 PATH 上的 python
#（P1-16 修复：原脚本写死 .venv\Scripts\python.exe，无 venv 环境直接失败）。
function Resolve-BackendPython {
    $venv = Join-Path $root 'backend\.venv\Scripts\python.exe'
    if (Test-Path $venv) { return $venv }
    $sys = Get-Command python -ErrorAction SilentlyContinue
    if ($sys) { return $sys.Source }
    throw '未找到 Python（backend\.venv 或 PATH 上的 python）'
}
$python = Resolve-BackendPython

function Get-HashManifest {
    # P1-16：对 sidecar exe 与 frontend dist 计算 SHA256，写入 desktop/src-tauri/binaries/
    # 的 versions.json（结构化）与 manifest.sha256（sha256sum 格式），
    # 使发布/构建产物具备可复现性与完整性校验。
    $binDir = Join-Path $root 'desktop\src-tauri\binaries'
    $distDir = Join-Path $root 'frontend\dist-build'
    $manifest = [ordered]@{ schemaVersion = 1; built_at = (Get-Date).ToString('o'); artifacts = @() }
    $sumLines = @()

    Get-ChildItem $binDir -Filter 'knowledgeeditor-backend-*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
        $h = $_ | Get-FileHash -Algorithm SHA256
        $rel = $_.FullName.Substring($root.Length + 1)
        $manifest.artifacts += [ordered]@{
            path   = $rel
            size   = $_.Length
            sha256 = $h.Hash.ToLowerInvariant()
        }
        $sumLines += "$($h.Hash.ToLowerInvariant())  $rel"
    }
    if (Test-Path $distDir) {
        Get-ChildItem $distDir -Recurse -File | ForEach-Object {
            $h = $_ | Get-FileHash -Algorithm SHA256
            $rel = $_.FullName.Substring($root.Length + 1)
            $manifest.artifacts += [ordered]@{
                path   = $rel
                size   = $_.Length
                sha256 = $h.Hash.ToLowerInvariant()
            }
            $sumLines += "$($h.Hash.ToLowerInvariant())  $rel"
        }
    }
    $out = Join-Path $binDir 'versions.json'
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $out -Encoding UTF8
    $sumOut = Join-Path $binDir 'manifest.sha256'
    $sumLines | Set-Content -Path $sumOut -Encoding ASCII
    Write-Host "==> hash manifest: $out ($($manifest.artifacts.Count) artifacts) + $sumOut"
}

function Test-SidecarVersionConsistency {
    # P1-16：sidecar 产物版本与源码 __version__ 一致性 = **运行时校验**：
    # 以随机空端口拉起 exe → 查询 /api/health 的 version 字段 → 与
    # backend/app/__init__.py 的 __version__ 比对 → 关闭进程树。
    # （PyInstaller 会压缩 PYZ，源码字符串不会以明文内嵌，字节检索不可靠。）
    $exe = Get-ChildItem (Join-Path $root 'desktop\src-tauri\binaries') -Filter 'knowledgeeditor-backend-*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) {
        Write-Host '==> [校验] 未发现 sidecar exe（构建期产物缺失，仅生成 manifest）。' -ForegroundColor Yellow
        return
    }
    $version = (& $python -c "from app import __version__; print(__version__)").Trim()
    $port = Get-Random -Minimum 20000 -Maximum 50000
    $oldPort = $env:KE_PORT
    $env:KE_PORT = "$port"
    $proc = Start-Process -FilePath $exe.FullName -PassThru -WindowStyle Hidden
    try {
        $versionFromExe = $null
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Milliseconds 1000
            $body = curl.exe -s "http://127.0.0.1:$port/api/health" --max-time 3
            if ($body) {
                try { $versionFromExe = ($body | ConvertFrom-Json).version } catch { }
            }
            if ($versionFromExe) { break }
            if ($proc.HasExited) { break }
        }
        if (-not $versionFromExe) {
            throw "sidecar exe 未能返回 health（进程已退出或超时）"
        }
        if ($versionFromExe -ne $version) {
            throw "sidecar exe 版本 '$versionFromExe' 与源码 '$version' 不一致（源码与产物漂移）"
        }
        Write-Host "==> [校验] sidecar exe 运行时版本与源码一致: $version"
    }
    finally {
        & taskkill /PID $proc.Id /T /F 2>$null | Out-Null
        if ($null -eq $oldPort) { Remove-Item Env:\KE_PORT -ErrorAction SilentlyContinue } else { $env:KE_PORT = $oldPort }
    }
}

function Build-Sidecar {
    param([string]$Python)
    Write-Host '==> [sidecar] 从源码构建（PyInstaller，P1-16）'
    Push-Location $root
    try {
        & $Python -m PyInstaller backend\knowledgeeditor-backend.spec `
            --distpath desktop\src-tauri\binaries `
            --workpath backend\build\pyinstaller --noconfirm --clean
        if ($LASTEXITCODE -ne 0) { throw 'PyInstaller 构建失败' }
        $src = Join-Path $root 'desktop\src-tauri\binaries\knowledgeeditor-backend.exe'
        $dst = Join-Path $root 'desktop\src-tauri\binaries\knowledgeeditor-backend-x86_64-pc-windows-msvc.exe'
        if (Test-Path $src) { Move-Item -Force $src $dst }
        Write-Host "==> [sidecar] 产物: $dst"
    }
    finally {
        Pop-Location
    }
}

function Invoke-OptionalSign {
    # P4-6：安装包未签名。若提供了 Authenticode 证书指纹则用 signtool 签名，
    # 否则跳过并在日志注明「未签名」（不阻塞构建）。签名不会在无证书时伪造。
    $thumbprint = $env:KE_SIGN_CERT_THUMBPRINT
    if (-not $thumbprint) {
        Write-Host '==> [签名] 未提供 KE_SIGN_CERT_THUMBPRINT，安装包将保持「未签名」状态（P4-6）。' -ForegroundColor Yellow
        Write-Host '      如需签名：1) 将 Authenticode 证书导入本机信任库；2) 设置环境变量' -ForegroundColor Yellow
        Write-Host '      $env:KE_SIGN_CERT_THUMBPRINT="<证书指纹>" 后再运行本脚本。见 desktop/KNOWLEDGEEDITOR_BACKEND.md。' -ForegroundColor Yellow
        return
    }
    $signtool = Get-Command signtool -ErrorAction SilentlyContinue
    if (-not $signtool) {
        Write-Host '[签名] 未找到 signtool（Windows SDK），跳过签名。' -ForegroundColor Yellow
        return
    }
    $targets = @()
    $targets += Get-ChildItem (Join-Path $root 'desktop\src-tauri\binaries') -Filter 'knowledgeeditor-backend-*.exe' -ErrorAction SilentlyContinue
    # 若有 NSIS 安装器产物则一并签名
    $targets += Get-ChildItem (Join-Path $root 'desktop\src-tauri\target\release\bundle\nsis') -Filter '*.exe' -ErrorAction SilentlyContinue
    foreach ($t in $targets) {
        Write-Host "==> [签名] $($t.FullName)"
        & $signtool.Source sign /a /sha1 $thumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $t.FullName
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [签名] $($t.Name) 签名失败" -ForegroundColor Red
        }
    }
}

Write-Host '==> [1/4] backend: pytest'
Push-Location (Join-Path $root 'backend')
try {
    & $python -m pytest
    if ($LASTEXITCODE -ne 0) { throw 'backend tests failed' }
}
finally {
    Pop-Location
}

if (-not $SkipSidecar) {
    Build-Sidecar -Python $python
}

Write-Host '==> [2/4] frontend: vite build'
Push-Location (Join-Path $root 'frontend')
try {
    # 前置条件：node_modules 必须由「本机平台」的 npm ci/install 安装
    #（@esbuild/* 平台二进制随安装平台变化；Linux 装的 node_modules 在 Windows 上
    # 缺 win32-x64 esbuild，反之亦然）。CI 各 runner 各自 `npm ci`，无此问题。
    # 直接以 node 调用 tsc / ke-vite（不依赖 npm 的 .bin 注入）：
    # 本仓库 node_modules 可能由任意平台 npm 安装（.bin shim 形态随 os 变化），
    # 显式 node 调用在 PowerShell/bash/CI 三处行为一致。
    & node.exe "node_modules\typescript\bin\tsc" -b
    if ($LASTEXITCODE -ne 0) { throw 'tsc failed' }
    & node.exe "scripts\ke-vite.mjs" build
    if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
}
finally {
    Pop-Location
}

Write-Host '==> [3/4] 产物校验（exe 版本与源码一致）'
Test-SidecarVersionConsistency

Write-Host '==> [4/4] hash manifest'
Get-HashManifest

Invoke-OptionalSign

Write-Host '==> 构建完成'
