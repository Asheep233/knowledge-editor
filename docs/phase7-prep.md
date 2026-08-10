# Phase 7：桌面化准备分析

> 阶段：7（准备分析） | 日期：2026-08-10 | 基线版本：v0.7.3（Phase 6U 完成态）
> 目的：梳理进入 Phase 7（Tauri 桌面化）前必须完成的环境、代码、工程、数据四类准备，作为 Phase 7 开工前的准备基线。
> 相关文档：`docs/phase6e-report.md`（8.1 侧车方案 / 8.2 注意事项）、`docs/phase7-prep-freeze-check.md`（冻结与稳定性检查）

## 结论

Phase 7 是工程性质最大的一次阶段跳跃：前端从「浏览器 + Vite 开发服务器」变为「打包静态资源 + WebView」，后端从「本机 venv 手动启动」变为「Tauri 侧车拉起」。其中有 3 项阻塞级准备必须先完成，其余为开工后按序推进的适配项。整体优先级：Rust 工具链 → desktop 脚手架 → 后端打包（侧车）→ 前端 API/CORS 适配 → 工程质量收尾 → 数据迁移。

## 1. 环境与工具链（阻塞项）

### 1.1 Rust 工具链缺失

本机未安装 Rust 工具链（`rustc`、`cargo` 均不可用），而 Tauri 的 `src-tauri` 需要 Rust 编译。进入 Phase 7 前必须：

- 安装 rustup（stable 工具链）与 VS Build Tools（MSVC 链接器）。
- 安装后验证：`rustc --version`、`cargo --version` 可用，且能 `cargo build` 一个最小 Tauri 项目。
- 确认 WebView2 Runtime（Windows 10/11 系统自带，Tauri 打包会检测）。

验证标准：空 Tauri 项目在本机完成编译，而非仅安装成功。

### 1.2 desktop/ 目录不存在

仓库尚无 `desktop/` 脚手架。Phase 7 规划结构：

```
desktop/
  src-tauri/        # Tauri Rust 工程：窗口、菜单、系统托盘
  src/              # 前端壳（加载打包产物或 dev server）
  sidecar/          # 后端打包产物（PyInstaller onefile）
  scripts/          # tauri dev / build 封装（需绕过本机 esbuild 拦截）
```

创建脚手架时保持 Tauri v2 官方模板，再逐项裁剪。

### 1.3 Python 运行时嵌入（最大工程点）

当前 backend 依赖本机 `backend/.venv`（`phase6e-report.md` 8.2 第 7 条明确此为最大工程点）。桌面化后用户机器没有该 venv，两条可行路线：

- **PyInstaller 单文件**：把 `app/` 与依赖打成 `sidecar/knowledgeeditor-backend.exe`，Tauri 以 sidecar 方式拉起，注入 `KE_WORKSPACE`、`KE_PORT` 环境变量。
- **embedded Python**：打包官方 embeddable Python + 依赖，体积更大但调试更直接。

两者都需在打包后实际运行一次（健康检查 + 读写 workspace）验证，不能仅以打包成功为准。

## 2. 代码与配置适配

### 2.1 前端 API 地址（相对路径依赖 Vite 代理）

`frontend/src/api/client.ts` 的全部请求为相对路径（`fetch('/api/...')`），开发期依赖 `vite.config.ts` 的 dev proxy 转发到 8000 端口。Tauri 下前端是打包后的静态资源，没有 dev server 可代理，相对请求会落到 `tauri://`/`file://` 协议而失败。适配方案：

- 引入运行时 API base：前端启动时从环境注入（如 `window.__KE_API_BASE__`）或探测后端端口，`client.ts` 的 `request()` 与 `uploadAttachment`、`exportPackage` 等裸 `fetch` 统一拼接 base。
- 端口由侧车动态分配后回传，前端 health 探测确认后端就绪再加载主界面。

### 2.2 CORS 白名单缺 Tauri origin

