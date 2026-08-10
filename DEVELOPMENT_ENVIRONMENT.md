# DEVELOPMENT_ENVIRONMENT.md

> 项目环境、路径与依赖基础设施文档。目标：更换开发机器 / 更换 Agent / 丢失上下文后仍可恢复。
> 最后更新：2026-08-10（Phase 7 M4）

## 系统环境

- 操作系统：Windows（PowerShell 5）
- 系统架构：x86_64
- 关键系统组件：Visual Studio Build Tools（MSVC x64，含 `VC.Tools.x86.x64`，vswhere 确认）、WebView2 Runtime

## 开发工具

### Node.js

- 版本：v22.16.0（npm 10.9.4）
- 用途：前端构建、vitest 测试、vite dev server；Tauri CLI 经 npm 运行
- 安装方式：Node.js 官方安装包
- 验证命令：`node --version`、`npm --version`

### Python

- 版本：3.10.11（pip 25.3）
- 用途：后端 FastAPI 服务（knowledgeeditor-backend），前端依赖的数据源
- 位置：`C:\Users\y8882\AppData\Roaming\TRAE SOLO CN\...\vm\tools\python`（当前环境直接使用，未建 venv）
- 安装方式：随开发环境预置
- 验证命令：`python --version`、`python -m pip --version`

### Rust / rustup

- 版本：1.97.1（stable-x86_64-pc-windows-msvc，active + default）
- 用途：Tauri v2 桌面应用构建（`cargo build --release` / `cargo test`）
- 安装方式：M0 阶段 rustup-init 安装，位于 `CARGO_HOME=%LOCALAPPDATA%\cargo`、`RUSTUP_HOME=%LOCALAPPDATA%\rustup`（用户级环境变量已持久化，新终端直接可用，无需每命令设置）
- 缺少影响：无法编译桌面二进制，release 流程中断
- 验证命令：`cargo --version`、`rustc --version`、`rustup toolchain list`
- 废弃冗余（勿再使用）：M4 曾误判「未安装」并重复安装一套至临时路径 `C:\Users\y8882\.trae-cn\work\6a773c1419e6c03a410e3eb1\rustup-home` / `cargo-home`（约 1.5GB），已弃用；统一使用 `%LOCALAPPDATA%` 工具链

### Tauri CLI

- 版本：随 `desktop/package.json` 依赖锁定（@tauri-apps/cli）
- 用途：dev 运行与 release 打包（`npm run tauri -- build`）
- 验证命令：`npm run tauri -- --version`

### Git / GitHub CLI

- 版本：Git for Windows（`C:\Program Files\Git\cmd\git.exe`）、GitHub CLI（`C:\Program Files\GitHub CLI\gh.exe`）
- 用途：项目版本管理；远程备份（GitHub 私有仓库）
- 安装方式：用户手动安装（Git for Windows + GitHub CLI）
- 远程仓库：`https://github.com/Asheep233/knowledge-editor`（private，默认分支 master，账号 Asheep233，token scopes 含 repo/workflow，gh 已登录 keyring）
- 网络：GitHub 直连不稳定（20.205.243.166 等 IP 偶发不可达），依赖本机 Clash 代理 `127.0.0.1:7890`；git 全局已配 `http.proxy/https.proxy=127.0.0.1:7890`；gh 命令前需设环境变量 `HTTPS_PROXY/HTTP_PROXY`（会话级，不持久）
- 特殊配置：
  - `maintenance.auto=false`（本仓库已禁用）：Windows 上首次 commit 触发 git 自动 repack 会异常卡顿（CPU 高占用、输出挂起），禁用后可避免
  - 本环境终端 PATH 不含 git/gh，调用需完整路径或在命令前追加 `$env:PATH = 'C:\Program Files\Git\cmd;' + $env:PATH`
- 缺少影响：无法提交/推送代码，失去远程备份
- 验证命令：`git --version`、`gh auth status`、`git remote -v`

## 镜像源（网络受限环境必需）

- crates.io 镜像（M0 配置，位于 `%LOCALAPPDATA%\cargo\config.toml`，用户级全局生效）：
  ```toml
  [source.crates-io]
  replace-with = 'rsproxy-sparse'
  [source.rsproxy-sparse]
  registry = 'sparse+https://rsproxy.cn/index/'
  [registries.rsproxy]
  index = 'sparse+https://rsproxy.cn/index/'
  [net]
  git-fetch-with-cli = true
  ```
