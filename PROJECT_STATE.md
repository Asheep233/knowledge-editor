# PROJECT_STATE.md

> 项目状态唯一快速参考。每次阶段变更或影响架构的修改后更新。
> 最后更新：2026-09-05（v1.1.1-pre.1 预发布） | 维护依据：docs/phase6u-report.md、docs/phase7-prep-freeze-check.md、README.md、代码版本常量

## 当前状态

| 项 | 值 |
| --- | --- |
| 当前开发阶段 | Phase 6U（真实环境测试迭代）已完成；冻结与稳定性检查通过（2026-08-10）；Phase 7 全部完成；v1.1.0（UI/UX 重构）正式发布（2026-09-05）；**v1.1.1-pre.1 预发布（新建文件夹入口修复）——Alpha 测试期延续** |
| 当前版本号 | **v1.1.1-pre.1**（唯一来源 `backend/app/__init__.py`；`frontend/src/version.ts`、`frontend/package.json`、`desktop/package.json` + `desktop/package-lock.json`、`desktop/src-tauri/Cargo.toml` + `Cargo.lock`、`tauri.conf.json` 七处同步；v1.0.0 及以后版本算入 Alpha 测试） |
| 启动方式 | `.\scripts\start.ps1`（前后端一键启动）/ `.\scripts\stop.ps1`（一键停止，含无 runtime.json 的端口+特征兜底） |
| 前端地址 | http://localhost:5173 |
| 后端地址 | http://127.0.0.1:8000 |

## 已完成功能

- 编辑器核心：Tiptap/ProseMirror 所见即所得，知乎式体验（Phase 2 起）
- Markdown 扩展（ke_version = 1）：注释（脚注）、信息块、模块、附件、视频标记（规范见 `docs/markdown-extension-spec.md`）
- 信息块：块内可编辑文本、块内脚注、徽章标题自定义、五色系联动（v0.7.0/v0.7.1/v0.7.2）
- 注释（脚注）：两种样式可选（脚注区域 / 纯 Markdown，localStorage 记忆）、上标可点击修改、光标安全（v0.6.2–v0.6.5）
- 表格：插入 3×3、光标悬浮气泡菜单（增删行列/合并拆分/删表，6E 冻结后）
- 附件：工具栏上传 + 拖拽文件到编辑区直接插入 attach/video 节点（v0.6.1）；孤儿附件仅手动删除
- 模块系统：可复用 Markdown 模块（Phase 5）
- 全文搜索与可靠性：FTS 索引、历史版本、自动保存、导入导出（Phase 6）
- 文档属性面板：创建/修改时间、字数、大小（v0.7.3 修复保存后显示「—」）

## 正在进行的任务