`backend/app/config.py` 默认 `CORS_ORIGINS` 为 `http://localhost:5173,http://127.0.0.1:5173`。Tauri WebView 的页面 origin 是 `http://tauri.localhost`，不在白名单内，跨源请求会被后端拒绝。适配方案：侧车拉起 backend 时注入 `KE_CORS_ORIGINS`（追加 `http://tauri.localhost`），默认值保持不变。

### 2.3 端口策略动态化

`config.py` 已支持 `KE_HOST`/`KE_PORT` 环境变量（默认 127.0.0.1:8000），但固定端口在多实例/占用时冲突。桌面版策略：侧车在启动时挑选空闲端口注入 `KE_PORT`，前端经 2.1 的探测机制获取实际端口；`scripts/stop.ps1` 的 `$svcDefs` 特征串（`uvicorn app.main:app`、`vite.js`）在打包后需同步更新为进程特征。

### 2.4 attachmentUrl 去重（6E P9）

`ke.ts` 与 `client.ts` 各有一份 `attachmentUrl`，行为差异在 URI 编码。6E 明确留给 Tauri 阶段合并，建议在侧车封装时统一收敛到 `client.ts` 版本。

### 2.5 版本策略

当前 v0.7.3（6U 完成态），API 以 v1 语义冻结。桌面化首次可交付发布建议直接定为 v1.0.0；发布前保持「版本三同步」（`backend/app/__init__.py` 唯一来源 + `frontend/src/version.ts` + `frontend/package.json`），`start.ps1` 对不一致给出警告。

## 3. 工程质量

| 项 | 现状 | Phase 7 动作 |
| --- | --- | --- |
| 前端测试入口 | `package.json` 无 test 脚本，需 `npx vitest run` 手动执行（6E P10） | 补 `test` 脚本（`vitest run`）并接入 `.github/workflows/ci.yml` 前端 job |
| CI 完整性 | 前端 job 只跑 `npm run build`（含 `tsc -b`），不跑单测 | 增加 vitest 步骤；后端 job 已跑 pytest |
| 日志体系 | 仅 `runtime/logs/` 四日志（dev 输出级），无滚动/分级 | 6E 明确推迟至此：滚动、分级、Tauri 端汇总 |
| 快照清理 | 每文档保留 30 份 `Drafts/backup`，无清理入口 | 提供清理入口（按文档/按全局） |
| 包体积 | 前端主包 1.94 MB（chunk > 500 kB 提示） | 非阻塞优化项，可延后 |

## 4. 数据迁移

`config.py` 已把软件级配置独立到用户目录（`~/.knowledgeeditor/app_config.json`，经 `KE_APP_CONFIG` 可覆盖），跨 workspace 的最近列表等无需随 workspace 迁移。Phase 7 需要迁移的是 workspace 内容本身（`Articles/`、`Modules/`、`Attachments/`、`Drafts/`、`.knowledgeeditor/{index.db,settings.json}`），方案沿用 6E.2 已整体验证过的搬迁路径：目标目录设为用户数据目录（如 `%APPDATA%\knowledgeeditor\workspace`），侧车注入 `KE_WORKSPACE` 指向该处。

迁移测试关注点：冷启动、旧数据读取（信息块旧自闭合格式兼容路径）、FTS 索引重建、多机时间戳（快照/草稿文件名为本机时间）。

## 5. 建议执行顺序

1. Rust 工具链安装与验证（1.1），创建 `desktop/` 脚手架（1.2）。
2. 后端打包 sidecar（1.3），本机实测拉起 + 健康检查。
3. 前端 API base + CORS + 动态端口适配（2.1–2.3），浏览器直连 8000 端口验证。
4. `attachmentUrl` 合并（2.4）、test 脚本 + CI 接入（3）。
5. 数据迁移到用户数据目录（4），跑迁移回归。
6. 版本提升 v1.0.0，全量回归后发布。
