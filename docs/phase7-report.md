# Phase 7 报告：桌面化实施与回归发布（v0.7.3 → v1.0.0）

> 阶段：7 | 日期：2026-08-10 ~ 2026-08-11 | 版本演进：v0.7.3（基线）→ v1.0.0（发布）
> 范围：把 KnowledgeEditor 从「浏览器 + 双进程开发环境」交付为「双击即用的 Windows 桌面软件」：Tauri 集成、后端侧车管理、应用设置系统、Workspace 桌面适配、系统集成、NSIS 安装包、回归发布。全程不重新实现 Phase 1-6 已冻结的任何功能。
> 总纲：`docs/phase7-plan.md`（决策点 D1-D7 已确认并冻结）；开工前准备与闸门见 `docs/phase7-prep.md`、`docs/phase7-freeze-check-report.md`

## 1. 阶段概述

Phase 7 以 v0.7.3 为基线开工（冻结检查通过），按 M0-M7 八个里程碑实施，最终发布 v1.0.0。桌面版与 Web 版保持架构同构：前端依然不直接访问文件，一切文件/搜索/历史操作经 FastAPI API；Markdown 仍是唯一事实源。变化点只有两处——前端宿主从 Vite dev server 变为 Tauri WebView，后端宿主从手工启动的 venv 进程变为 Tauri 管理的侧车。

| 里程碑 | 交付物 | 结果 |
| --- | --- | --- |
| M0 环境与脚手架 | Rust 1.97.1 + VS Build Tools 就绪；`desktop/` Tauri v2 工程 | cargo build 通过；`tauri dev` 冒烟窗口显示 UI |
| M1 后端侧车 | `backend/run.py` PyInstaller 入口；单文件打包；Rust Sidecar Manager | 干净环境拉起侧车 health 30s 内 ok；退出无残留；崩溃自动拉起 |
| M2 前端适配 | API 基址注入；CORS 收敛；P9/P10 收编 | dev 与 release 双模式抽测通过；vitest 70/70；OpenAPI 快照 |
| M3 设置系统 | settings.json schema v1；设置面板；Rust 读写命令 | 四组设置读写生效；M3.1 修复 release 嵌入与首启竞态 |
| M4 Workspace 适配与迁移 | 原生目录选择；首启引导；app_config 重定向与迁移 | 复制 workspace 后文档/附件/模块/搜索/历史正常；卸载不清数据 |
| M5 桌面集成 | 图标、窗口、原生菜单、关于 | 菜单四组全链路验证通过；DevTools debug 可用 |
| M6 构建安装包 | NSIS 安装包 + 卸载 | 干净环境 7 步验收全过；卸载保留数据；退出弹窗修复闭环 |
| M7 回归与发布 | 版本号统一 v1.0.0；安装包发布 | 构建 `KnowledgeEditor_1.0.0_x64-setup.exe`；GitHub Releases 分发 |

关键决策 D1-D7 全部按默认方案冻结（2026-08-10）：D1 侧车形态 PyInstaller 单文件、D2 仅 NSIS（currentUser）、D3 动态端口 3 次重试、D4 设置落盘 `%APPDATA%\KnowledgeEditor\settings.json`、D5 默认 workspace 在数据目录、D6 .md 文件关联 v1.0.0 不做、D7 发布版本 v1.0.0。

## 2. Tauri 集成情况

新增 `desktop/` 工程（Tauri v2，Rust 主进程 + WebView2），`tauri.conf.json` 配置窗口（title=KnowledgeEditor、1440×900、min 1000×640、center、resizable）、`bundle.externalBin` 嵌入侧车、`frontendDist` 指向 `frontend/dist-build`（vite `outDir` 自 M3.1 起与 tauri.conf 同步，彻底绕开 dist 幽灵文件）。

集成细节：

- release 嵌入前端资源依赖 `tauri` crate 的 `custom-protocol` feature，缺失时二进制回退 devUrl（M3.1 修复）。
- 前端挂载前经 `get_runtime_info` 注入 `window.__KE_API_BASE__`，环境判定 `location.hostname === 'tauri.localhost'` 或 `'__TAURI_INTERNALS__' in window` 双条件，invoke 重试 10 次 × 400ms（M3.1 修复首启竞态）。
- 原生菜单（`menu.rs`）：文件（新建文档 Ctrl+N / 打开 Workspace Ctrl+O / 最近动态子菜单 / 退出 Ctrl+Q）、编辑（撤销/重做/剪切/复制/粘贴/全选）、视图（重新加载 Ctrl+R；debug 追加开发者工具 F12）、帮助（关于）。菜单 ID 命名空间 `ke-menu:*`，「新建文档/打开 Workspace/打开最近」emit 同名事件到前端复用既有 handler；「最近」子菜单读 `app_config.json` 的 `recent_workspaces`（上限 8，路径即 ID 前缀 `recent:`）。
- 统一退出 `request_exit`：hide 主窗口 + 后台线程清理 + `app.exit(0)`，与窗口关闭（CloseRequested）共用，清理不在事件处理器内同步执行。
- 应用图标：GDI+ 生成 blue-600 圆角方块 + 白 KE 1024 PNG，`npx tauri icon` 生成全套 19 个图标文件。

