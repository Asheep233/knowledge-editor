# KnowledgeEditor 构建与测试脚本
# 用法: .\scripts\build.ps1
# 功能: backend 单元测试 + frontend 生产构建 + 生成 hash manifest；可选 Authenticode 签名（P4-6）。
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Get-HashManifest {
    # P1-16：对 sidecar exe 与 frontend dist 计算 SHA256，写入 desktop/src-tauri/binaries/versions.json，
    # 使发布/构建产物具备可复现性与完整性校验。
    $binDir = Join-Path $root 'desktop\src-tauri\binaries'
    $distDir = Join-Path $root 'frontend\dist-build'
    $manifest = [ordered]@{ schemaVersion = 1; built_at = (Get-Date).ToString('o'); artifacts = @() }

    Get-ChildItem $binDir -Filter 'knowledgeeditor-backend-*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
        $h = $_ | Get-FileHash -Algorithm SHA256
        $manifest.artifacts += [ordered]@{
            path   = $_.FullName.Substring($root.Length + 1)
            size   = $_.Length
            sha256 = $h.Hash.ToLowerInvariant()
        }
    }
    if (Test-Path $distDir) {
        Get-ChildItem $distDir -Recurse -File | ForEach-Object {
            $h = $_ | Get-FileHash -Algorithm SHA256
            $manifest.artifacts += [ordered]@{
                path   = $_.FullName.Substring($root.Length + 1)
                size   = $_.Length
                sha256 = $h.Hash.ToLowerInvariant()
            }
        }
    }
    $out = Join-Path $binDir 'versions.json'
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $out -Encoding UTF8
    Write-Host "==> hash manifest: $out ($($manifest.artifacts.Count) artifacts)"
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

Write-Host '==> [1/3] backend: pytest'
Push-Location (Join-Path $root 'backend')
try {
    .\.venv\Scripts\python.exe -m pytest
    if ($LASTEXITCODE -ne 0) { throw 'backend tests failed' }
}
finally {
    Pop-Location
}

Write-Host '==> [2/3] frontend: vite build'
Push-Location (Join-Path $root 'frontend')
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
}
finally {
    Pop-Location
}

Write-Host '==> [3/3] hash manifest'
Get-HashManifest

Invoke-OptionalSign

Write-Host '==> 构建完成'
