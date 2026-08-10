# KnowledgeEditor 一键启动脚本（Phase 5E）
# 用法: 必须在项目根目录执行  .\scripts\start.ps1
# 功能: 环境检查 -> 旧进程检测清理 -> 启动 backend -> health 握手 -> 启动 frontend -> 写入进程记录
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$runtimeDir = Join-Path $root 'workspace\.knowledgeeditor\runtime'
$runtimeFile = Join-Path $runtimeDir 'runtime.json'
$logDir = Join-Path $runtimeDir 'logs'

$backendPort = 8000
$frontendPort = 5173
$healthUrl = "http://127.0.0.1:$backendPort/api/health"

# ---------- 工具函数 ----------
function Test-Alive {
    param([int]$ProcessId)
    [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-PortOwner {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
        if ($conn) { return [int]$conn.OwningProcess }
    }
    catch { }
    return $null
}

function Read-Runtime {
    if (-not (Test-Path $runtimeFile)) { return $null }
    try { return (Get-Content $runtimeFile -Raw | ConvertFrom-Json) }
    catch { return $null }
}

# ---------- 0) 从项目根目录执行 ----------
if ((Get-Location).Path.TrimEnd('\') -ne $root.TrimEnd('\')) {
    Write-Host '错误: 本脚本必须在项目根目录执行。' -ForegroundColor Red
    Write-Host '  正确用法: cd D:\Agent\KnowledgeEditor ; .\scripts\start.ps1' -ForegroundColor Yellow
    exit 1
}

# ---------- 1) 环境检查 ----------
Write-Host '==> [0/4] 环境检查' -ForegroundColor Cyan
$envErrors = @()

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
    $envErrors += 'Python: 未找到 python 命令。请安装 Python 3.10+ 并确保加入 PATH（安装后重开终端）。'
}

$venvPy = Join-Path $backendDir '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    $envErrors += "backend 虚拟环境缺失（$venvPy）。请先运行 .\scripts\setup.ps1 创建并安装依赖。"
}
else {
    & $venvPy -c "import fastapi, uvicorn" 2>$null
    if ($LASTEXITCODE -ne 0) {
        $envErrors += 'backend 依赖未安装或安装不完整。请运行 .\scripts\setup.ps1 重新安装。'
    }
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    $envErrors += 'Node.js: 未找到 node 命令。请安装 Node.js 18+（推荐 20+）并加入 PATH。'
}

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    $envErrors += 'npm: 未找到 npm 命令。Node.js 安装包自带 npm，请重装或修复 PATH。'
}

if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
    $envErrors += 'frontend 依赖缺失（frontend\node_modules 不存在）。请运行 .\scripts\setup.ps1 安装。'
}
elseif (-not (Test-Path (Join-Path $frontendDir 'node_modules\vite\package.json')) -or
       -not (Test-Path (Join-Path $frontendDir 'node_modules\react\package.json'))) {
    $envErrors += 'frontend 依赖安装不完整（node_modules 存在但缺少 vite / react 等关键包）。请运行 .\scripts\setup.ps1 或 cd frontend && npm install 重新安装。'
}

if ($envErrors.Count -gt 0) {
    Write-Host '环境检查未通过，已中止启动（不静默失败）：' -ForegroundColor Red
    $envErrors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Write-Host '  修复建议：' -ForegroundColor Green
    Write-Host '    1) .\scripts\setup.ps1       # 创建 venv 并安装前后端依赖'
    Write-Host '    2) python --version / node -v / npm -v   # 确认基础环境'
    exit 1
}
Write-Host '    Python / venv / 依赖 / Node / npm / node_modules 全部就绪' -ForegroundColor Green

# ---------- 2) 旧进程检测与清理（以 runtime 记录为唯一依据） ----------
Write-Host '==> [1/4] 旧进程检测' -ForegroundColor Cyan
$stoppedPids = @()
$runtime = Read-Runtime
if ($runtime) {
    $found = $false
    if ($runtime.backend -and (Test-Alive ([int]$runtime.backend.pid))) {
        $found = $true
        Write-Host "    发现旧 backend   PID=$($runtime.backend.pid)  端口=$($runtime.backend.port)  启动于 $($runtime.backend.started_at)"
        Stop-Process -Id ([int]$runtime.backend.pid) -Force -ErrorAction SilentlyContinue
        $stoppedPids += [int]$runtime.backend.pid
        Write-Host '      -> 已停止（本项目记录进程）' -ForegroundColor Green
    }
    if ($runtime.frontend -and (Test-Alive ([int]$runtime.frontend.pid))) {
        $found = $true
        Write-Host "    发现旧 frontend  PID=$($runtime.frontend.pid)  端口=$($runtime.frontend.port)  启动于 $($runtime.frontend.started_at)"
        Stop-Process -Id ([int]$runtime.frontend.pid) -Force -ErrorAction SilentlyContinue
        $stoppedPids += [int]$runtime.frontend.pid
        Write-Host '      -> 已停止（本项目记录进程）' -ForegroundColor Green
    }
    if (-not $found) {
        Write-Host '    记录中的进程均未在运行（可能已手动退出）' -ForegroundColor Yellow
    }
    try { [System.IO.File]::Delete($runtimeFile) } catch { }
    Start-Sleep -Seconds 1   # 等待端口释放
}
else {
    Write-Host '    无历史进程记录（首次启动或已停止）' -ForegroundColor Green
}