- Phase 7 M0（环境与脚手架）已完成：Rust 1.97.1 + VS Build Tools 17.14.37（MSVC 14.44 / SDK 10.0.26100）就绪；`desktop/` Tauri v2 工程创建（`cargo build` 通过，`tauri dev` 冒烟窗口显示 UI）。
- Phase 7 M1（后端侧车）已完成：`backend/run.py`（PyInstaller 入口）+ 单文件打包（12,637,746 B，含 11 个 uvicorn 隐藏导入）放入 `desktop/src-tauri/binaries/`（带 target triple 后缀）；Rust Sidecar Manager（`desktop/src-tauri/src/sidecar.rs`）实现四段式流程（清理旧进程 → 动态端口 → 拉起 + health 握手 → 写 runtime.json），含崩溃自动拉起（≤3 次）与退出清理（优雅终止 → 5s 超时 → PID 树强杀）。`tauri dev` 集成冒烟通过：窗口 → 侧车 → UI 全链路、退出无残留、崩溃自动恢复均验证。
- Phase 7 M2（前端适配）已完成：`main.tsx` 挂载前 `invoke('get_runtime_info')` 注入 `window.__KE_API_BASE__`（`'__TAURI_INTERNALS__' in window` 检测，失败回退 Vite 代理）；`client.ts` 新增 `apiBase()` 统一拼接（含 4 处直接 fetch 与 uploadAttachment）；P9 `attachmentUrl` 合并至 client.ts（逐段 URI 编码）；P10 `package.json` 补 `test` 脚本（vitest run）+ CI frontend job 加 Unit tests + 新增 `backend/tests/test_openapi_snapshot.py`（36 路径 / 47 方法快照断言）。验收通过：vitest 62/62、typecheck、build（1.94 MB）、后端快照 2 passed、dev 冒烟（CORS 修复后 7 项核心 API 抽测全通过、退出清理无残留）、release 冒烟（`cargo build --release` → health/OPTIONS/GET 全 200 → WM_CLOSE 全清理）。
- Phase 7 M3（设置系统）已完成：`settings.json` schema v1 落盘 `%APPDATA%\KnowledgeEditor\settings.json`（启动 / 编辑器 / 界面 / 维护四组，应用层存储，与文档数据分离）；Rust `settings.rs` 读写命令（`get_settings` / `update_settings` 深合并 + 原子保存 + UTF-8 BOM 兼容 / `open_log_dir` / `open_data_dir`），重建索引复用后端 `POST /api/index/rebuild` 不新增接口；前端 `settings.ts` + `SettingsPanel.tsx`（右侧抽屉，Tauri invoke ↔ localStorage `ke.settings.v1` 降级）；自动保存间隔由设置驱动（EditorArea 两处 3000 硬编码改 `getAutosaveIntervalMs()`）；主题 data-theme + colorScheme 即时生效。验收通过：cargo test 8/8、vitest 70/70、typecheck、build（1.95 MB）、dev 冒烟 CDP 端到端（预置 dark/8000/30 正确读取、主题切换、面板内重建索引、open_log_dir 创建 logs、关闭正常）、WM_CLOSE 退出清理无残留（settings.json 保留）。M3.1 release 冒烟与修复已完成：Cargo.toml 补 `custom-protocol` feature（release 二进制嵌入前端资源）、vite outDir 改 `dist-build` + tauri.conf frontendDist 同步（彻底绕开 dist 幽灵文件，统一 `npm run tauri -- build` 构建路径）、`main.tsx` 首启 IPC 竞态修复（hostname=tauri.localhost + internals 双条件判定 + invoke 10×400ms 重试）；release 面板端到端（autosave/retention 读值与即时保存、重建索引结果、关闭）与退出清理（进程 0 / 8000 释放 / runtime\ 目录清空 / settings.json 保留）全通过。
- Phase 7 M4（Workspace 桌面适配与迁移）已完成：软件级配置 `app_config.json` 重定向到 `%APPDATA%\KnowledgeEditor\`（sidecar 注入 `KE_APP_CONFIG`），首次启动自动并入旧 Web 版位置（`~/.knowledgeeditor/app_config.json`，`KE_APP_CONFIG_LEGACY` 可覆盖，只复制不动源）；`POST /workspace/open|create` 成功后写最近工作区记录，`GET /workspace/recent` 逐条返回 `exists`（实时 `is_dir`），`DELETE /workspace/recent` 移除记录；前端 `desktop.ts`（`isDesktop()` 双条件 + `pickDirectory()` 原生目录选择器，Web 回退 prompt）；首启两选项引导（空 workspace 且无最近记录时显示「使用已有工作区 / 创建新工作区」）；`WorkspacePicker` 最近列表支持失效路径置灰 +「路径已失效」徽标 + 移除。验收通过：后端 pytest 全过（含 test_app_config_migration）、vitest 70/70、tsc -b、npm run build、cargo test 8/8、cargo build --release（3m49s、16.9MB、内嵌 index-C4HBtfzV.js）；release 冒烟（CDP 9223）首启引导出现 → 点击「创建新工作区」主界面打开 → app_config.json 生成且 recent 写入 → API 验证 open/recent/exists（目录重命名后 exists:false）/delete 全通过 → 二次启动不再引导 + 设置面板回归 → WM_CLOSE 两轮退出清理（进程 0 / 端口释放 / runtime 清空 / app_config.json 保留）。**环境变更**：Rust 1.97.1 工具链经 rustup + rsproxy 镜像安装至临时路径（`rustup-home`/`cargo-home`），cargo 配 rsproxy-sparse 镜像；前端验证在镜像工作区（`ke-frontend`，绕开 D:\Agent 幽灵文件），产物 dist-build 同步回真实路径。
- Phase 7 M5（桌面集成）已完成：应用图标（`gen-app-icon.ps1` GDI+ 生成 blue-600 圆角方块 + 白 KE 1024 PNG → `npx tauri icon` 生成全套 19 个图标文件，含 icon.ico/icon.png/icon.icns 等）；窗口配置（`tauri.conf.json`：title=KnowledgeEditor、1440×900、min 1000×640、center、resizable，符合 7.5 表）；原生菜单栏（`desktop/src-tauri/src/menu.rs` 四组：文件=新建文档 Ctrl+N/打开 Workspace Ctrl+O/最近动态子菜单（读 app_config.json `recent_workspaces`，上限 8，空时置灰提示）/退出 Ctrl+Q；编辑=撤销/重做/剪切/复制/粘贴/全选预置项；视图=重新加载 Ctrl+R + debug 模式「开发者工具 F12」；帮助=关于（读 SidecarState runtime 版本/工作区 + dialog 展示））；统一退出 `request_exit`（hide + 后台线程 cleanup_on_exit + app.exit(0)，与窗口关闭一致，M2 约定复用）；前端 `App.tsx` 菜单事件监听（`ke-menu:new-document`→新建文档、`ke-menu:open-workspace`→打开工作区、`ke-menu:open-recent`→切换最近工作区，复用既有 handler，动态 import `@tauri-apps/api/event` 保持 Web 零依赖）。验收通过：cargo test --release 8/8、vitest 70/70、typecheck、npm run build（11.92s，dist-build 73 文件同步）、dev 冒烟（Win32 枚举原生菜单：4 组顶级 + 各组子项/快捷键/分隔线齐全、debug 下「开发者工具」存在；窗口 MainWindowTitle=KnowledgeEditor、RECT 1453×936 物理像素对应 1440×900 逻辑（192 DPI）、居中偏差 (0,4)；CDP 验证 WebView 内容区 1440×881、页面完整加载无 JS 错误；WM_COMMAND(1019) 触发「开发者工具」→ DevTools 窗口弹出；WM_COMMAND(1003) 触发「新建文档」→ CDP 捕获 Page.javascriptDialogOpening（message=文档标题）→ 自动接受后文章树出现新文章「m5菜单冒烟测试.md」+ 编辑器未保存状态，证明 菜单→Rust emit→前端 listen→复用既有动作 全链路通；WM_COMMAND(1007)「退出」→ 应用干净退出、WebView2 子进程回收、5173/9223 端口释放、测试文章清理）。下一步 M6 构建安装包。
- Phase 7 M6（构建安装包）已完成：`tauri.conf.json` 配置 NSIS 打包（`bundle.targets=["nsis"]`、`windows.nsis.installMode="currentUser"` + `languages=["SimpChinese","English"]`；版本信息由 Cargo.toml/顶层 version 提供，`bundle.windows` 下不支持 productName 等字段）；构建产物 `desktop/src-tauri/target/release/bundle/nsis/KnowledgeEditor_0.7.3_x64-setup.exe`（19.1MB，NSIS-3 Unicode；含主程序/侧车/uninstall.exe）。验收（本机完整安装验收，2026-08-11）：备份并清空 `%APPDATA%\KnowledgeEditor` 模拟干净环境后，7 步全过——1 静默安装（安装位置/快捷方式/注册表 Uninstall DisplayVersion 0.7.3）→ 2 首启引导页（CDP 验证「欢迎使用！…使用已有工作区/创建新工作区」）→ 3 `KE_WORKSPACE` 注入打开工作区（主界面完整渲染：文件树/后端 v0.7.3/搜索/重建索引/最近/标签/附件/大纲/属性）→ 4 CDP 在 contenteditable 编辑器插入 `[M6-验收-安装版编辑保存-…]` 标记点「保存」（磁盘 87B→151B 持久化，frontmatter 保留）→ 5 WM_CLOSE 关闭（8s 内退出，侧车无残留，runtime.json 清理）→ 6 再次启动正常 → 7 数据恢复（最近列表/文档内容含标记/字数 30/属性时间路径正常）。卸载验证：安装目录、开始菜单快捷方式、注册表条目全清，进程无残留，数据目录（runtime/workspace/app_config.json/settings.json）完整保留。数据目录已从备份恢复。**环境注意**：JS `window.close()` 不触发 tao CloseRequested（只销毁 WebView），正常关闭须走系统 WM_CLOSE；本终端 PATH 无 taskkill 需用 Stop-Process。下一步 M7 回归发布 v1.0.0（已完成，见下）。
- Phase 7 M7（回归发布 v1.0.0）已完成：发布前版本号统一修正——UI 左上角阶段徽标 Phase 6 → Alpha（`App.tsx`）；后端 `__version__` 0.7.3 → 1.0.0（版本唯一数据源，UI 右上角「后端 v${health?.version}」随之显示 v1.0.0）；`frontend/src/version.ts`、`frontend/package.json`、`desktop/package.json`、`Cargo.toml`、`Cargo.lock`（本 crate）、`tauri.conf.json`、`DEVELOPMENT_ENVIRONMENT.md` 产物名全部同步 1.0.0（第三方 cfb 依赖 0.7.3 不动，历史文档保留 0.7.3 记录）；后端重新 PyInstaller 打包（12,637,983 B，含 11 个 uvicorn hidden-import）替换 binaries，health 验证 `version=1.0.0`。验证通过：前端 build 13.52s 成功 + vitest 70/70、后端 health 200 version=1.0.0；桌面完整构建 `Compiling knowledgeeditor v1.0.0`，产出 `KnowledgeEditor_1.0.0_x64-setup.exe`。**版本约定：v1.0.0 及以后版本算入 Alpha 测试期；UI 阶段徽标对外统一为 Alpha**。

## 已冻结内容

| 冻结项 | 说明 |
| --- | --- |
| API 端点清单 | v1 无前缀，冻结于 Phase 6E（见 `docs/phase6e-report.md`） |
| 信息块 Markdown 包裹格式 | `<!-- ke-note: {json} -->\n内容\n<!-- /ke-note -->`，v0.7.0 起冻结；旧自闭合格式仅保留读取兼容 |
| Markdown 扩展版本 | ke_version = 1，数据格式不变 |
| settings schema / FTS schema | 1 / 2 |

## 已知问题

| 问题 | 影响 | 备注 |
| --- | --- | --- |
| 前端主包 1.95 MB（chunk > 500 kB） | 构建仅有体积提示，不影响运行 | Phase 7 非阻塞优化项 |
| `stop.ps1` 兜底依赖命令行特征串 | 若启动命令变更（如 Tauri 侧车），需同步 `scripts/stop.ps1` 的 `$svcDefs` | 启动方式冻结前保持 |
| 开发页依赖 esbuild 改名副本 | 安全软件按文件名拦截 `esbuild.exe` 写入，需 `.esbuild/esbuild-renamed.exe` 副本 + `ESBUILD_BINARY_PATH` | 环境性；CI 无安全软件无需副本，Phase 7 打包机待复验 |
| 文件树项为 div（无 title 属性） | 自动化脚本按 `aside [title]` 定位会命中「最近」列表而非文件树 | 冻结检查 3.6 确认，非用户可见缺陷；e2e 需按 span 文本 + `div.cursor-pointer` 定位 |
| 外部写入 workspace 的文件需重建索引 | 直接写盘的 .md 不即时出现在文件树 | 设计行为（正常新建走 API 即时索引）；freeze-check 3.6 确认 |
| 桌面 dev 模式 vite 代理写死 `127.0.0.1:8000` | 若 8000 被占、sidecar 动态换端口，dev 下前端 `/api` 代理失效（release 直连同源服务不受影响） | M2 基址注入已收敛：dev 注入 `get_runtime_info` 实际端口，`/api` 代理仅作无注入回退 |
| 本地 release 构建 dist 虚拟层幽灵文件（已绕行） | `frontend/dist` 存在可见不可删的陈旧产物（幽灵文件），tauri-build 扫描列资产后宏读取失败；已绕行：vite `outDir` 改 `dist-build` + tauri.conf `frontendDist` 同步，统一 `npm run tauri -- build`（需注入 `RUSTUP_HOME`/`CARGO_HOME`/`PATH`，见约束 15） | 环境性；CI 干净环境不受影响，打包机待复验 |
| 深色主题仅切换 `color-scheme`，UI 无深色 CSS 适配（2026-08-10 修复注释对话框白字白底后） | dark 主题下未显式着色元素依赖 body 兜底色（`#1f2937`）；完整深色视觉（深色背景/边框）未实现 | 已知项；注释对话框 textarea 已加显式 `text-gray-900 caret-blue-600`；完整深色适配待后续版本 |

