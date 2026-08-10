# KnowledgeEditor 开发启动脚本
# 用法: .\scripts\dev.ps1 backend | frontend
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('backend', 'frontend')]
    [string]$service
)

$root = Split-Path $PSScriptRoot -Parent

switch ($service) {
    'backend' {
        Write-Host '==> backend: http://127.0.0.1:8000  (Ctrl+C 停止)'
        Push-Location (Join-Path $root 'backend')
        try {
            .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
        }
        finally {
            Pop-Location
        }
    }
    'frontend' {
        Write-Host '==> frontend: http://localhost:5173  (Ctrl+C 停止)'
        Push-Location (Join-Path $root 'frontend')
        try {
            npm run dev
        }
        finally {
            Pop-Location
        }
    }
}
