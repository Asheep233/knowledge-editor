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

# 3) 启动冒烟（按 PID 停止，禁止 taskkill /IM knowledgeeditor.exe）
$env:KE_WS_PRINT_RENDER="1"
$p = Start-Process -FilePath "F:\Work\Dev\cargo-target\release\knowledgeeditor.exe" -PassThru
Start-Sleep 14
# 检查 %APPDATA%\com.astranota.uiws.e2e\workshop-packs\workshop-recover-status.json
Stop-Process -Id $p.Id -Force

# 4) 注意：cargo 裸构建无 sidecar；后端功能需 tauri build 打包或放置
#    knowledgeeditor-backend-x86_64-pc-windows-msvc.exe 到 exe 同目录。
```

红线：不推送、不发布；不使用真实笔记库；不杀用户运行中的进程；测试结束清理临时目录/进程。