# 端口兜底检查：记录清理后仍被占用 -> 非本项目进程，不自动关闭，给出提示
foreach ($p in @(@{ Name = 'backend'; Port = $backendPort }, @{ Name = 'frontend'; Port = $frontendPort })) {
    $owner = Get-PortOwner $p.Port
    if ($owner -and -not ($stoppedPids -contains $owner)) {
        Write-Host "端口 $($p.Port) 被非本项目进程占用（PID=$owner），为保证不误关闭无关进程，已中止启动。" -ForegroundColor Red
        Write-Host "  请手动处理后重试：Stop-Process -Id $owner -Force" -ForegroundColor Yellow
        Write-Host '  （如需换端口：backend 用环境变量 KE_PORT，frontend 修改 vite.config.ts）' -ForegroundColor Yellow
        exit 1
    }
}
Write-Host '    端口 8000 / 5173 可用' -ForegroundColor Green

# ---------- 3) 版本读取与源码级一致性提示 ----------
$backendSrcVersion = $null
$m = Select-String -Path (Join-Path $root 'backend\app\__init__.py') -Pattern '__version__\s*=\s*"([^"]+)"' -ErrorAction SilentlyContinue
if ($m) { $backendSrcVersion = $m.Matches[0].Groups[1].Value }

$frontendSrcVersion = $null
$m2 = Select-String -Path (Join-Path $frontendDir 'src\version.ts') -Pattern "APP_VERSION\s*=\s*'([^']+)'" -ErrorAction SilentlyContinue
if ($m2) { $frontendSrcVersion = $m2.Matches[0].Groups[1].Value }

if ($backendSrcVersion -and $frontendSrcVersion -and ($backendSrcVersion -ne $frontendSrcVersion)) {
    Write-Host "警告: 前后端版本常量不一致（backend=$backendSrcVersion / frontend=$frontendSrcVersion），"
    Write-Host "      请同步 backend\app\__init__.py 与 frontend\src\version.ts。" -ForegroundColor Yellow
}

# ---------- 4) 启动 backend + health 握手 ----------
Write-Host '==> [2/4] 启动 backend' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$backendLog = Join-Path $logDir 'backend.log'
$backendErrLog = Join-Path $logDir 'backend.err.log'

$beProc = Start-Process -FilePath $venvPy `
    -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$backendPort" `
    -WorkingDirectory $backendDir -WindowStyle Hidden `
    -RedirectStandardOutput $backendLog -RedirectStandardError $backendErrLog -PassThru

Write-Host "    已启动 PID=$($beProc.Id)，等待 health 检查（每 1 秒轮询，最长 30 秒）..."
$health = $null
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if (-not (Test-Alive $beProc.Id)) { break }
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
        if ($health.status -eq 'ok') { break }
    }
    catch { }
    Start-Sleep -Seconds 1
}

if (-not $health -or $health.status -ne 'ok') {
    Write-Host '错误: backend 未在 30 秒内通过健康检查，已中止启动流程（不启动 frontend）。' -ForegroundColor Red
    if (-not (Test-Alive $beProc.Id)) {
        Write-Host '  backend 进程已退出，错误日志（最近 15 行）：' -ForegroundColor Yellow
        Get-Content $backendErrLog -Tail 15 -ErrorAction SilentlyContinue
    }
    else {
        Write-Host "  backend 进程存活（PID=$($beProc.Id)）但未就绪，请查看日志：$backendErrLog" -ForegroundColor Yellow
        Stop-Process -Id $beProc.Id -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
Write-Host "    backend 就绪: status=$($health.status) version=$($health.version) started_at=$($health.started_at)" -ForegroundColor Green

if ($backendSrcVersion -and $health.version -ne $backendSrcVersion) {
    Write-Host "警告: 运行中的 backend 版本（$($health.version)）与当前代码（$backendSrcVersion）不一致，可能是旧代码进程。"
    Write-Host "      请先 .\scripts\stop.ps1 再重新 .\scripts\start.ps1。" -ForegroundColor Yellow
}

# backend 实际监听 PID（无 reload 时与启动 PID 一致，双保险）
$bePid = $beProc.Id
$owner = Get-PortOwner $backendPort
if ($owner) { $bePid = $owner }

# ---------- 5) 启动 frontend ----------
Write-Host '==> [3/4] 启动 frontend' -ForegroundColor Cyan
$feLog = Join-Path $logDir 'frontend.log'
$feErrLog = Join-Path $logDir 'frontend.err.log'
$feProc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm run dev' `
    -WorkingDirectory $frontendDir -WindowStyle Hidden `
    -RedirectStandardOutput $feLog -RedirectStandardError $feErrLog -PassThru

$fePid = $feProc.Id
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    $owner = Get-PortOwner $frontendPort
    if ($owner) { $fePid = $owner; break }
    if (-not (Test-Alive $feProc.Id)) { break }
    Start-Sleep -Seconds 1
}
Write-Host "    frontend 已启动 PID=$fePid  (http://localhost:$frontendPort)" -ForegroundColor Green

# ---------- 6) 写入进程记录 ----------
Write-Host '==> [4/4] 写入进程记录' -ForegroundColor Cyan
$record = [ordered]@{
    backend = [ordered]@{
        pid        = $bePid
        port       = $backendPort
        started_at = $health.started_at
        version    = $health.version
    }
    frontend = [ordered]@{
        pid        = $fePid
        port       = $frontendPort
        started_at = (Get-Date).ToString('o')
    }
    project_version = $backendSrcVersion
    started_at      = (Get-Date).ToString('o')
}
$json = $record | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($runtimeFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host '==> 开发环境启动完成' -ForegroundColor Green
Write-Host "    backend : http://127.0.0.1:$backendPort  (PID $bePid)"
Write-Host "    frontend: http://localhost:$frontendPort  (PID $fePid)"
Write-Host "    版本    : $($health.version)"
Write-Host "    记录    : $runtimeFile"
Write-Host '    停止    : .\scripts\stop.ps1'
Write-Host '    单独启动: .\scripts\dev.ps1 backend | frontend'
