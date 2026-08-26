# KnowledgeEditor — 桌面壳「后端侧车 / 生命周期 / 权限 / 发布」设计记录

> 本文件记录桌面壳（desktop/src-tauri）相关的设计决策、接口契约与发布/构建说明，
> 供前端子代理与后端/发布同学协调。仅签名/构建说明属「规划」，实际引用需以源码为准。

## 1. 生命周期与事件契约（desktop ↔ frontend）

### 1.1 关窗 flush 握手（见 `lib.rs` `on_window_event`）
- **第一次 CloseRequested**：`prevent_close()` + 隐藏主窗口 + 向全部 webview emit **`ke:close-requested`**，
  随后启动 **1.5s 一次性兜底定时器**；超时后走统一退出流程 `cleanup_on_exit + app.exit(0)`。
- **第二次 CloseRequested**（前端已 flush 完成，或用户再次点关闭）：**立即**走统一退出流程。
- 前端职责（由前端子代理实现）：监听 `ke:close-requested` → 立即 flush / 登记 recovery → 调用
  `getCurrentWindow().close()`（Tauri v2 `@tauri-apps/api/window`）触发第二次 CloseRequested。
  > 若 flush 耗时超 1.5s 会被兜底强退，因此前端 flush 应尽量同步/短链路（写草稿而非等待网络）。
- 事件负载：`()`（无 payload）。

### 1.2 运行时就绪（见 `sidecar.rs` `watch_sidecar`）
- sidecar 在 health 握手成功后 emit **`ke:runtime-ready`**，payload = `RuntimeInfo`：
  `{ api_base: string, workspace: string, version: string, pid: number, port: number }`。
- 前端同时可用 invoke 命令 **`get_runtime_info`** 取同一 `RuntimeInfo`。
- 前端把 `api_base` 写入 `window.__KE_API_BASE__`（见 `frontend/src/api/client.ts`）。
  - 已知前端现状：`main.tsx` 以 `invoke('get_runtime_info')` 轮询（10×400ms）。若改为事件驱动，
    请监听 `ke:runtime-ready` 并在收到后注入；两者选一即可，事件名保持一致。
- 侧车异常退出 emit **`ke:sidecar-exited`**；崩溃重启耗尽 emit **`ke:runtime-error`**。

### 1.3 原生菜单事件（见 `menu.rs`）
| 菜单 | 事件名 | payload |
|------|--------|---------|
| 新建文档 | `ke-menu:new-document` | `()` |
| 打开 Workspace | `ke-menu:open-workspace` | `()` |
| 最近 | `ke-menu:refresh-recent` | `()` |
| 重新加载 | `ke-menu:reload` | `()` |
| 开发者工具(debug) | `ke-menu:devtools` | `()` |
| 退出 | `ke-menu:exit` | `()` |
| 关于 | `ke-menu:about`（对话框由 Rust 原生弹） | — |

> **P3-21 变更**：原「最近」子菜单是启动时从 `app_config.json` 读取的静态路径列表（会过期）。
> 现改为**单一「最近工作区…」触发项**，点击 emit **`ke-menu:refresh-recent`**，由前端从后端
> `recent_workspaces` 拉取并展示/打开。原 `ke-menu:open-recent`（带 `{path}`）不再由原生菜单发出，
> 前端子代理请改为监听 `ke-menu:refresh-recent` 并自建最近列表。

## 2. 多实例互斥（P1-12）
- Cargo.toml 增加 `tauri-plugin-single-instance = "2"`，`Builder` 上于 `setup` **之前**
  `.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| { /* 聚焦已有主窗口 */ }))`。
- 清理旧 sidecar 前校验进程命令行：`sidecar.rs::is_backend_process(pid)` 用
  `Get-CimInstance Win32_Process` 读取 `CommandLine`，包含 `knowledgeeditor-backend` 才 `taskkill /T /F`；
  不匹配则只清 stale 记录不杀进程。非 Windows 退化为原逻辑。
- `start.ps1` / `stop.ps1` 同样在停止前校验命令行（backend 匹配 `uvicorn app.main:app`，
  frontend 匹配 `node_modules\vite\bin\vite.js`）。