## 架构关键约束

1. **Markdown 是唯一事实源**：`workspace/Articles/` 下的 .md 文件可直接脱离软件访问；SQLite（`index.db`）仅为搜索/历史索引，可删除重建（FTS schema 2）。
2. **前端不直接访问文件**：所有文件/搜索/历史操作经 FastAPI 后端 API（http://127.0.0.1:8000）。
3. **版本三处同步**：`backend/app/__init__.py`（唯一来源）、`frontend/src/version.ts`、`frontend/package.json` 必须一致，不一致时 `start.ps1` 会警告。
4. **Vite 依赖预构建缓存移出 node_modules**：`vite.config.ts` 的 `cacheDir` 指向 `../workspace/.knowledgeeditor/vite-cache`（沙箱保护 node_modules 的目录 rename 操作）。
5. **前端构建必须经 `ke-vite.mjs`**（或 `npm run build` 走 ESBUILD_BINARY_PATH）：直接运行 esbuild 会被本机安全软件拦截。
6. **信息块包裹格式已冻结**：后续 phase 的格式变更必须保留旧格式读取兼容路径（parseHTML 双规则 + `Fragment.fromJSON` 迁移）。
7. **孤儿附件不自动删除**：仅支持手动删除；被引用附件后端返回 409 拒绝删除。
8. **后端隔离文件删除**：`backend/app/services/workspace.py` 只允许删除 workspace 内部路径，防止路径穿越。
9. **Rust 工具链（M0 安装，M4 修正）**：本机安全软件按路径拦截 `~\.cargo` 与 `~\.rustup` 下的硬链接创建，M0 将工具链安装至 `CARGO_HOME=%LOCALAPPDATA%\cargo`、`RUSTUP_HOME=%LOCALAPPDATA%\rustup`（stable 1.97.1，用户级环境变量已持久化，新终端直接可用；crates 镜像 `sparse+https://rsproxy.cn/index/` 见 `%LOCALAPPDATA%\cargo\config.toml`）。M4 曾误判「未安装」（仅检查 `~\.cargo` 残留的 rustup-init 本体与 `~\.rustup`，未检查 `%LOCALAPPDATA%`），重复安装一套至临时路径（`...\rustup-home`/`cargo-home`，约 1.5GB，已弃用勿再使用）；统一使用 `%LOCALAPPDATA%` 工具链。
10. **桌面侧车（M1 冻结约定）**：打包入口 `backend/run.py`（对象式导入，供 PyInstaller 静态分析）；产物命名 `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe` 置于 `desktop/src-tauri/binaries/`，`tauri.conf.json` 配 `bundle.externalBin`；Rust 侧 `SIDECAR_NAME` 不含 triple 后缀。
11. **runtime.json 桌面版 schema**：与 `start.ps1` 一致（`backend{pid,port,started_at,version}` + `frontend:null` + `project_version` + `started_at`），落盘 `%APPDATA%\KnowledgeEditor\runtime\runtime.json`；启动握手唯一依据 `GET /api/health` 返回 `status=ok`（30s 超时 / 1s 间隔）；动态端口默认 8000、被占换端口最多 3 次。
12. **退出清理（M1 修复后的约定）**：优雅终止 `taskkill /PID`（PyInstaller bootloader 可能不响应 CTRL_CLOSE_EVENT 导致 taskkill 无限等待，故放独立线程）+ 轮询等待最多 5s + 超时 `taskkill /T /F` 整树强杀 + 删 runtime.json；崩溃自动拉起 ≤3 次（`SHUTTING_DOWN` 标记保证用户主动退出时不重启）。M2 起 CloseRequested 处理器改为 `prevent_close + hide + 后台线程 cleanup_on_exit + app.exit(0)`，清理不得在事件处理器内同步执行。
13. **桌面 API 基址注入与 CORS（M2 冻结约定）**：桌面版前端挂载前注入 `window.__KE_API_BASE__`（判定与重试流程见约束 15）；`client.ts` 的 `apiBase()` 返回 `window.__KE_API_BASE__ ?? ''` 统一拼接（Web/测试无注入 → 空串 → 相对路径 Vite 代理回退）。CORS：后端固定放行 `http(s)://tauri.localhost`（release WebView origin）；debug 构建 `cfg!(debug_assertions)` 无条件追加 `http://127.0.0.1:5173` 与 `http://localhost:5173`（端口可被 `KE_DEV_FRONTEND_PORT` 覆盖）；`KE_CORS_ORIGINS` 环境变量会覆盖 config.py 默认值，必须显式包含上述 origin。
14. **应用层设置存储（M3 冻结约定）**：桌面版设置落盘 `%APPDATA%\KnowledgeEditor\settings.json`（schemaVersion 1，camelCase，未知键忽略，与 workspace 内文档设置 `backend/app/config.py` SETTINGS_PATH 及文章数据完全分离）；读取容错（文件缺失 / JSON 损坏 / UTF-8 BOM 均回退默认）；更新采用深合并语义（patch 仅覆盖存在的键）+ sanitize（theme 仅 system/light/dark）+ 原子保存（tmp + rename）；Web 版降级 localStorage（key `ke.settings.v1`）；自动保存间隔每次 debounce 触发时经 `getAutosaveIntervalMs()` 读缓存即时生效。
15. **release 构建与首启注入（M3.1 冻结约定）**：release 嵌入前端资源必须启用 `tauri` crate 的 `custom-protocol` feature（缺失时二进制回退 devUrl）；本机虚拟化层下 `frontend/dist` 幽灵文件不可靠，前端构建产物统一输出 `dist-build`（vite `outDir` + tauri.conf `frontendDist` 同步），release 打包统一走 `npm run tauri -- build`（npm 进程树，显式注入 `RUSTUP_HOME`/`CARGO_HOME`/`PATH`），不直接 `cargo build --release`。首启 API 基址注入按竞态安全流程：环境判定 `location.hostname === 'tauri.localhost'` 或 `'__TAURI_INTERNALS__' in window` 双条件（Tauri v2 不修改 WebView2 UA，UA 检测无效），`invoke('get_runtime_info')` 重试 10 次 × 400ms 后写入 `window.__KE_API_BASE__`；非 Tauri 环境（Web/测试）立即回退相对路径。
16. **软件级配置与最近工作区（M4 冻结约定）**：桌面版 `app_config.json` 落盘 `%APPDATA%\KnowledgeEditor\app_config.json`（sidecar 强制注入 `KE_APP_CONFIG`，外部不可覆盖），后端 `APP_CONFIG_PATH` 读该变量；`APP_CONFIG_LEGACY_PATH`（`KE_APP_CONFIG_LEGACY`，默认 `~/.knowledgeeditor/app_config.json`）仅在新位置不存在且两者不同时并入（只复制不动源，失败回退默认不阻塞）。最近工作区写入时机：`POST /workspace/open|create` 成功后 `add_recent_workspace`（后端启动自动激活不写入）；`GET /workspace/recent` 逐条实时 `is_dir` 标记 `exists`（失效路径由前端置灰显示，不自动删除）；`DELETE /workspace/recent?path=` 移除记录。桌面版首启引导：workspace 已打开且 `stats.document===0` 且最近记录为空 → 两选项引导（「使用已有工作区」走原生目录选择器 /「创建新工作区」重开默认 workspace 并写入最近记录，使下次不再引导）。桌面原生目录选择器（`pickDirectory()` 动态 import `@tauri-apps/plugin-dialog`）在自动化冒烟中不可操作系统对话框，需经 API 层验证打开/创建路径，UI 层验证最近列表点击与失效徽标渲染。
17. **桌面菜单（M5 冻结约定）**：原生菜单由 `desktop/src-tauri/src/menu.rs` 构建（`app.set_menu` + `.on_menu_event`），四组：文件（新建文档 Ctrl+N / 打开 Workspace Ctrl+O / 最近动态子菜单 / 退出 Ctrl+Q）、编辑（撤销/重做/剪切/复制/粘贴/全选，PredefinedMenuItem）、视图（重新加载 Ctrl+R；debug 构建追加「开发者工具 F12」，`#[cfg(debug_assertions)]` 门控，release 无此项）、帮助（关于）。菜单 ID 命名空间 `ke-menu:*`；菜单项即事件名，Rust 侧经 `event.id().0.as_str()` 匹配（Tauri 2.11 `MenuId(pub String)` 单字段），「新建文档/打开 Workspace/打开最近」emit 同名事件到前端（`app.emit`），前端 `App.tsx` 动态 import `@tauri-apps/api/event` 监听并复用既有 handler（Web 环境零依赖不挂载）；「最近」子菜单每次构建时读 `app_config.json` 的 `recent_workspaces`（上限 8，路径即菜单 ID 前缀 `recent:`，空列表显示置灰「（暂无最近记录）」）；「关于」读 SidecarState runtime 版本/工作区经 `dialog().message()` 展示；「退出」与窗口关闭共用 `request_exit`（hide + 后台线程 `cleanup_on_exit` + `app.exit(0)`，清理不得在事件处理器内同步执行）。`open_devtools` 受 `cfg(any(debug_assertions, feature="devtools"))` 门控，release 不可用属预期。

