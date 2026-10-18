# T00：隔离数据目录（Windows 桌面/WebView2 侧）。
# 用法（PowerShell）： . .\scripts\ui-workshop\sandbox-env.ps1 [基目录]
param([string]$Base = "$env:TEMP\ke-ui-workshop-sandbox")
if (Test-Path $Base) { Remove-Item -Recurse -Force $Base }
New-Item -ItemType Directory -Force -Path (Join-Path $Base 'workspace'), (Join-Path $Base 'appdata') | Out-Null
$env:KE_WORKSPACE = Join-Path $Base 'workspace'
$env:KE_APP_CONFIG = Join-Path $Base 'appdata\app_config.json'
$env:KE_APP_CONFIG_LEGACY = Join-Path $Base 'appdata\legacy-does-not-exist.json'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $Base 'webview2'
Write-Output "KE_WORKSPACE=$env:KE_WORKSPACE"
Write-Output "KE_APP_CONFIG=$env:KE_APP_CONFIG"
Write-Output "KE_APP_CONFIG_LEGACY=$env:KE_APP_CONFIG_LEGACY (should not exist)"
