# KnowledgeEditor 构建与测试脚本
# 用法: .\scripts\build.ps1
# 功能: backend 单元测试 + frontend 生产构建
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

Write-Host '==> [1/2] backend: pytest'
Push-Location (Join-Path $root 'backend')
try {
    .\.venv\Scripts\python.exe -m pytest
    if ($LASTEXITCODE -ne 0) { throw 'backend tests failed' }
}
finally {
    Pop-Location
}

Write-Host '==> [2/2] frontend: vite build'
Push-Location (Join-Path $root 'frontend')
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
}
finally {
    Pop-Location
}

Write-Host '==> 构建完成'
