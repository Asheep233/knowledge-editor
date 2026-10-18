# T26 隔离测试构建步骤（Windows）

```powershell
# 1) 复制 src-tauri 并覆盖配置（在 WSL/git bash 或 PowerShell 均可）
$SRC = "F:\Work\KE Project\knowledge-editor\desktop\src-tauri"
$DST = "C:\ke-tmp\uiws-t26\src-tauri"
Remove-Item -Recurse -Force "C:\ke-tmp\uiws-t26" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "C:\ke-tmp\uiws-t26" | Out-Null
Copy-Item -Recurse $SRC $DST
# 修改 $DST\tauri.conf.json：identifier=com.astranota.uiws.e2e；productName=AstraNota UIWS E2E；
# build.frontendDist=<repo>/frontend/dist-build 的绝对 Windows 路径

# 2) 构建（复用全局依赖缓存；CARGO_TARGET_DIR 已配置）
$env:CARGO_HOME="F:\Work\Dev\cargo"; $env:RUSTUP_HOME="F:\Work\Dev\rustup"; $env:CARGO_TARGET_DIR="F:\Work\Dev\cargo-target"
Set-Location $DST
cargo build --release

# 3) sidecar（cargo 裸构建需要手动放置；否则后端不可用）
Copy-Item 'D:\AstraNota\knowledgeeditor-backend.exe' 'F:\Work\Dev\cargo-target\release\knowledgeeditor-backend-x86_64-pc-windows-msvc.exe' -Force

# 4) 启动冒烟（按 PID 停止，禁止 taskkill /IM knowledgeeditor.exe）
$env:KE_WS_PRINT_RENDER="1"
$p = Start-Process -FilePath "F:\Work\Dev\cargo-target\release\knowledgeeditor.exe" -PassThru
Start-Sleep 14
# 检查 %APPDATA%\com.astranota.uiws.e2e\workshop-packs\workshop-recover-status.json
# 优先优雅关闭；强制结束会遗留 sidecar 孙进程
if (-not $p.CloseMainWindow()) { } ; Start-Sleep 2
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
# 异常清理（路径白名单，禁止按镜像名杀进程）：
# Get-Process knowledgeeditor-backend | Where-Object { $_.Path -like 'F:\Work\Dev\cargo-target\*' } | Stop-Process -Force

# 5) 注意：强制结束测试实例会跳过 Tauri 退出清理 → sidecar 孙进程遗留；务必按路径白名单清理。
```

红线：不推送、不发布；不使用真实笔记库；不杀用户运行中的进程；测试结束清理临时目录/进程。