## 3. Sidecar 管理方案

侧车采用 Phase 0 已确认的 A1 方案：PyInstaller 单文件打包 FastAPI 后端，Tauri 经 `bundle.externalBin` 持有并管理生命周期。

- 打包入口 `backend/run.py`（对象式导入，供 PyInstaller 静态分析）；spec 文件 `backend/knowledgeeditor-backend.spec` 已入库，含 11 个 uvicorn hidden-import（uvicorn 动态导入收编）；产物 `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe` 置于 `desktop/src-tauri/binaries/`，M7 版本号修正后重打包 12,637,983 B。
- `sidecar.rs` 实现四段式流程：清理旧进程 → 动态端口预选（默认 8000，被占换端口最多 3 次）→ 拉起 + health 握手（`GET /api/health` status=ok，30s 超时 / 1s 间隔）→ 写 runtime.json（`%APPDATA%\KnowledgeEditor\runtime\runtime.json`）。
- 崩溃自动拉起 ≤3 次（`SHUTTING_DOWN` 标记区分用户主动退出）；退出清理：优雅终止 `taskkill /PID`（独立线程，PyInstaller bootloader 可能不响应 CTRL_CLOSE_EVENT）+ 轮询 ≤5s + 超时 `taskkill /T /F` 整树强杀 + 删 runtime.json。
- 环境注入：`KE_HOST`/`KE_PORT`/`KE_WORKSPACE`/`KE_APP_CONFIG`/`KE_CORS_ORIGINS`（debug 追加 dev 端口）；CORS 固定放行 `http(s)://tauri.localhost`。
- M6 修复：`is_alive()` 的 tasklist 轮询补 `CREATE_NO_WINDOW`，消除退出时连续弹出空白终端窗口（用户真实环境实测闭环）。

## 4. 设置系统说明

应用层设置独立于文档数据，落盘 `%APPDATA%\KnowledgeEditor\settings.json`（schemaVersion 1，camelCase，未知键忽略）。

- 四组设置：启动（默认工作区、自动保存间隔）、编辑器（默认字体等）、界面（主题 system/light/dark）、维护（打开日志目录 / 打开数据目录 / 重建索引）。
- Rust `settings.rs` 命令：`get_settings` / `update_settings`（深合并 patch + sanitize + tmp+rename 原子保存，UTF-8 BOM 兼容）/ `open_log_dir` / `open_data_dir`。
- 前端 `settings.ts` + `SettingsPanel.tsx`（右侧抽屉，Tauri invoke ↔ localStorage `ke.settings.v1` 降级）；自动保存间隔由设置驱动（`getAutosaveIntervalMs()` 即时生效）；主题 `data-theme` + colorScheme 即时切换。
- Web 版不受影响（降级 localStorage）。

## 5. 数据目录结构

安装目录与用户数据彻底分离：NSIS `currentUser` 安装到 `%LOCALAPPDATA%\KnowledgeEditor`（仅程序本体：KnowledgeEditor.exe、knowledgeeditor-backend.exe、uninstall.exe），卸载不触碰用户数据。

```
%APPDATA%\KnowledgeEditor\          # 用户数据（卸载保留）
  workspace\                        # 文档工作区（KE_WORKSPACE 注入，默认）
    Articles\                       # 文章 .md（唯一事实源）
    Modules\                        # 可复用模块 .md
    Attachments\{images,videos,files}\
    Drafts\{backup,recovery}\       # 快照（30 份）+ 崩溃恢复草稿
    .knowledgeeditor\               # index.db（FTS v2）、settings.json、vite-cache
  settings.json                     # 应用设置（schema v1）
  app_config.json                   # 软件级配置（最近工作区等，KE_APP_CONFIG）
  runtime\runtime.json              # 侧车运行握手（backend{pid,port,started_at,version}）
  logs\                             # 侧车日志
```

app_config.json 从旧 Web 位置（`~/.knowledgeeditor/app_config.json`）自动迁移：仅在新位置不存在且两者不同时并入（只复制不动源，失败回退默认不阻塞）。

## 6. 构建方式

统一走 `npm run tauri -- build`（npm 进程树），不直接 `cargo build --release`；本机需显式注入 `RUSTUP_HOME`/`CARGO_HOME`/`PATH`（环境性，见 `DEVELOPMENT_ENVIRONMENT.md`）。