## 3. 权限收紧与 CSP（P1-15）
- `capabilities/default.json` 移除 `shell:allow-spawn` 与 `shell:allow-execute`（前端未使用
  `@tauri-apps/plugin-shell`）。**注意**：若 Rust 侧 `app.shell().sidecar(...)` 触发 webview ACL 校验，
  需改为最小化 scope（仅允许 sidecar 二进制）；当前实现假定 Rust 直连 shell 插件 API 不受
  capability 约束（请在实际编译后验证此假设）。
- `tauri.conf.json` 设置最小 CSP（含 `connect-src` 允许本机任意端口以适配动态后端端口：
  `http://127.0.0.1:*` / `ws://127.0.0.1:*`；KaTeX 需要 `style-src 'unsafe-inline'`、
  `font-src 'self' data:`、`img-src data: blob:`；mathlive worker 需要 `worker-src 'self' blob:`）。

## 4. 后端侧车可复现构建（P1-16）
- 侧车产物：`desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`
  （externalBin 约定带 target triple 后缀）。
- 从源码构建（Windows，在**仓库根**执行，以匹配 spec 的 `pathex=['backend']`）：
  ```powershell
  python -m pip install -r backend/requirements.txt pyinstaller
  python -m PyInstaller backend/knowledgeeditor-backend.spec --distpath desktop/src-tauri/binaries --workpath backend/build/pyinstaller --noconfirm --clean
  Move-Item -Force desktop/src-tauri/binaries/knowledgeeditor-backend.exe desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe
  ```
- **hash manifest**：`scripts\build.ps1` 的 `Get-HashManifest` 对 `binaries/*.exe` 与
  `frontend/dist-build/*` 计算 SHA256，输出 `desktop/src-tauri/binaries/versions.json`
  （schemaVersion=1，含 path/size/sha256/built_at）。CI「desktop」job 亦在源码构建后生成该清单。
- 仓库内预编译的 12.6MB exe **保留不删**，由 versions.json 覆盖其校验（P1-16）。

## 5. 安装包签名（P4-6）
- 无证书不伪造签名。`scripts\build.ps1` 的 `Invoke-OptionalSign`：当环境变量
  `KE_SIGN_CERT_THUMBPRINT` 存在时对 sidecar exe（及 NSIS 安装器若存在）调用
  `signtool sign /sha1 <thumbprint> /fd SHA256 /tr http://timestamp.digicert.com /td SHA256`；
  未配置则跳过并在日志注明「未签名」。
- CI 需要 Authenticode 证书：把 PEM/PFX 导入证书库并设置 `KE_SIGN_CERT_THUMBPRINT` 为机密环境变量；
  当前 `.github/workflows/ci.yml` 未注入证书（desktop job 标注 `continue-on-error`），签名属可选步骤。

## 6. 更新器（updater）规划（P3-21）
- v1.0 未引入 `tauri-plugin-updater`（无签名与分发源）。**v1.1 规划**：
  Cargo.toml 增加 `tauri-plugin-updater = "2"`，`tauri.conf.json` 增加
  `plugins.updater` 配置（endpoints + pubkey），并把 §5 的 Authenticode 签名作为发布前置，
  配合 CI 生成 `versions.json`（§4）做版本比对与差量更新。当前不入依赖（按任务约束）。

## 7. 跨子代理约谈（需协调/确认）
1. `frontend` 子代理：接入 `ke:close-requested`（关窗 flush）与 `ke-menu:refresh-recent`（最近列表）；
   确认不再依赖原生 `ke-menu:open-recent` 的静态路径。
2. `backend` 子代理：`test_delete_safety.py` 的 Windows 路径语义需加 `skipif`，否则 CI `windows` job 的
   pytest 将失败（P1-16 依赖）。
3. 侧车 health 身份校验（P3-13）：Rust `wait_health` 现要求响应 JSON 含 `status=="ok"` 且 `version` 字段
   存在（见 `backend/app/routers/health.py`），请后端保持这两个字段。
