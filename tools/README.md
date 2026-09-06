# tools/ — 本机开发验证工具（WSL + Windows 混用）

> 这些脚本不是构建链的一部分（不进 git 发布），是**本机工作流辅助**。
> 已同步复制到 `/mnt/c/ke-tmp/`（历史遗留路径，两处内容一致）。
> 完整环境坑与 NSIS 构建方案见 `docs/tauri-build-env-notes.md`。

## 脚本索引

| 脚本 | 用途 | 调用方式 | 前置 |
|---|---|---|---|
| `run-gui-cdp.bat` | 启动桌面 GUI（WebView2 带 CDP 9222，供调试/截图） | `cmd.exe /c "D:\KE Project\run-gui-cdp.bat"`（或本文件） | 已 cargo build（`knowledgeeditor.exe` 存在于 `target/debug/`） |
| `rebuild-gui.bat` | cargo build 重编桌面壳（**源码/前端改动后**） | `cmd.exe /c "C:\ke-tmp\rebuild-gui.bat"` | **先杀 GUI**（否则 binaries 占用 → PermissionDenied） |
| `cargo-test.bat` | Rust 单测（settings 等 11 项） | `cmd.exe /c "C:\ke-tmp\cargo-test.bat"` | 先杀 GUI |
| `gen-manifest.py` | 重新生成 `desktop/src-tauri/binaries/` 的 `manifest.sha256` + `versions.json`（81 项产物） | `python -X utf8 C:\ke-tmp\gen-manifest.py` | sidecar 已重建、`frontend/dist-build/` 已构建 |
| `check-1b2.py` | CDP 连接 `ws://127.0.0.1:9222` 验证编辑器/工具栏状态的脚本模板 | `python -X utf8 C:\ke-tmp\check-1b2.py` | GUI 已启动 |
| `run-tauri-dev.bat` | tauri dev（热更新开发模式） | `cmd.exe /c "D:\KE Project\run-tauri-dev.bat"` | dev 环境 |

## 环境三原则（实战踩坑总结，详情见 docs/tauri-build-env-notes.md）

1. **前端构建用 WSL bash**：`cd frontend && npm run build`（产物在 `frontend/dist-build/`，**不是 dist**）
2. **Windows 工具用 cmd**，但 `npx tauri` 在 WSL 挂载盘因 `.bin` symlink 不可执行 → 构建方案以 env-notes 为准
3. **cargo/rust 操作前先杀 GUI**：`taskkill /IM knowledgeeditor.exe /F` + `knowledgeeditor-backend.exe /F`

## 日常循环（改完 → 验证）

```bash
cd frontend && npm run build                 # 前端构建（WSL）
cmd.exe /c "taskkill /IM knowledgeeditor.exe /F"   # 杀 GUI
cmd.exe /c "C:\ke-tmp\rebuild-gui.bat"      # 重编壳
cmd.exe /c "D:\KE Project\run-gui-cdp.bat"  # 起 GUI（CDP 9222）
python -X utf8 C:\ke-tmp\check-1b2.py       # CDP 验证
```

## git 说明

本目录**不提交进 git**（纯本机辅助脚本；如需随仓库分发再改 .gitignore 策略）。
