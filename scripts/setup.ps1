# KnowledgeEditor 初始化脚本
# 用法: .\scripts\setup.ps1
# 功能: 安装 backend 虚拟环境与依赖、frontend npm 依赖
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

Write-Host '==> [1/2] backend: 创建虚拟环境并安装依赖'
Push-Location (Join-Path $root 'backend')
try {
    if (-not (Test-Path '.venv')) {
        python -m venv .venv 2>$null
        if (-not (Test-Path '.venv')) {
            # 部分 Python 发行版缺少 venv 模块，退回 virtualenv
            Write-Host '    venv 模块不可用，使用 virtualenv 创建'
            python -m pip install virtualenv --quiet
            python -m virtualenv .venv
        }
    }
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    .\.venv\Scripts\python.exe -c "import fastapi, uvicorn; print('    backend OK:', fastapi.__version__, uvicorn.__version__)"
}
finally {
    Pop-Location
}

Write-Host '==> [2/2] frontend: 安装依赖'
Push-Location (Join-Path $root 'frontend')
try {
    npm install
    Write-Host '    frontend OK'
}
finally {
    Pop-Location
}

Write-Host '==> 初始化完成。启动方式:'
Write-Host '    .\scripts\dev.ps1 backend    # http://127.0.0.1:8000'
Write-Host '    .\scripts\dev.ps1 frontend   # http://localhost:5173'
