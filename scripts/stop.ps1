# KnowledgeEditor 停止脚本（Phase 5E）
# 用法: .\scripts\stop.ps1
# 功能: 停止本项目进程。优先依据 .knowledgeeditor/runtime/runtime.json 的 PID 记录（start.ps1 启动的进程）；
#       记录缺失/失效时，按「端口 + 项目命令行特征」双重匹配兜底识别并停止（v0.7.3 增强，
#       兼容 dev.ps1 / 手动启动的进程），绝不按进程名模糊匹配、不误杀无关服务。
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$runtimeFile = Join-Path $root 'workspace\.knowledgeeditor\runtime\runtime.json'

# 服务定义：端口 + 用于识别本项目进程的命令行特征（双重匹配，特征不命中则不自动关闭）
$svcDefs = @(
    @{ Name = 'backend';  Port = 8000; Match = 'uvicorn app.main:app' }
    @{ Name = 'frontend'; Port = 5173; Match = 'node_modules\vite\bin\vite.js' }
)

$anyStopped = $false

# ---------- 1) 按 runtime 记录停止（start.ps1 启动的进程） ----------
if (Test-Path $runtimeFile) {
    Write-Host '==> 按 runtime 记录停止本项目进程' -ForegroundColor Cyan
    $runtime = $null
    try { $runtime = Get-Content $runtimeFile -Raw | ConvertFrom-Json }
    catch {
        Write-Host '进程记录文件无法解析，跳过记录停止，改按端口识别。' -ForegroundColor Yellow
    }

    if ($runtime) {
        foreach ($svc in @('backend', 'frontend')) {
            $rec = $runtime.$svc
            if (-not $rec -or -not $rec.pid) { continue }
            $procId = [int]$rec.pid

            if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
                # 优先 taskkill 停止整个进程树（vite 经 npm 启动，node 为子进程）；
                # taskkill 不可用（受限环境）时回退 Stop-Process 停止主进程
                $tk = Get-Command taskkill -ErrorAction SilentlyContinue
                if ($tk) {
                    & taskkill /PID $procId /T /F 2>$null | Out-Null
                }
                else {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                }
                Start-Sleep -Milliseconds 500
                if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
                    Write-Host "  $svc PID=$procId 停止失败（可能需要管理员权限）" -ForegroundColor Red
                }
                else {
                    Write-Host "  $svc PID=$procId 已停止" -ForegroundColor Green
                    $anyStopped = $true
                }
            }
            else {
                Write-Host "  $svc PID=$procId 未在运行（可能已手动退出）" -ForegroundColor Yellow
            }
        }
        try { [System.IO.File]::Delete($runtimeFile) } catch { }
        Write-Host '    进程记录已清理' -ForegroundColor Green
    }
}
else {
    Write-Host '未找到进程记录文件（workspace\.knowledgeeditor\runtime\runtime.json）。' -ForegroundColor Yellow
    Write-Host '该文件由 start.ps1 写入；若进程为 dev.ps1 / 手动启动，将按「端口 + 项目特征」兜底识别。' -ForegroundColor Yellow
}

# ---------- 2) 端口兜底：仍被占用的端口，按项目命令行特征识别后停止 ----------
foreach ($p in $svcDefs) {
    $conn = Get-NetTCPConnection -LocalPort $p.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { continue }
    $owner = [int]$conn.OwningProcess
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    $cmd = $null
    if ($proc) { $cmd = $proc.CommandLine }
    $isOurs = $cmd -and ($cmd -like "*$($p.Match)*")
    # 已在第 1 步按记录停止的 PID 跳过（避免重复提示）
    if ($isOurs) {
        Write-Host "  端口 $($p.Port) 被项目进程占用（PID=$owner，命令行含 $($p.Match)），正在停止（含子进程树）..." -ForegroundColor Cyan
        $tk = Get-Command taskkill -ErrorAction SilentlyContinue
        if ($tk) {
            & taskkill /PID $owner /T /F 2>$null | Out-Null
        }
        else {
            Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500
        if (Get-Process -Id $owner -ErrorAction SilentlyContinue) {
            Write-Host "  端口 $($p.Port) PID=$owner 停止失败（可能需要管理员权限）" -ForegroundColor Red
        }
        else {
            Write-Host "  端口 $($p.Port) PID=$owner 已停止" -ForegroundColor Green
            $anyStopped = $true
        }
    }
    else {
        Write-Host "注意: 端口 $($p.Port) 仍被 PID=$owner 占用（命令行无法识别为本项目进程，未自动关闭）。" -ForegroundColor Yellow
        Write-Host "      请确认是否为其他服务；如需关闭: Stop-Process -Id $owner -Force" -ForegroundColor Yellow
    }
}

if ($anyStopped) {
    Write-Host '==> 已完成停止。' -ForegroundColor Green
}
else {
    Write-Host '==> 未停止任何进程（无记录进程、端口空闲或无法识别为本项目进程）。' -ForegroundColor Green
}