- rustup 发行镜像（仅 M0 安装时使用过）：`RUSTUP_DIST_SERVER=https://rsproxy.cn`、`RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup`（static.rust-lang.org 直连不可用）
- 前端依赖（npm）：默认 registry，未配镜像

## 项目依赖

### Frontend（`frontend/`）

- Node v22.16.0
- 关键依赖（package.json）：react、react-dom、vite、vitest、typescript、@tauri-apps/api、@tauri-apps/plugin-dialog、katex、marked、mathlive 等
- 构建工具：vite，`build.outDir = 'dist-build'`（M3.1 起，避开 dist 幽灵文件）
- 测试：vitest + happy-dom

### Backend（`backend/`）

- Python 3.10.11（当前环境直接使用，未建 venv）
- requirements.txt：fastapi、uvicorn[standard]、pydantic、python-multipart；测试：pytest、httpx
- 测试命令：`python -m pytest backend/tests -q`（从项目根）

### Desktop（`desktop/src-tauri/`）

- Tauri v2（`tauri = { version = "2", features = ["custom-protocol"] }`，M3.1 修复）
- Rust 1.97.1
- sidecar：`binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（externalBin，release 复制为 knowledgeeditor-backend.exe）
- 打包：NSIS → `KnowledgeEditor_0.7.3_x64-setup.exe`
- 前端资源：内嵌 `frontend/dist-build`（frontendDist）

## 本机特殊环境（必须知晓）

### D:\Agent 虚拟化层幽灵文件

- 现象：文件元数据可见（PowerShell 列目录有正确大小），但 node/Python 进程读取返回 ENOENT；`rmSync`/`Remove-Item` 报告成功但文件仍在（假删除）；目录重命名（rename）多数可用但被进程占用时 EPERM；`D:\Agent\KnowledgeEditor\frontend\node_modules.ghostbak` 为废弃残留
- 影响：`D:\Agent` 下 node_modules 不可靠，npm install / vitest / tsc / build 可能异常
- 对策：**镜像工作区策略**——源码复制到干净路径 `C:\Users\y8882\.trae-cn\work\6a773c1419e6c03a410e3eb1\ke-frontend`，在镜像安装依赖并跑 vitest/tsc/build；产物 `dist-build` 经 `sync-dist.js` 同步回 `D:\Agent\KnowledgeEditor\frontend\dist-build` 供 release 构建内嵌
- 复制/同步脚本：`mirror-frontend.js`、`sync-dist.js`（位于临时工作区根）

### 用户数据与程序文件分离

- 程序文件：`D:\Agent\KnowledgeEditor\`（源码、二进制）
- 用户数据：`%APPDATA%\KnowledgeEditor\`（settings.json、app_config.json、logs、runtime、默认 workspace 副本）
- 旧 Web 版配置：`~/.knowledgeeditor/app_config.json`（M4 起桌面版首次启动自动并入 `%APPDATA%\KnowledgeEditor\app_config.json`，只复制不动源）

## 关键环境变量（桌面运行 / 构建）

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `KE_WORKSPACE` | 任意目录（缺省 `D:\Agent\KnowledgeEditor\workspace`） | 后端工作区根；冒烟测试指向临时空目录 |
| `KE_APP_CONFIG` | `%APPDATA%\KnowledgeEditor\app_config.json`（sidecar 强制注入） | 软件级配置（最近工作区/文档） |
| `KE_APP_CONFIG_LEGACY` | `~/.knowledgeeditor/app_config.json`（可外部覆盖） | 旧 Web 版配置迁移源 |
| `KE_CORS_ORIGINS` | `http(s)://tauri.localhost`（debug 追加 dev port） | 后端 CORS 白名单 |
| `KE_HOST` / `KE_PORT` | `127.0.0.1` / `8000` | 后端监听 |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | `--remote-debugging-port=9223` | 冒烟测试启用 WebView2 CDP |
| `RUSTUP_HOME` / `CARGO_HOME` | `%LOCALAPPDATA%\rustup` / `%LOCALAPPDATA%\cargo`（用户级已持久化） | Rust 工具链位置（一般无需手动设置） |
| `RUSTUP_DIST_SERVER` / `RUSTUP_UPDATE_ROOT` | `https://rsproxy.cn`（仅安装时） | rustup 安装镜像 |

## 依赖增删原则

新增/删除重要依赖时必须更新本文件，说明：为什么需要、被哪个模块使用、缺少影响。