```
# 1. 后端侧车打包（PyInstaller 6.22.0，spec 已入库）
pyinstaller backend/knowledgeeditor-backend.spec
# 产物重命名为 knowledgeeditor-backend-x86_64-pc-windows-msvc.exe 放入 desktop/src-tauri/binaries/

# 2. 前端构建（ke-vite.mjs，规避本机安全软件对 esbuild.exe 的拦截）
cd frontend && npm run build        # vite outDir=dist-build，vitest 70/70、tsc -b 通过

# 3. 桌面完整打包（版本号取自 Cargo.toml / tauri.conf.json 顶层 version）
cd desktop && npm run tauri -- build
# 产物：desktop/src-tauri/target/release/bundle/nsis/KnowledgeEditor_{version}_x64-setup.exe
```

NSIS 配置：`bundle.targets=["nsis"]`、`installMode="currentUser"`、`languages=["SimpChinese","English"]`。版本信息由 Cargo.toml 与顶层 version 提供（tauri 2.11.5 的 `bundle.windows` 下不支持 productName/productVersion/fileVersion 字段）。

## 7. 安装测试结果

M6 干净环境 7 步完整安装验收全过（2026-08-11，备份并清空 `%APPDATA%\KnowledgeEditor` 模拟干净环境）：

| 步骤 | 结果 |
| --- | --- |
| 1 安装 | `/S` 静默安装；安装位置、开始菜单快捷方式、注册表 Uninstall DisplayVersion 0.7.3 确认 |
| 2 首启引导 | 「欢迎使用！…使用已有工作区 / 创建新工作区」引导页正常 |
| 3 打开工作区 | `KE_WORKSPACE` 注入后主界面完整渲染（文件树/后端 v0.7.3/搜索/重建索引/最近/标签/附件/大纲/属性） |
| 4 编辑保存 | contenteditable 插入标记点保存，磁盘 87B→151B 持久化，frontmatter 保留 |
| 5 关闭 | WM_CLOSE 后主进程 8s 内退出，侧车无残留，runtime.json 清理 |
| 6 再次启动 | 正常拉起 |
| 7 数据恢复 | 最近列表/文档内容/字数/属性时间路径全部正常 |

卸载验证：安装目录、快捷方式、注册表条目全清，进程无残留，数据目录完整保留。退出弹窗修复经用户真实环境实测通过（2026-08-11）。M7 后 v1.0.0 安装包重新构建（20,472,183 B），UI 效果（Alpha 徽标 + 后端 v1.0.0）待用户实测确认。

## 8. 已知限制

| 项 | 说明 |
| --- | --- |
| 深色主题不完整 | 仅切换 `color-scheme`，未实现完整深色 CSS 适配（注释对话框白字白底已单独修复，全局 body 兜底色已加） |
| .md 文件关联 | D6 决策：v1.0.0 不做，v1.1 引入（需定义外部文件导入语义） |
| 无代码签名 | 安装包未做 Authenticode 签名，首次运行出现「无法验证发布者」确认弹窗（Windows 按路径记忆确认状态，属预期） |
| 前端主包 1.95 MB | chunk > 500 kB 构建提示，非阻塞 |
| WebView2 隐式依赖 | 唯一外部运行时依赖，Windows 10/11 系统级常见预装 |
| stop.ps1 兜底特征串 | 依赖 vite/uvicorn 命令行入口，启动命令变更需同步 `$svcDefs` |
| 本机构建环境特殊性 | 安全软件拦截 esbuild/幽灵文件等环境性问题见 `DEVELOPMENT_ENVIRONMENT.md`，CI 干净环境不受影响（打包机待复验） |

## 9. 下一步维护建议

1. Alpha 测试期迭代：v1.0.0 起算入 Alpha 测试，以用户实测反馈驱动，版本号按 v1.x.y 递增，UI 阶段徽标对外统一为 Alpha。
2. 前端主包体积优化（chunk 拆分，非阻塞项）。
3. 深色主题完整适配（深色背景/边框的 CSS 变量方案）。
4. 可选：Authenticode 代码签名，消除「无法验证发布者」弹窗。
5. v1.1：.md 文件关联与外部文件导入语义（D6）。
6. 自动化回归接入 CI（vitest + OpenAPI 快照已就绪；端到端 CDP 冒烟脚本为一次性产物，可沉淀为 CI 任务）。

## 10. 版本与发布

M7 完成发布前版本号统一修正：UI 左上角徽标 Phase 6 → Alpha；后端 `__version__` 0.7.3 → 1.0.0（唯一数据源），前端 `version.ts`、前后端 `package.json`/`package-lock.json`、`Cargo.toml`、`Cargo.lock`（本 crate）、`tauri.conf.json` 全部同步；后端重打包 health 验证 `version=1.0.0`；前端 build 13.52s 成功 + vitest 70/70；桌面构建产出 `KnowledgeEditor_1.0.0_x64-setup.exe`。GitHub Releases 已创建 v0.7.3 与 v1.0.0 并上传对应安装包，作为版本分发渠道。v1.0.0 及以后版本算入 Alpha 测试期。