## 下一步计划

1. Alpha 测试期（v1.0.0 起）：桌面端发布基线已就绪（`KnowledgeEditor_1.0.0_x64-setup.exe`），进入用户实测反馈驱动的迭代；版本号继续按 v1.x.y 递增，UI 阶段徽标对外统一为 Alpha。Phase 7 总纲见 `docs/phase7-plan.md`（决策点已冻结）。
2. 前端主包体积优化（非阻塞）。

## 文档索引

| 文档 | 说明 |
| --- | --- |
| `docs/phase7-plan.md` | Phase 7 桌面化实施规划（总纲：技术选型 / 架构 / 7.1-7.8 方案 / 里程碑 / 决策点） |
| `docs/phase7-prep.md` | Phase 7 桌面化准备分析（环境/代码/工程/数据四类 + 执行顺序） |
| `docs/phase7-prep-freeze-check.md` | Phase 7 前冻结与稳定性检查（检查标准 / 契约对账 / 通过标准） |
| `docs/phase7-freeze-check-report.md` | Phase 7 前冻结与稳定性检查报告（执行结果 / 2026-08-10 通过） |
| `docs/phase7-report.md` | Phase 7 报告（桌面化实施 / 回归发布 v1.0.0，含 8 项交付说明） |
| `docs/phase6u-report.md` | Phase 6U 报告（v0.6.0 后 → v0.7.3，含表格优化与白屏修复） |
| `docs/phase6e-report.md` | Phase 6E 冻结审计（API 冻结清单 / 迁移测试 / 侧车交接） |
| `docs/v0x-journey-report.md` | v0.x 全流程总报告（Phase 0 设计 → v1.0.0 发布，呼应 phase0-architecture.html） |
| `CHANGELOG_DEV.md` | 开发日志（Bug/Feature/Refactor/Test 逐条记录） |
| `docs/markdown-extension-spec.md` / `docs/document-format.md` | Markdown 扩展规范 / 文档格式手册 |
| `docs/agent-collaboration.md` | AI Agent 协作声明（开发过程透明度说明，README 已引用） |
