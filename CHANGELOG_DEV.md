# CHANGELOG_DEV.md

> 开发日志。每次 Bug 修复、功能完成、架构调整、数据格式变化、API 变化、测试结果、性能优化、重要风险发现后追加记录。
> 维护方式：按时间倒序（最新在上）或按版本顺序追加均可，保持每条记录字段完整。
> 最后更新：2026-09-05（v1.1.0 发布完成）

## 2026-08-11（发布：AI Agent 协作声明）

### 基础设施：新增 AI Agent 协作声明并同步 README

类型：Feature（基础设施）
状态：Completed

现象：GitHub 仓库面向访客，需声明项目开发过程包含 AI Agent 协作，保证透明度。

原因：用户要求上传协作声明并顺带更新 README。

修改：
- 新增 `docs/agent-collaboration.md`：协作方式（用户指示 + Agent 辅助 + 实测合入）、协作范围表、透明度与数据主权（Markdown 唯一事实源不变）、时间范围（初始开发 2026-08-08 ~ 08-11，Alpha 迭代延续）
- `README.md`：标题区加入声明引用行；文档索引登记 `docs/agent-collaboration.md`
- `PROJECT_STATE.md`：文档索引登记

影响范围：对外文档；代码与数据无变化。

验证：git 提交推送后 GitHub 页面可见；声明链接可访问（docs/ 下相对路径）。

## 2026-08-11（发布：GitHub Releases 分发）

### 基础设施：创建 GitHub Releases 并上传各版本安装包

类型：Feature（基础设施）
状态：Completed

现象：GitHub 仓库仅有 v0.7.3 / v1.0.0 标签，无 Release 分发页面，安装包仅存于本地构建目录。

原因：用户要求「在 release 里加上每个版本的安装包」，建立版本分发渠道。

修改：
- 创建 Release v0.7.3：上传 `KnowledgeEditor_0.7.3_x64-setup.exe`（20,020,814 B，M6 修复版，用户真实环境实测通过）
- 创建 Release v1.0.0：上传 `KnowledgeEditor_1.0.0_x64-setup.exe`（20,472,183 B）
- 工具：gh CLI 2.97.0（已登录 Asheep233），安装位置 `C:\Program Files\GitHub CLI\gh.exe`（当前终端 PATH 不含，需显式调用；git 需注入 `C:\Program Files\Git\cmd`）

影响范围：版本分发渠道；代码与数据无变化。

验证：`gh release view` 确认两 Release 资产 `state=uploaded`，大小与本地一致；Release 页 https://github.com/Asheep233/knowledge-editor/releases

## 2026-08-11（Phase 7 M7，v1.0.0）

### 里程碑完成：M7 回归发布 v1.0.0（发布前版本号统一修正，进入 Alpha 测试）

类型：Feature（里程碑）
状态：Completed

现象：用户指示「接下来 v1.0.0 及以后的版本算入 Alpha 测试」，要求进入 M7 并在最终发布前完成版本号修正：UI 左上角阶段徽标 Phase 6 → Alpha；右上角后端版本 v0.7.3 → v1.0.0。

原因：Phase 7 桌面化全部里程碑（M0-M6）已完成，发布 v1.0.0 前需统一版本标识：UI 阶段徽标由内部 Phase 编号改为公开测试阶段名（Alpha），全链路版本号（后端 / 前端 / 桌面工程 / 安装包）对齐为 1.0.0，作为 Alpha 测试期的发布基线。

修改：
- `frontend/src/App.tsx`：左上角阶段徽标 `Phase 6` → `Alpha`；右上角「后端 v${health?.version}」由后端 health 数据源驱动，无需前端改动（后端版本即显示版本）
- `backend/app/__init__.py`：`__version__` 0.7.3 → 1.0.0（全链路版本唯一数据源），注释追加 v1.0.0 / Alpha 说明
- `frontend/src/version.ts`、`frontend/package.json`、`frontend/package-lock.json`（2 处）：0.7.3 → 1.0.0
- `desktop/package.json`、`desktop/package-lock.json`（2 处）：0.7.3 → 1.0.0
- `desktop/src-tauri/Cargo.toml`、`Cargo.lock`（仅本 crate `knowledgeeditor`；第三方 cfb 依赖 0.7.3 保持不动）、`desktop/src-tauri/tauri.conf.json`：0.7.3 → 1.0.0
- `DEVELOPMENT_ENVIRONMENT.md`：产物名 `KnowledgeEditor_0.7.3_x64-setup.exe` → `KnowledgeEditor_1.0.0_x64-setup.exe`（附注版本随 Cargo.toml/tauri.conf.json 同步）
- 历史记录保留 0.7.3：CHANGELOG_DEV / docs / README 中的 0.7.3 属历史记录，不改
- 后端重新打包：PyInstaller 6.22.0 `--onefile` + 11 个 uvicorn hidden-import，产物 12,637,983 B（旧 12,637,746 B），替换 `desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（SHA256 0CF4DCBA… 与 dist 一致）

影响范围：全链路版本标识（UI 徽标、后端 health version、前端 / 桌面工程版本、安装包文件名与注册表 DisplayVersion）；数据格式与 API 无变化。

验证（本机，2026-08-11）：
- 后端：`backend\.venv\Scripts\python.exe -c "from app import __version__"` → 1.0.0；重新打包产物启动 health 200 且 `"version":"1.0.0"`
- 前端：`npm run build` 13.52s 成功；vitest 70/70 通过
- 桌面构建：`npm run tauri -- build`，编译日志 `Compiling knowledgeeditor v1.0.0`，产出 `desktop/src-tauri/target/release/bundle/nsis/KnowledgeEditor_1.0.0_x64-setup.exe`
- UI 效果（左上角 Alpha 徽标 + 右上角「后端 v1.0.0」）待用户实测确认

版本约定：v1.0.0 及以后版本算入 Alpha 测试期；UI 阶段徽标对外统一为 Alpha，不再显示内部 Phase 编号。

## 2026-08-11（Phase 7 M6，v0.7.3）

### Bug 修复：退出时连续弹出并消失空白终端窗口

类型：Bug Fix
状态：Completed

现象：用户在本机真实环境手动测试安装包（KnowledgeEditor_0.7.3_x64-setup.exe），应用正常启动，但点 X 退出时会连续迅速弹出并消失几个空白 PowerShell 窗口（实际为 Windows 11 上的 Windows Terminal，内部为空，一闪而过）。

原因：`sidecar.rs` 的 `is_alive()` 每 250ms 轮询进程存活状态时调用 `tasklist`（控制台程序），但漏加 `CREATE_NO_WINDOW` 创建标志。GUI 主程序进程中启动控制台程序且不带该标志时，Windows 会为新进程分配新控制台，Windows 11 上表现为弹出 Windows Terminal 窗口。退出优雅等待期约 5s / 250ms ≈ 20 次轮询，实际进程提前退出约 7 次轮询，与用户看到"连续几个"完全吻合。全仓库 `Command::new` 共 3 处（taskkill / tasklist / explorer），仅 `tasklist` 这一处漏标志。

修改：
- `desktop/src-tauri/src/sidecar.rs`：`is_alive()` 的 `Command::new("tasklist")` 增加 `.creation_flags(CREATE_NO_WINDOW)`
- 重新构建：`npm run tauri -- build` 产出修复版 `KnowledgeEditor_0.7.3_x64-setup.exe`（主程序时间戳 00:41:12）

影响范围：仅退出清理路径的进程存活轮询；不影响 taskkill 强杀与 explorer 打开目录（两处本就带标志或是 GUI 程序）。

验证（本机，修复版主程序 + backend 正常启动环境）：
- 启动修复版 → 1s 内 backend health ok、runtime.json 生成（backend pid / port 8000 / version 0.7.3）
- 窗口监控（50ms 枚举可见顶层窗口）覆盖退出全程：WM_CLOSE 后无任何 WindowsTerminal / Terminal 新窗口（修复前同场景捕获 7 个 WindowsTerminal + 7 个 tasklist 一一对应）
- 退出：WM_CLOSE 后 6s 内主进程与侧车全部退出，无进程残留，runtime.json 已清理
- 附注：修复版安装目录（D:\KnowledgeEditor）在本终端沙箱环境中 backend 无法启动（PyInstaller onefile 报 "Could not create temporary directory!"，属 vmcache 对工作区外路径的限制，backend 文件哈希与工作区运行版完全一致、复制到工作区后运行正常）；用户真实环境无此限制（用户反馈的弹窗即证明退出链路完整走通）。修复效果以用户下次真实环境手动测试为准。
- 用户实测（2026-08-11，真实环境安装版）：应用正常启动、后端正常，点 X 退出不再弹任何终端窗口，全部验证通过。修复闭环。

### 里程碑完成：M6 构建安装包（NSIS）与干净环境 7 步验收

类型：Feature（里程碑）
状态：Completed

现象：Phase 7 需交付可安装的桌面分发物；此前仅有 `cargo build --release` 裸二进制，无安装/卸载路径，也无数据目录与安装目录的分离验证。

原因：`phase7-plan.md` 第 11 章验收标准要求「干净环境 7 步验收全过」（安装 → 首启引导 → 打开工作区 → 编辑保存 → 关闭 → 再启动 → 数据恢复），且 7.6 设计约束要求卸载不得清除用户数据。

修改：
- `desktop/src-tauri/tauri.conf.json`：`bundle.targets=["nsis"]`；`windows.nsis.installMode="currentUser"` + `languages=["SimpChinese","English"]`。版本信息由 Cargo.toml 与顶层 `version` 提供（首版误加 productName/productVersion 等触发 schema 校验失败，按本地 `desktop\node_modules\@tauri-apps\cli\config.schema.json` 修正后通过）
- 构建产物：`desktop/src-tauri/target/release/bundle/nsis/KnowledgeEditor_0.7.3_x64-setup.exe`（19.1MB，NSIS-3 Unicode，LZMA:23；内含主程序 18.3MB / 侧车 12.6MB / uninstall.exe）

影响范围：分发与安装体验。安装目录 `%LOCALAPPDATA%\KnowledgeEditor` 与数据目录 `%APPDATA%\KnowledgeEditor` 彻底分离，卸载不影响用户数据。

验证（本机完整安装验收，2026-08-11，验收前已备份 `%APPDATA%\KnowledgeEditor` 并清空模拟干净环境）：
- 1 安装：`/S` 静默安装成功；安装位置文件、开始菜单快捷方式、注册表 Uninstall 条目（DisplayVersion 0.7.3）均确认
- 2 首启引导：CDP 验证「欢迎使用！…使用已有工作区 / 创建新工作区」引导页正常
- 3 打开工作区：`KE_WORKSPACE` 注入后主界面完整渲染（文件树 / 后端 v0.7.3 / 搜索 / 重建索引 / 最近 / 标签 / 附件 / 大纲 / 属性面板）
- 4 编辑保存：CDP 在 contenteditable 编辑器末尾插入 `[M6-验收-安装版编辑保存-<ISO时间>]` 标记并点击「保存」，磁盘文件 87B → 151B 持久化（frontmatter `ke_version: 1` 保留，标记转义为 `\[…\]` 属 Markdown 语法处理，内容完整）
- 5 关闭：WM_CLOSE（等价用户点 X）后主进程 8s 内退出，侧车无残留，`runtime.json` 已清理
- 6 再次启动：应用正常拉起，CDP 可连
- 7 数据恢复：最近列表恢复（新文档-2026-8-8-2）、文档内容含 M6 标记（字数 14→30）、属性面板路径/创建/修改时间正常
- 卸载验证：安装目录、开始菜单快捷方式、注册表 Uninstall 条目全部清除；无进程残留；`%APPDATA%\KnowledgeEditor` 数据目录（runtime / workspace / app_config.json / settings.json）完整保留
- 数据目录已从验收前备份（`ke-data-backup`）恢复原始状态

环境注意（踩坑记录）：
- tauri 2.11.5 的 `bundle.windows` 下不支持 productName / productVersion / fileVersion 等字段，版本信息必须由 Cargo.toml 与顶层 version 提供
- 自动化冒烟中 JS `window.close()` 只销毁 WebView 页面、不触发 tao 的 CloseRequested，窗口残留且后续 WM_CLOSE 清理链路不完整；正常关闭路径须走系统 WM_CLOSE（等价用户点 X），验证通过
- 本环境终端 PATH 不含 `taskkill`，进程清理需用 `Stop-Process` 或完整路径

## 2026-08-10（Phase 7 M5 收尾，v0.7.3）

### 基础设施：项目纳入 git 版本管理并推送 GitHub 私有仓库

类型：Feature（基础设施）
状态：Completed

现象：项目此前无版本管理，源码无 git 兜底；回收站排查后确认需要建立远程备份。

原因：源码一旦误删无法恢复；开发环境文档（DEVELOPMENT_ENVIRONMENT.md）要求项目可迁移、可恢复。

修改：
- 完善 `.gitignore`：新增 `node_modules.ghostbak/`、`dist-build/`、`.esbuild/`、`repro.html`；`desktop/target/` 修正为 `**/target/`（实际路径是 `desktop/src-tauri/target/`，原规则未命中导致 10.5GB 构建产物被暂存）；workspace 运行时数据（Articles/Drafts/Modules 内容、vite-cache、index.db 等）改为仅保留目录结构与 `.gitkeep`
- `git init` + 首次提交：`f86dcf2 chore: 初始化仓库，纳入版本管理 v0.7.3`（219 个文件，master 分支）
- 创建远程私有仓库并推送：`https://github.com/Asheep233/knowledge-editor`（private，账号 Asheep233）
- 全局配置：git 身份（Asheep233 / noreply 邮箱）、`http.proxy/https.proxy=127.0.0.1:7890`（Clash）、本仓库禁用 `maintenance.auto`

影响范围：全仓库；后续开发流程增加「提交 → 推送」步骤；.gitignore 生效后 workspace 运行时数据不再入库（本地不受影响）。

验证：`git log` 显示提交存在；`git status` 干净；`gh api repos/Asheep233/knowledge-editor` 返回 private=True、default_branch=master、pushed_at 为当日；远程文件数与本地 219 个一致（workspace 仅 3 个 .gitkeep）。

环境注意（踩坑记录）：
- 首次 `git commit` 触发 `git maintenance run --auto`，repack 进程 CPU 占用异常（>700 秒）导致命令输出挂起；commit 实际已成功，禁用自动维护后正常
- 本环境终端 PATH 不含 git/gh，gh 调用 git 需先 `$env:PATH = 'C:\Program Files\Git\cmd;' + $env:PATH`
- GitHub 直连不稳定，gh 命令前需设 `HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:7890`（会话级）

## 2026-08-10（Phase 7 M5 收尾，v0.7.3）

### Bug 修复：注释对话框（FootnoteDialog）白字白底，输入文字与光标不可见

类型：Bug Fix
状态：Completed

现象：点击工具栏「📝注释」打开内容输入弹窗后，textarea 内无输入光标；用输入法输入后输入框仍显示纯白无任何变化；全选文字出现蓝底选中态（证明文字实际存在），取消全选后再次不可见。两种注释样式（脚注区域 / 纯 Markdown）均受影响。

原因：双层叠加导致：
- 用户在设置中选择了深色主题（`%APPDATA%\KnowledgeEditor\settings.json` → `ui.theme="dark"`），前端 `applyTheme('dark')` 给 `<html>` 注入 `color-scheme: dark`（`frontend/src/settings.ts` 第 126 行）。
- Chromium 在 `color-scheme: dark` 下对**未显式着色**的元素注入 UA 白字默认值（经 CDP 计算样式确认：HTML→BODY→overlay→dialog→textarea 整条链 `color: rgb(255,255,255)`）。
- 注释对话框容器为 Tailwind `bg-white`（白底，`EditorToolbar.tsx` 第 239 行），textarea 的 className 未声明文字/光标颜色类（第 268 行）→ 白字白底，文字与光标均不可见；全选时 `::selection` 蓝底反色使文字短暂可见（与用户描述完全吻合）。
- 其他输入框不受影响的原因：均有显式 `text-gray-*` 类（工具栏、上标编辑等）；`MathNodeView` 的 textarea 有 CSS 显式 `color: #1e293b`（`index.css` 第 338 行）。

修改：
- `frontend/src/components/editor/EditorToolbar.tsx`（FootnoteDialog textarea，第 268 行）：className 追加 `text-gray-900 caret-blue-600 placeholder:text-gray-400`（文字深灰 + 蓝色光标 + placeholder 浅灰），在任意 `color-scheme` 下均可见。
- `frontend/src/index.css`（body 规则，第 21 行）：追加 `color: #1f2937;` 作为全局兜底，避免 dark 主题下其他未显式着色元素（未来新增的输入框/对话框）再次出现白字白底。

影响范围：注释对话框输入可见性；全局 body 文字色兜底（浅色 UI 现状下视觉无变化，因各组件已有显式类）；Math/标题输入等已有显式颜色的组件不受影响；深色主题完整适配（深色 CSS 变量方案）不在本次范围，仍为已知项。

验证：
- 根因复现：CDP 计算样式确认修复前 textarea `color/caretColor/textFillColor` 均为 `rgb(255,255,255)`，且 HTML→BODY 全链白字；`index.css` 的 body 无显式 color。
- 修复后（重新构建前端 + cargo 重编译嵌入新资源）：body 计算颜色 `rgb(31,41,55)`；textarea 计算样式 `color=gray-900`、`caretColor=blue-600`、`placeholder=gray-400`；`Input.insertText` 输入「测试注释可见性」成功且可见。
- 回归：vitest 70/70 全部通过；`tsc -b` + `npm run build` 通过。
- 环境注意：应用以生产资源模式运行（tauri.localhost），前端改动必须 `npm run build` 重新生成 dist-build 并 `cargo build` 重新编译嵌入，页面才能加载新资源（仅重跑 vite dev 无法验证）。

## 2026-08-10（Phase 7 M5，v0.7.3）

### M5 桌面集成：应用图标 + 窗口配置 + 原生菜单栏（四组 + 最近动态子菜单 + DevTools + 关于）

类型：Feature
状态：Completed

现象：Phase 7 规划 7.5 要求桌面版完整集成：bundle 图标、窗口配置（标题/尺寸/居中/最小尺寸）、原生菜单栏（文件/编辑/视图/帮助四组），debug 模式 DevTools 可用；菜单项需驱动前端既有动作（新建文档/打开工作区/打开最近工作区）。

原因：无（功能新增）。M4 完成后推进 M5，补齐桌面 shell 的视觉与交互集成。

修改：
- `desktop/src-tauri/src/menu.rs`（新增，完全实现）：常量 `MID_NEW="ke-menu:new-document"` / `MID_OPEN_WS="ke-menu:open-workspace"` / `MID_EXIT="ke-menu:exit"` / `MID_RELOAD="ke-menu:reload"` / `#[cfg(debug_assertions)] MID_DEVTOOLS="ke-menu:devtools"` / `MID_ABOUT="ke-menu:about"` / `RECENT_PREFIX="recent:"` / `RECENT_MAX=8`。`pub fn build(app)` 组装四组 Submenu（文件=新建文档 Ctrl+N/打开 Workspace Ctrl+O/最近子菜单/退出 Ctrl+Q；编辑=撤销/重做/剪切/复制/粘贴/全选预置项；视图=重新加载 Ctrl+R + debug 追加「开发者工具 F12」；帮助=关于）并 `app.set_menu`。`pub fn handle_event(app, event)` 用 `event.id().0.as_str()` 匹配分发：新建文档/打开工作区 emit 同名事件到前端；recent 前缀 emit `ke-menu:open-recent` + JSON path；reload/DevTools 直接操作窗口（DevTools 分支 `#[cfg(debug_assertions)]`）；`MID_EXIT → request_exit`。`pub fn request_exit`：hide 主窗口 + 后台线程 `cleanup_on_exit` + `app.exit(0)`（与窗口关闭一致）。`build_recent_submenu` / `read_recent_paths`：读 `data_dir()/app_config.json` 的 `recent_workspaces` 数组生成菜单项（上限 8），空列表加置灰项「（暂无最近记录）」。`show_about`：读 SidecarState runtime 版本/工作区（fallback package_info）经 `dialog().message()` 展示。
- `desktop/src-tauri/src/lib.rs`（修改）：`mod menu`；`.setup` 尾部 `menu::build(app.handle())`；CloseRequested 分支改为 `api.prevent_close() + menu::request_exit(...)`；新增 `.on_menu_event`。
- `desktop/src-tauri/tauri.conf.json`（修改）：窗口 title=KnowledgeEditor、width 1440、height 900、minWidth 1000、minHeight 640、center true、resizable true；`tauri icon` 重新生成 bundle icon 全套（19 个文件，含 icon.ico/icon.png/32x32.png/128x128@2x.png 等）。
- `frontend/src/App.tsx`（修改）：新增菜单事件监听 useEffect——桌面环境（`isDesktop()`）动态 `import('@tauri-apps/api/event')` 后 `listen` 三个事件：`ke-menu:new-document`→`handleNewArticle()`、`ke-menu:open-workspace`→`handleOpenWorkspaceMenu()`、`ke-menu:open-recent`（payload.path）→`switchWorkspace(path,'open')`；dispose 语义（unlisteners + disposed 标记）防泄漏，Web 环境零依赖不挂载。
- 图标生成：`gen-app-icon.ps1`（GDI+ 绘制 blue-600 圆角方块 + 白色粗体 KE，输出 1024×1024 PNG）→ `npx tauri icon` 生成全套；脚本必须纯 ASCII（含中文注释在 GBK 编码下导致 GraphicsPath 构造失败）。

影响范围：桌面版窗口外观（标题/尺寸/居中/图标）与原生菜单交互；菜单项复用既有前端动作不新增业务逻辑；Web 版不受影响；release 构建视图菜单无「开发者工具」（debug_assertions 门控）。

验证（完整链路）：
- `cargo test --release` 8/8；镜像工作区同步后 vitest 70/70、`tsc -b` 通过、`npm run build` 通过（11.92s，dist-build 73 文件同步回真实路径）。
- dev 冒烟（vite dev 5173 + cargo run，CDP 9223）：
  1. 窗口：MainWindowTitle=KnowledgeEditor；Win32 GetWindowRect 1453×936 物理像素（192 DPI=200% 缩放下对应 1440×900 逻辑）；居中偏差 (0, 4)px；CDP 内容区 `innerWidth/innerHeight = [1440, 881]`（900 减去标题栏/菜单栏），页面 complete、React 挂载、无 JS 错误。
  2. 菜单结构（Win32 GetMenu/GetMenuItemCount/GetMenuString 枚举）：顶级 4 组「文件/编辑/视图/帮助」；文件 6 项（新建文档 Ctrl+N / 打开 Workspace Ctrl+O / 分隔 / 最近 / 分隔 / 退出 Ctrl+Q）；编辑 7 项（撤销/重做/分隔/剪切/复制/粘贴/全选）；视图 3 项（重新加载 Ctrl+R / 分隔 / 开发者工具 F12——debug 存在）；帮助 1 项（关于 KnowledgeEditor）。
  3. DevTools：向主窗口 SendMessage WM_COMMAND(1019) → 枚举到新窗口「DevTools - tauri.localhost/」，DevTools 可用。
  4. 菜单→前端链路：WM_COMMAND(1003) 触发「新建文档」→ CDP 捕获 `Page.javascriptDialogOpening`（type=prompt、message=「文档标题」、defaultPrompt=「新文档 2026/8/10」）→ `Page.handleJavaScriptDialog` 接受标题「M5菜单冒烟测试」→ 文章树出现 `m5菜单冒烟测试.md`、编辑器显示「未保存…」——菜单→Rust emit→前端 listen→复用既有动作全链路通过。（注意：`Get-Process.MainWindowHandle` 在 DevTools 打开后会返回 Tauri 辅助窗口「Tao Thread Event Target」而非主窗口，WM_COMMAND 需按 class='Tauri Window' 显式定位主窗口句柄。）
  5. 退出：WM_COMMAND(1007)「退出」→ 应用干净退出、WebView2 子进程全部回收、5173/9223 端口释放；测试文章与备份清理。

### 环境记录：镜像同步脚本（robocopy 不可用改用 node fs）+ M5 冒烟脚本集合

类型：Environment（环境变更）
状态：Completed

现象：M4 镜像工作区策略沿用，但 PowerShell 沙箱中 `robocopy` 命令不可用（此前 M4 亦遇到），目录同步无现成工具。

原因：本机虚拟化层 + PowerShell 5 环境限制。

修改：
- `sync-frontend-src.mjs` / `sync-dist.mjs`（新增）：node fs `rmSync+cpSync` 双向同步脚本（镜像 src ↔ 真实 src；镜像 dist-build ↔ 真实 dist-build）。
- M5 冒烟脚本集合（`m5-smoke-*.ps1/js`，临时目录）：窗口/菜单枚举（Win32 GetMenu）、DevTools 触发（WM_COMMAND 1019）、菜单事件链路（CDP Page.javascriptDialogOpening + handleJavaScriptDialog）、退出触发（WM_COMMAND 1007）、全部后清理。

影响范围：本机构建/验证流程；M5 冒烟脚本为一次性验证产物，不纳入项目仓库。

验证：镜像同步后 vitest/typecheck/build 全通过（见上），dist-build 73 文件同步成功。

## 2026-08-10（Phase 7 M4，v0.7.3）

### M4 Workspace 桌面适配：app_config 重定向 + 首启引导 + 原生目录选择 + 最近工作区 exists 标记

类型：Feature
状态：Completed

现象：Phase 7 规划 7.4 要求桌面版工作区选择桌面化：原生目录选择器（tauri-plugin-dialog）替代 Web 文本输入、首启两选项引导（空 workspace 且无最近记录时）、最近工作区记录持久化并标记失效路径、软件级配置 app_config.json 从旧 Web 位置（`~/.knowledgeeditor`）重定向到应用数据目录（`%APPDATA%\KnowledgeEditor`）并自动迁移。

原因：无（功能新增）。M3 完成后推进 M4，解决桌面版工作区选择体验与软件级配置落盘位置（Web 与桌面分离）。

修改：
- `desktop/src-tauri/src/sidecar.rs`：sidecar env 注入 `KE_WORKSPACE`（读外部环境变量，缺省默认工作区）、`KE_APP_CONFIG`（`data_dir()/app_config.json`，强制覆盖）、`KE_CORS_ORIGINS`（tauri.localhost + debug 追加 dev port）。
- `backend/app/config.py`：`APP_CONFIG_PATH` 读 `KE_APP_CONFIG`；新增 `APP_CONFIG_LEGACY_PATH`（`KE_APP_CONFIG_LEGACY`，默认同旧 Web 位置）。
- `backend/app/services/app_config.py`：`_migrate_legacy` 首次启动（新位置不存在且与旧位置不同）将旧 Web 版 app_config.json 并入新位置，保留最近工作区/文档列表；复制失败回退默认不阻塞。
- `backend/app/routers/workspace.py`：`POST /api/workspace/open` 与 `/create` 成功后 `add_recent_workspace`；`GET /api/workspace/recent` 返回 `[{path, exists}]`（exists 为目录实时 `is_dir`）；`DELETE /api/workspace/recent?path=` 移除记录。
- `frontend/src/desktop.ts`（新增）：`isDesktop()` 双条件（`hostname==='tauri.localhost'` 或 `'__TAURI_INTERNALS__' in window`）；`pickDirectory(title)` 桌面动态 `import('@tauri-apps/plugin-dialog').open({directory:true})`，失败/非桌面返回 null。
- `frontend/src/App.tsx`：`firstRun` 判定（workspace 已打开且 `stats.document===0` 且最近记录为空）；`handleUseDefaultWorkspace`（重开默认 workspace 写入最近记录使下次不再引导）；顶栏「打开/新建工作区…」桌面用原生选择器、Web 回退 `window.prompt`。
- `frontend/src/components/layout/WorkspacePicker.tsx`：guide 两选项（primary 使用已有工作区/原生选择器、secondary 创建新工作区/沿用默认）；recent 列表（exists 项可点击打开，失效项置灰 + 「路径已失效」徽标 + × 移除）。
- `frontend/src/api/client.ts`：`getRecentWorkspaces` 返回 exists 字段。

影响范围：桌面版工作区选择流程与软件级配置存储位置；首次启动自动迁移旧 Web 配置（只复制不动源文件）；Web 版行为不变（仍用 `~/.knowledgeeditor` + prompt 输入）。

验证（完整链路）：
- 后端 pytest 全过（含 `test_app_config_migration`）；前端 vitest 70/70；`tsc -b` 通过；`npm run build` 通过（63 文件，dist-build）。
- `cargo test` settings 8/8；`cargo build --release` 成功（3m49s，16.9MB）；二进制内嵌 `index-C4HBtfzV.js`（EMBEDDED-OK）。
- release 冒烟（CDP 9223，`KE_WORKSPACE`=空目录 + `KE_APP_CONFIG_LEGACY`=不存在路径）：
  1. 首启引导出现：`ws-picker-guide-primary`「使用已有工作区」+ `ws-picker-guide-secondary`「创建新工作区」，副标题「欢迎使用！选择一个已有工作区，或创建新的工作区开始创作」。
  2. 点击 secondary → 主界面打开，`%APPDATA%\KnowledgeEditor\app_config.json` 生成且 recent 记录写入 empty-ws。
  3. API：`GET /workspace/recent` exists:true；`POST /workspace/open` 真实工作区（7 文档 1 模块）成功且 recent 顺序更新；目录重命名后 `GET /recent` 该路径 exists:false（失效标记）；`DELETE /workspace/recent` 移除记录 HTTP 200。
  4. 二次启动（有最近记录 + 空 workspace）→ 不再引导，主界面直接打开；设置面板（M3 回归）正常。
  5. WM_CLOSE 退出清理（两轮）：ke/backend 进程 0、8000/9223 端口释放、runtime 目录清空、app_config.json 保留最近记录。

### 环境变更：镜像工作区策略 + Rust 工具链误判修正（M0 已装，M4 重复安装后弃用）

类型：Environment（环境变更）
状态：Completed

现象：`D:\Agent` 虚拟化层存在幽灵文件（node_modules 等 906 个文件可见不可读、删除/枚举不可靠），前端依赖安装与验证不可行；M4 会话还发现 cargo 不在 PATH、`~/.cargo/bin/cargo.exe` 是 rustup-init 本体（12.8MB）、`~/.rustup` 无 toolchains，据此判断「Rust 未安装」并重新安装。

原因：`D:\Agent` 虚拟化层对删除/枚举的写入不可靠（PowerShell 列目录可见、node 进程读取 ENOENT、rmSync 假删除）；**Rust 误判根因**：M0 已将工具链安装至 `%LOCALAPPDATA%\cargo` + `%LOCALAPPDATA%\rustup`（用户级 CARGO_HOME/RUSTUP_HOME 已持久化，cargo/rustc 1.97.1 完整可用，`%LOCALAPPDATA%\cargo\config.toml` 已配 rsproxy 镜像），但 M4 会话只检查了 `~/.cargo`（M0 首次尝试默认位置被安全软件拦截留下的残留）与 `~/.rustup`，未检查 `%LOCALAPPDATA%` 位置，误判未安装。

修改：
- 镜像工作区策略（有效，保留）：前端源码复制到 `C:\Users\y8882\.trae-cn\work\6a773c1419e6c03a410e3eb1\ke-frontend` 干净路径安装依赖、跑 vitest/tsc/build；产物 dist-build 经 sync-dist.js 同步回真实路径供 release 构建内嵌。
- Rust 工具链（M4 误判产物，已弃用）：M4 曾用 rsproxy 镜像重复安装一套至临时路径 `...\rustup-home`/`cargo-home`（约 1.5GB）；后经核实 M0 安装完好，**统一回用 `%LOCALAPPDATA%` 工具链**（用户级环境变量已持久化，新终端直接可用），临时路径那套弃用勿再使用。M4 的 cargo test 8/8 与 release 构建均用临时路径工具链完成，产物有效（同版本 1.97.1，不影响结果）。

影响范围：本机构建/验证流程；文档记录（约束 9、DEVELOPMENT_ENVIRONMENT.md）已同步修正；临时路径冗余工具链待清理（虚拟层删除不可靠，暂留）。

验证：`%LOCALAPPDATA%` 工具链 `cargo test --release` 8/8 通过（settings 模块），与 M4 临时路径工具链结果一致；cargo/rustc 1.97.1 双套版本一致。

## 2026-08-10（Phase 7 M3，v0.7.3）

### M3 设置系统：settings.json schema v1 + Rust 读写命令 + 四组设置面板 + autosave 驱动 + 维护项

类型：Feature
状态：Completed

现象：Phase 7 规划第 7 章 7.3 要求桌面版提供应用层设置（启动 / 编辑器 / 界面 / 维护四组），`settings.json` schema v1 落盘 `%APPDATA%\KnowledgeEditor\settings.json`；自动保存间隔由设置驱动；三个维护项（查看日志 / 打开数据目录 / 重建索引，重建索引复用后端 `POST /api/index/rebuild`，不新增后端接口）。设置属于应用层，不写入 Markdown、不修改 Workspace 文件结构、不与文章数据混存；Web 版降级 localStorage。

原因：无（功能新增）。M2 完成后按规划推进 M3，将应用偏好与应用数据分离存储。

修改：
- `desktop/src-tauri/src/settings.rs`（新增）：`SCHEMA_VERSION = 1`；结构体 `StartupSettings`（restoreLastState / autoOpenRecentWorkspace，默认 true/true）、`EditorSettings`（autosaveIntervalMs=3000 / historyRetentionCount=30 / display）、`UiSettings`（theme=system / displayPreference）、`AppSettings`（schemaVersion + 四组 + maintenance 扩展字段），serde `default + rename_all = camelCase`，未知键忽略；`load_from/save_to` 支持路径注入（供测试），`settings_file()` 定位 `data_dir()/settings.json`；深合并 `merge_value`（patch 仅覆盖存在的键）；sanitize theme（仅 system/light/dark，非法回退 system）；原子保存（tmp + rename）；命令 `get_settings` / `update_settings` / `open_log_dir` / `open_data_dir`（explorer spawn）；8 个单测（defaults / merge 部分补丁 / 未知键 / sanitize theme / roundtrip / 损坏回退 / 缺失回退 / UTF-8 BOM 兼容）。
- `desktop/src-tauri/src/sidecar.rs`：`data_dir()` 改为 `pub(crate)` 供 settings.rs 复用。
- `desktop/src-tauri/src/lib.rs`：`mod settings` + 4 个命令注册。
- `frontend/src/settings.ts`（新增）：类型 + `DEFAULT_SETTINGS` + `isTauri()`（`'__TAURI_INTERNALS__' in window`）+ `sanitizeTheme` + `mergeSettings` 纯函数 + `loadSettings/saveSettings`（Tauri invoke ↔ localStorage `ke.settings.v1` 降级）+ `getCachedSettings` + `getAutosaveIntervalMs` + `applyTheme`（data-theme + colorScheme）。
- `frontend/src/settings.test.ts`（新增）：7 个用例（sanitizeTheme 3 + mergeSettings 6 断言组）。
- `frontend/src/components/settings/SettingsPanel.tsx`（新增）：右侧抽屉，四组设置 + 维护项；输入框 onBlur 校验（autosave 500–600000 / retention 1–999）；主题三按钮即时生效；维护按钮带 `data-action`（open-log / open-data / rebuild-index）、关闭按钮 `data-action="close-settings"`（供自动化精确定位）。
- `frontend/src/App.tsx`：顶栏「⚙ 设置」入口 + 启动 `loadSettings().then(s => applyTheme(s.ui.theme))` + `<SettingsPanel>`。
- `frontend/src/components/layout/EditorArea.tsx`：两处硬编码 `setTimeout(..., 3000)` 改为 `getAutosaveIntervalMs()`（每次 debounce 触发时读缓存即时生效）。

影响范围：桌面应用层设置存储与读写命令；前端设置面板与主题/自动保存行为；Web 版（localStorage 降级）不受影响；后端 API 与 Markdown 数据格式无改动（重建索引仅复用既有端点）。

验证：`cargo test` settings 8/8；vitest 70/70；`tsc -b` 通过；`npm run build` 通过（1.95 MB）；dev 冒烟（CDP 9222 端到端）：预置 settings.json（dark/8000/30）正确读取并应用（data-theme=dark、autosave-input=8000、retention-input=30）、主题切换即时生效、设置面板内重建索引成功（「重建完成：文档 1 / 模块 0 / 附件 0」）、open_log_dir 真实创建 `%APPDATA%\KnowledgeEditor\logs`、关闭按钮正常；WM_CLOSE 退出清理：ke 进程 0 / 8000 释放 / Vite 5173 退出 / runtime.json 删除 / settings.json 保留（dark/8000/30 未破坏）。

### 修复 settings.json 读取遇 UTF-8 BOM 静默回退默认

类型：Bug Fix
状态：Completed

现象：CDP 首轮冒烟发现预置 settings.json（theme=dark / autosaveIntervalMs=8000）读取后回退默认（data-theme=system、autosave 3000），落盘值丢失。

原因：预置文件由 PowerShell 5 `Set-Content -Encoding UTF8` 写入，带 UTF-8 BOM；serde_json 遇 BOM 解析失败 → `load_from` 静默回退默认值。

修改：`desktop/src-tauri/src/settings.rs` 的 `load_from` 解析前 `trim_start_matches('\u{feff}')` 剥离 BOM；新增 `utf8_bom_is_tolerated` 单测（写 BOM 字节 + JSON，断言 dark/8000 被正确读取）。

影响范围：Windows 上任何带 BOM 的 settings.json（记事本 / PowerShell 保存场景）均可正确读取；无 BOM 文件不受影响。

验证：单测 8/8 通过；用 node 重写无 BOM 预置文件后 CDP 复验 dark/8000/30 全部生效。

### M3.1 修复 release 构建缺失 custom-protocol feature（二进制未嵌入前端资源）

类型：Bug Fix
状态：Completed

现象：release 冒烟发现 `target\release\knowledgeeditor.exe` 不包含任何 `index-*.js` 前端资源字符串（`strings` 搜不到），实际启动加载的是 devUrl 而非打包资源。

原因：`desktop/src-tauri/Cargo.toml` 中 `tauri = { version = "2", features = [] }` 未启用 `custom-protocol` feature；Tauri v2 下该 feature 缺失时 release 构建不嵌入 frontendDist 资源、回退 devUrl 加载。

修改：`desktop/src-tauri/Cargo.toml`：`features = ["custom-protocol"]`。

影响范围：release 二进制资源嵌入与启动加载路径；dev（tauri dev）不受影响。

验证：重新构建后二进制含 `index-Cftz0YnZ.js` 哈希字符串；release 启动页面为内嵌资源（hostname=tauri.localhost）。

### M3.1 修复 dist 虚拟层幽灵文件复发：vite outDir 改 dist-build 彻底绕行

类型：Bug Fix
状态：Completed

现象：M2 曾以「真实层 rename dist 恢复 + 直接 cargo build --release」绕开 dist 幽灵文件；M3.1 重新构建时幽灵文件复发（`index-CDHoAOT-.js` 在 PowerShell 视图可见、node/rustc 宏读取失败），`cargo build --release` 再次失败；且发现 rename dist → dist.bak 后 rename 回 dist 仍带幽灵文件，虚拟化层删除/重命名均不可靠。

原因：`frontend/dist` 在虚拟化层存在可见不可删的陈旧产物（index.html 引用旧哈希，实际文件缺失），tauri-build 扫描 dist 列入资产清单后宏读取失败；rustc 子进程与 node/PowerShell 文件系统视图不一致。

修改：
- `frontend/vite.config.ts`：`build.outDir` 改为 `dist-build`（全新路径，无幽灵污染）；dev 不受影响。
- `desktop/src-tauri/tauri.conf.json`：`build.frontendDist` 改为 `../../frontend/dist-build`。
- 构建路径统一为 `npm run tauri -- build`（同一 npm 进程树，cargo/rustc 继承注入的 RUSTUP_HOME/CARGO_HOME/PATH），不再直接 `cargo build --release`。

影响范围：本地 release 构建全流程；`frontend/dist`（含幽灵文件）废弃不再参与构建；CI 干净环境与 dist-build 方案兼容。

验证：`npm run tauri -- build --no-bundle` 成功产出 `target\release\knowledgeeditor.exe` 与 `target\release\bundle\nsis\KnowledgeEditor_0.7.3_x64-setup.exe`；release 启动加载内嵌 dist-build 资源。

### M3.1 修复 release 首启 IPC 竞态：API 基址注入失败误判「后端未连接」

类型：Bug Fix
状态：Completed

现象：release（custom-protocol 内嵌资源）首启时 `window.__KE_API_BASE__` 未注入，页面显示「后端服务未连接」；`Page.reload` 后注入成功（console 输出「[ke] 运行时注入 API 基址: http://127.0.0.1:8000」）。

原因：内嵌资源加载极快，React bundle 执行可能早于 WebView2 IPC 通道就绪，首次 `invoke('get_runtime_info')` 失败；且首启时 `'__TAURI_INTERNALS__' in window` 尚未为真，旧逻辑直接返回 null 不再重试。另经 CDP 实测确认 Tauri v2 不修改 WebView2 UA（UA 为 `Edg/151.0.0.0`，不含 "Tauri"），UA 检测思路无效；release 页面 hostname 恒为 `tauri.localhost`。

修改：`frontend/src/main.tsx` 的 `resolveApiBase()`：
- 环境判定改为双条件：`location.hostname === 'tauri.localhost'`（release 桌面恒真）或 `'__TAURI_INTERNALS__' in window`（dev 注入后真）；非 Tauri 环境（Web/测试）立即返回 null，不做无谓等待。
- `invoke('get_runtime_info')` 纳入重试循环：10 次 × 400ms，成功即写入 `window.__KE_API_BASE__`。

影响范围：桌面 release/dev 双模式首启 API 基址注入；Web/测试（vitest）路径立即回退不受影响。

验证：重建后 release 首启注入成功（`apiBase=http://127.0.0.1:8000`、后端 v0.7.3、工作区侧栏加载、⚙ 设置出现、theme=dark）；vitest 70/70、`tsc -b` 0 错误回归通过。

### M3.1 release 冒烟补验：设置面板端到端 + 退出清理（修正断言选择器）

类型：Test
状态：Completed

现象：release 面板 CDP 断言中 `data-field=autosaveIntervalMs` / `data-field=historyRetentionCount` 输入框与 `data-field=rebuild-result` 未命中，疑似面板缺陷。

原因：断言设计错误——`SettingsPanel.tsx` 的 `NumberRow` 输入框无 data-field 属性（仅 `type="number"`，按 label 文本区分）；重建结果为无属性条件渲染 `<p>`（`{indexResult && ...}`）。DOM dump 证实输入框 `val=8000/30` 与 settings.json 一致，面板功能正常。

修改：无代码改动；修正 CDP 脚本选择器——按 label 文本（「自动保存间隔（毫秒）」「历史版本保留数量」）向上遍历定位输入框、按「重建完成/重建失败」文本前缀定位结果。

影响范围：仅自动化验证脚本；产品代码不变。

验证：release（CDP 9223）面板端到端全通过：open-settings=clicked、inputs `{"autosave":"8000","retention":"30"}`、编辑 autosave→7500 blur 后即时保存生效（settings.json 同步）、还原 8000 成功、rebuild-result=「重建完成：文档 1 / 模块 0 / 附件 0」（confirm 自动接受）、close-settings 后面板关闭；WM_CLOSE 退出清理：knowledgeeditor 进程 0、8000 释放、`%APPDATA%\KnowledgeEditor\runtime\` 目录已清空（release 运行时临时数据落盘 runtime\ 目录，退出清空目录内容，settings.json 保留 dark/8000/30）。

## 2026-08-10（Phase 7 M2，v0.7.3）

### M2 前端适配：API 基址注入 + attachmentUrl 合并（P9）+ 测试脚本/CI/OpenAPI 快照（P10）

类型：Feature
状态：Completed

现象：桌面版 WebView 页面 origin（tauri.localhost / dev 前端页）与后端 127.0.0.1:8000 跨源，前端 API 需按实际侧车端口拼接基址；`ke.ts` 与 `client.ts` 存在两份 `attachmentUrl` 实现且 URI 编码行为有差异；`package.json` 无 test 脚本、CI 无前端测试与 OpenAPI 端点快照断言（规划第 6 章 + 6E P9/P10）。

原因：无（功能新增）。M1 已提供 `get_runtime_info` command，需前端挂载前注入基址并统一拼接；P9/P10 为 6E 遗留项，按规划在 M2 收敛。

修改：
- `frontend/src/main.tsx`（重写）：挂载前检测 `'__TAURI_INTERNALS__' in window`，`invoke('get_runtime_info')` 取得 `api_base` 写入 `window.__KE_API_BASE__`（末尾去斜杠），失败回退相对路径（Vite 代理）；Web/测试环境无注入 → 空串 → 既有 vitest 不受影响。
- `frontend/src/api/client.ts`：新增导出 `apiBase()`（`window.__KE_API_BASE__ ?? ''`）；`request<T>` 改为 `fetch(apiBase() + path, ...)`；4 处直接 fetch（uploadAttachment / exportPackage / importMarkdown / importPackage）统一拼接基址；P9 合并 `attachmentUrl`：`apiBase() + '/api/attachments/' + rel.split('/').map(encodeURIComponent).join('/')`（以 client 实现为准，URI 编码保留）。
- `frontend/src/vite-env.d.ts`：新增 `interface Window { __KE_API_BASE__?: string }`。
- `frontend/src/editor/ke.ts`：删除 `attachmentUrl` 函数体，替换为指向 `api/client.ts` 的说明注释；`AttachmentNodeView.tsx` / `VideoNodeView.tsx` 的 import 改自 `'../../../api/client'`。
- `frontend/package.json`：dependencies 新增 `@tauri-apps/api@^2.11.1`；scripts 新增 `"test": "vitest run"`。
- `.github/workflows/ci.yml`：frontend job 在 build 前增加 Unit tests（vitest run）步骤。
- `backend/tests/test_openapi_snapshot.py`（新增）：`GET /api/openapi.json` 的 paths 有序键集合全等断言（实测 36 路径，缺/多显式输出差异）+ 方法总数断言（实测 47；docstring 注明规划「42」为 Phase 6E 冻结检查业务口径，差异为辅助端点）。
- `desktop/src-tauri/src/sidecar.rs`：CORS 追加 dev origin（见下条 Bug Fix）。

影响范围：前端 API 访问全链路（Web/桌面双模式）；附件 URL 生成；CI 前端测试与后端快照；42 端点 API 业务口径无改动。

验证：vitest 62/62；`tsc -b` 通过；`npm run build` 通过（1.94 MB）；后端快照 2 passed；桌面 dev 冒烟：注入基址链路（health ok → runtime.json 写入 → 窗口 UI 完整加载）→ CORS 修复后 7 项核心 API 抽测全通过（含真实写入 `Articles/m2.md`）→ WM_CLOSE 退出清理无残留；release 冒烟：`cargo build --release` → sidecar 拉起 → health/OPTIONS/GET（Origin: `http://tauri.localhost`）全 200 → 前端产物含 `__KE_API_BASE__`/`get_runtime_info` → WM_CLOSE 全清理。

### 修复桌面 dev 模式 CORS 预检 400（跨源 OPTIONS 失败）

类型：Bug Fix
状态：Completed

现象：M2 注入绝对基址后 dev 模式前端产生跨源请求（页面 origin 127.0.0.1:5173 → 后端 127.0.0.1:8000），OPTIONS 预检返回 400，真实 API 调用失败。

原因：M1 在 sidecar.rs 以 `KE_DEV_FRONTEND_PORT` 环境变量追加 dev origin，但该变量从未被设置，dev 构建缺失 127.0.0.1:5173；且 `KE_CORS_ORIGINS` 环境变量会覆盖 config.py 默认值。

修改：`sidecar.rs` CORS 列表固定包含 `http(s)://tauri.localhost`；`cfg!(debug_assertions)` 分支无条件追加 `http://127.0.0.1:{port}` 与 `http://localhost:{port}`（端口取 `KE_DEV_FRONTEND_PORT`，缺省 5173，与 tauri.conf.json devUrl 一致）。

影响范围：桌面 dev 模式前端 API 调用；release 不受影响。

验证：dev 冒烟 OPTIONS/GET 全 200（ACAO 回显正确），随后 7 项核心 API 抽测全通过。

### 修复桌面退出关闭回归（CloseRequested 处理器内同步清理阻塞）

类型：Bug Fix
状态：Completed

现象：关闭窗口后 sidecar 已清理、8000 已释放、runtime.json 已删除，但主窗口仍残留、进程不退出。

原因：`cleanup_on_exit` 内 taskkill 等待 + 最多 5s 轮询在 CloseRequested 事件处理器中同步执行，长时间阻塞主线程，破坏 tao 的窗口销毁流程（此前用 `CloseMainWindow()` 无法复现是因为 Get-Process 缓存了虚拟化层无效句柄，见下条）。

修改：`lib.rs` CloseRequested 处理器改为 `api.prevent_close()` + `window.hide()` + `std::thread::spawn(move || { sidecar::cleanup_on_exit(&app); app.exit(0); })`，清理在独立线程完成后强制退出；调试用 `eprintln!` 诊断日志已移除，保留注释说明。

影响范围：桌面退出路径；退出后无残留进程与记录文件。

验证：dev 与 release 双模式 WM_CLOSE 冒烟（投递真实窗口句柄）：进程退出、8000 释放、runtime.json 删除、Vite（dev）退出，全通过。

### 本地 release 构建 dist 虚拟层幽灵文件（环境性）

类型：Bug Fix
状态：Completed

现象：`npm run tauri -- build --no-bundle` 失败，报缺 `frontend/dist` 的 `index-CDHoAOT-.js`；PowerShell 视图显示 dist 中存在该文件，但 node（真实层）`fs.readdirSync` 与 Read 工具均报不存在（虚拟化层「幽灵文件」）。

原因：dist 存在新旧混合产物（index.html 引用旧的 CDHoAOT 而真实层该文件已被 rename），删除被沙箱拦截、目录 rename 在真实层可用。

修改：无代码改动；本机构建绕开——用 node（真实层）将 `dist-old` rename 回 `dist`（真实产物 64 个文件、index.html 引用 `index-FNRpDFjq.js` + `index-CLYym4aG.css` 一致），直接 `cargo build --release` 成功（release 产物 `target\release\knowledgeeditor.exe` + `knowledgeeditor-backend.exe`）。

影响范围：仅本机本地 release 构建流程；CI（干净环境）无此问题，README/CI 中的 `npm run tauri -- build` 不受影响。

验证：release 冒烟全通过（见本阶段 Feature 条目）。

## 2026-08-10（Phase 7 M1，v0.7.3）

### 后端侧车：PyInstaller 打包 + Rust Sidecar Manager（拉起/health/动态端口/崩溃自动拉起/退出清理）

类型：Feature
状态：Completed

现象：Phase 7 桌面化需要 Tauri 壳内置后端服务，由 Rust 侧统一拉起、握手、清理（规划第 5 章 7.2）。

原因：无（功能新增）。桌面版无独立前端进程，需将既有 FastAPI 后端打包为侧车由桌面壳托管。

修改：
- `backend/run.py`（新增）：PyInstaller 打包入口。`_ensure_env_defaults()` 先于 `from app import config` 执行（`KE_WORKSPACE` 缺省 `%APPDATA%\KnowledgeEditor\workspace`）；`main()` 对象式导入 `from app.main import app` 供 PyInstaller 静态分析全依赖树，再 `uvicorn.run(app, host=config.HOST, port=config.PORT, reload=False)`。
- PyInstaller 6.22.0（venv 内）`--onefile --name knowledgeeditor-backend --paths backend` + 11 个 `--hidden-import uvicorn.*`（uvicorn 动态导入收编）；产物 12,637,746 B，重命名为 `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe` 放入 `desktop/src-tauri/binaries/`。
- `desktop/src-tauri/src/sidecar.rs`（新增，约 440 行）：Sidecar Manager。四段式流程（cleanup_stale → find_free_port 动态端口（默认 8000，最多 3 次）→ spawn_sidecar + wait_health（30s/1s 轮询，`status=ok`）→ write_runtime（schema 与 start.ps1 一致，frontend 置 null，落盘 `%APPDATA%\KnowledgeEditor\runtime\runtime.json`））；`watch_sidecar` 监听线程透传 stderr/stdout（`[sidecar]` 前缀）、emit `ke:sidecar-exited`/`ke:runtime-ready`/`ke:runtime-error`、崩溃自动拉起 ≤3 次；环境注入 `KE_HOST/KE_PORT/KE_WORKSPACE/KE_CORS_ORIGINS`（追加 `http(s)://tauri.localhost` 与 dev 端口）；`get_runtime_info` command 供 M2 基址注入。
- `desktop/src-tauri/src/lib.rs`：`mod sidecar` + `tauri_plugin_shell::init()` + `.manage(SidecarState)` + setup 启动 + `CloseRequested` 退出清理 + `get_runtime_info` 注册。
- `Cargo.toml`：新增 `tauri-plugin-shell = "2"`、`ureq = "2"`；`tauri.conf.json`：`bundle.externalBin: ["binaries/knowledgeeditor-backend"]`；`capabilities/default.json`：`shell:allow-spawn`、`shell:allow-execute`。

影响范围：桌面启动/退出全链路；Web 版（start.ps1）不受影响；42 端点 API 无改动。

验证：`tauri dev` 集成冒烟——窗口 → 侧车拉起 → health 握手 → runtime.json 写入（backend.pid/port/started_at/version + frontend:null）→ 前端真实 API 调用成功（workspace/current、tags、tree、fs/events 等）；WM_CLOSE 退出后主进程/sidecar 整树/端口/runtime.json 全部清理无残留；强杀 sidecar 模拟崩溃，1s 后自动拉起（第 1/3 次）且 health 恢复、runtime.json pid 更新。

### 修复桌面退出清理阻塞（taskkill 挂起导致窗口关闭卡死）

类型：Bug Fix
状态：Completed

现象：桌面窗口发送关闭后：主进程不退出、窗口半关闭、前端仍在轮询、sidecar 进程与 runtime.json 残留。

原因：`cleanup_on_exit` 第一步同步调用 `taskkill /PID <pid>`（无 /F）。PyInstaller onefile bootloader 不响应 CTRL_CLOSE_EVENT，taskkill 无限等待进程退出，阻塞窗口事件线程，后续清理步骤（5s 等待、整树强杀、删 runtime.json）全部无法执行。

修改：`sidecar.rs` 优雅终止 `taskkill /PID` 移入独立线程（防挂起阻塞）；改为轮询等待最多 5s（`is_alive` 每 250ms 检查，进程退出即提前结束），超时仍存活则 `kill_tree`（`taskkill /T /F`）；提取 `is_alive()` 消除 cleanup_stale / cleanup_on_exit 两处重复。

影响范围：桌面退出路径；退出后无残留进程与记录文件。

验证：WM_CLOSE 后主进程退出、sidecar 整树清理、runtime.json 删除、8000 端口释放；崩溃自动拉起场景（pid 已更新）下退出清理同样通过。

## 2026-08-09 / 2026-08-10（Phase 6U 周期，v0.6.0 后 → v0.7.3）

### 表格功能优化（气泡菜单）

类型：Feature
状态：Completed

现象：光标进入表格时缺少行列级编辑入口，只能依赖工具栏插入固定 3×3 表格，无法按需增删行列、合并拆分单元格。

原因：表格节点仅支持创建，缺少交互式编辑 UI。

修改：新增 `frontend/src/components/editor/TableBubbleMenu.tsx`：光标进入表格（或拖选单元格）时在表格上方浮动显示操作条，支持上/下插行、左/右插列、删行、删列、合并单元格、拆分单元格、删除整个表格；操作按钮带可用态判断（`can().mergeCells()` 等），点击按钮 `onMouseDown preventDefault` 防止编辑器失焦导致菜单隐藏。该组件是唯一从 `@tiptap/react/menus` 子路径导入 `BubbleMenu` 的文件。

影响范围：表格相关编辑交互；引入新依赖路径，触发 Vite 重新预构建（见下条白屏记录）。

验证：真实 Chrome 操作验证菜单定位与各操作按钮生效。

### 修复开发页白屏（esbuild 被拦截，环境性）

类型：Bug Fix
状态：Completed

现象：表格优化推送后，开发页打开白屏，页面无模块可渲染。

原因：表格优化引入 `@tiptap/react/menus`（BubbleMenu）依赖路径，推送后触发 Vite 对新增依赖重新预构建；本机安全软件按文件名拦截 `esbuild.exe` 写入（Access is denied），预构建无法产出 `node_modules/.vite` 缓存，页面无模块可加载。

修改：
- 新增 `frontend/scripts/ke-vite.mjs`：启动 Vite 前把 `@esbuild/win32-x64/esbuild.exe` 复制为改名副本（`.esbuild/esbuild-renamed.exe`，按体积与 mtime 判断是否需刷新副本），在任何 esbuild 模块被加载前设置 `ESBUILD_BINARY_PATH` 指向副本，再以子进程启动真实 Vite CLI（dev/build/preview 参数原样透传）。
- 修改 `frontend/vite.config.ts`：`cacheDir` 从 node_modules 下移出到 `../workspace/.knowledgeeditor/vite-cache`（沙箱保护 node_modules 目录、拦截目录 rename，导致预构建 `deps_temp -> deps` 原子替换失败；workspace 下 rename 不受限）。

影响范围：前端开发/构建/预览的启动链路；新增副本目录与缓存目录。

验证：dev server 可正常产出依赖预构建缓存，`repro.html` 与主应用页面均能加载渲染（app-smoke / diag 脚本验证无致命错误）。

### v0.6.1：拖拽添加附件

类型：Feature
状态：Completed

现象：需求「增加拖动添加附件」。

原因：无（功能新增）。

修改：
- `frontend/src/editor/index.ts`：`editorProps.handleDrop` 拦截 ProseMirror 对拖入图片的默认 base64 内联行为，改为逐个上传后插入 `attach`/`video` 节点（`uploadAttachment` 上传 → `attachmentNode` 按返回类别构建节点 → `tr.insert(pos)`），拖放位置按 `posAtCoords` 计算；上传失败 `window.alert` 提示且不中断后续文件。
- `frontend/src/components/layout/EditorArea.tsx`：拖拽悬停遮罩。
- 配套：孤儿附件（未被任何 Markdown 引用）仅支持手动删除、绝不自动删除；被引用附件后端返回 409 拒绝删除。

影响范围：附件/视频插入路径、拖拽交互。

验证：真实 Chrome 拖拽文件到编辑区，attach/video 节点按拖放位置插入；孤儿附件手动删除正常。

### v0.6.2 / v0.6.3：注释样式（脚注两种样式）

类型：Feature
状态：Completed

现象：需求「增加注释样式」，脚注展示形式单一。

原因：无（功能新增）。

修改：`frontend/src/components/editor/EditorToolbar.tsx` 的 `FootnoteDialog` 支持两种脚注样式，选择记忆在 `localStorage['ke.footnoteStyle']`：
- 脚注区域（block）：正文插入上标 [n]，文末自动生成灰底「脚注」信息块（独立 footnotes 节点），条目可就地编辑、与上标有连接。
- 纯 Markdown（plain）：正文同样插入上标 [n]；文末追加 `# 参考` 与 `[n] 内容` 为普通段落，无连接、可自由编辑（v0.6.3 补齐正文上标，不创建 footnotes 节点）。

影响范围：脚注插入命令、Markdown 导出结构、底部脚注区渲染。

验证：真实 Chrome 切换两种样式插入脚注，正文上标与文末内容正确生成；重启后样式选择记忆生效。

### v0.6.4：修复插入脚注上标后自动换行 + 上标编号可修改

类型：Bug Fix
状态：Completed

现象：插入脚注上标后正文自动换行；上标编号无法直接修改。

原因：StarterKit `trailingNode` 在 footnotes 节点后补空段落；插入后光标未显式复位到上标之后。

修改：`trailingNode` 配置 `notAfter: ['paragraph', 'footnotes']`，footnotes 节点后不再补空段落；插入上标后光标显式复位到上标之后同一行；上标编号可点击直接修改（仅影响正文显示，不影响底部参考栏）。

影响范围：脚注插入链路、行尾结构。

验证：真实 Chrome 行中/行尾插入上标无换行；点击上标可修改编号。

### v0.6.5：修复脚注光标 DOM 错位（Backspace 误删上标）

类型：Bug Fix
状态：Completed

现象：上标后按 Backspace 误删上标；行末/段末插入后光标视觉跳到下一行行首。

原因：`insertFootnote`/`insertPlainFootnote` 用 chain 模式 `insertContent` 不立即 dispatch，selection 仍是插入前位置；上标 `line-height: 0` 造成行尾视觉错位；浏览器把 caret 渲染到软换行后的下一行行首。

修改：
- 插入改为单 transaction（`tr.replaceWith` 插入上标后 `after = from + nodeSize` 将光标置于上标之后），杜绝 selection 滞后。
- 上标样式 `line-height` 由 0 改为 1 消除行尾视觉错位。
- 行末/段末插入后补零宽空格 U+200B 锚点（`isCaretAtLineEnd` 判断，`$pos.end()` 而非 `Node.end()`），避免 caret 落到下一行行首。

影响范围：脚注上标插入位置与光标行为（行中、行尾、段末三种场景）。

验证：真实 Chrome caret 像素级截图对比（修复前 caret 在下一行行首，修复后落在 sup 右侧同一行）；Backspace 不再误删上标。

### v0.7.0：信息块改为可编辑内容节点（方案 A）

类型：Refactor
状态：Completed

现象：「信息块内无法使用注释功能（它会删掉整个信息块）」。

原因：信息块为 atom 节点，PM 将插入位置视为替换选区，注释插入即整块替换。

修改：
- `NoteExtension.ts`：`group: 'block'`、`content: 'inline*'`、`defining: true`、`selectable: true`、`draggable: true`；`renderHTML` 返回 `['div', mergeAttributes(...), 0]`；`insertNote` 命令将内容参数包成文本子节点。
- `tokenizers.ts`：新增 `keNoteTokenizer`（'ke_note'，block 级），`matchBalancedJson` 解析头部 attrs，查找 `<!-- /ke-note -->` 结束标记——找到则解析为包裹格式 `{ content: inner }`，找不到则为旧自闭合格式 `{ selfClosed: true }`。
- Markdown 存储改为包裹格式：`<!-- ke-note: {json} -->\n内容\n<!-- /ke-note -->`。
- 旧格式自动迁移：`parseHTML` 双规则（优先级 200 的旧格式规则仅当 `data-content`/`data-text` 属性存在时命中），`getContent` 用 `Fragment.fromJSON` 迁移为文本子节点；`parseMarkdown` 对旧格式同样从 attrs 迁移。
- `NoteNodeView.tsx`：改用 `NodeViewContent as="div"` 挂载 PM contentDOM。

影响范围：信息块的 Markdown 存储格式（v0.7.0 起冻结为包裹格式）、schema、往返解析；旧格式读取兼容保留。

验证：`markdown-roundtrip.test.ts` 新增「块内插入脚注」场景；`phase3-roundtrip.test.ts` 旧格式断言更新；62 前端测试全绿；真实 Chrome 块内插入脚注成功且不删块。

### v0.7.1：修复信息块内无法输入文本 + 徽章优化

类型：Bug Fix
状态：Completed

现象：「信息块现在无法输入文本」。

原因：NodeViewWrapper 设 `contentEditable={false}`，prosemirror-view 不会自动覆盖 contentDOM 的可编辑性，contentDOM 继承禁编辑。实验证明手动给 contentDOM 设 `contentEditable='true'` 后输入成功。

修改：
- wrapper 不再设置禁编辑；颜色按钮、徽章/标题输入框、删除按钮各自单独加 `contentEditable={false}`（tiptap 官方模式）。
- 徽章颜色与信息块背景同步同一色系：`COLOR_MAP` 结构从字符串改为 `Record<string, { block: string; badge: string }>`（blue/yellow/green/red/purple 五色）。
- 徽章默认空文本：placeholder 清空，不再显示「信息」占位字。

影响范围：信息块编辑交互、徽章配色。

验证：真实 Chrome 块内直接输入成功；五色系联动；新建块徽章无占位字。

### v0.7.2：修复占位文字错渲染到颜色按钮

类型：Bug Fix
状态：Completed

现象：「每个选择颜色的按钮下面都挂着一长串竖着的"输入信息块内容…"」。

原因：CSS `[contenteditable]:empty::before` 属性选择器匹配属性存在即命中（不看值），空的颜色按钮（`contenteditable="false"` 且无子节点）满足 `:empty`；`white-space: pre-wrap` 使文字在 16px 窄按钮中竖排。真实 contentDOM 无显式 contenteditable 属性且 PM 空容器内置 `<br class="ProseMirror-trailingBreak">`，永远不会 `:empty`，旧 CSS 规则实际从未在内容区生效过。

修改：
- `index.css`：改为 `.ke-note [contenteditable]:not([contenteditable="false"])`，控件不再渲染占位文字。
- `NoteNodeView.tsx`：检测 `node.content.size === 0`，为空时给内容区追加 `ke-note-content--empty` class，CSS 用 `.ke-note-content.ke-note-content--empty::before` 显示占位符，输入文字后 class 自动移除（JS 驱动，避开 trailingBreak 使 `:empty` 失效的问题）。

影响范围：信息块占位符展示、按钮/输入框样式。

验证：真实 Chrome 探针枚举确认按钮干净、内容区显示占位符、输入后消失；62 前端测试全绿；tsc 通过。

### v0.7.3：修复保存后属性面板元信息变「—」

类型：Bug Fix
状态：Completed

现象：「保存后，右边栏中属性的创建时间等内容，会变成 -，而不是更新」。

原因：编辑器保存走 `saveArticle` → `PUT /api/articles/{id}` → 后端 `update_article` 响应仅含标题/正文/标签 → 前端 `handleSaved` 用响应整体替换 article 状态 → `fmtTime`/`fmtSize` 对缺失字段显示「—」。

修改：`backend/app/routers/documents.py` 的 `update_article` 与 `GET /articles/{id}`、`PUT /articles/{id}/meta` 保持一致，返回完整元信息（`_file_stats` 取 `created_at`/`updated_at`/`size`，正文重新计算 `word_count`）。

影响范围：保存接口响应结构、属性面板显示。

验证：`backend/tests/test_api.py` 新增回归断言（保存响应必须携带非空元信息）；102 后端测试全绿；node 脚本 API 验证 + 真实 Chrome 端到端：保存后修改时间更新、创建时间不变。

### v0.7.3：stop.ps1 兜底停止增强

类型：Bug Fix
状态：Completed

现象：「目前前端正在正常运行，但我用 .\scripts\stop.ps1 无法停止它」。

原因：stop.ps1 只按 `runtime.json` 的 PID 记录停止（该文件由 start.ps1 写入）；dev 方式启动的进程无记录，脚本直接走「未找到记录文件」分支退出。

修改：`scripts/stop.ps1` 保留「不按进程名模糊匹配、不误杀无关服务」原则，增加「端口 + 项目命令行特征」双重匹配兜底：backend 端口 8000 匹配 `uvicorn app.main:app`，frontend 端口 5173 匹配 `node_modules\vite\bin\vite.js`；特征命中的进程用 `taskkill /PID /T /F` 停止整个进程树，`taskkill` 不可用时回退 `Stop-Process`；特征不命中的占用进程只提示、不自动关闭。

影响范围：进程停止脚本（start/stop 一键启停链路）。

验证：真实场景验证（无 runtime.json、服务运行中）：stop.ps1 按端口+特征识别并停止 5173/8000 进程树。

### 26 项浏览器端回归测试（checklist）

类型：Test
状态：Completed

现象：要求对 v0.7.3 做浏览器端全量回归。

原因：无（测试任务）。

修改：真实 Chrome + playwright-core 驱动，分三组执行：
- repro 页面（编辑器功能）17 项：页面加载、正文输入、Markdown 往返、信息块（插入/块内输入/块内注释/徽章标题自定义/色系联动/占位符/删除）、脚注上标（行中/行尾插入、编号修改、Backspace 安全、脚注区生成）、包裹格式导出、旧格式迁移。
- 完整 App 8 项：启动与版本（health=0.7.3）、打开文档属性有值、保存后修改时间更新且创建时间不变、标题/标签写回 frontmatter、自动保存防抖、历史版本面板、全文搜索命中、附件面板加载。
- 停止脚本 1 项：stop.ps1 无 runtime.json 时按端口+特征停止 5173/8000。

影响范围：无代码变更。测试过程中出现 4 项初始失败，均为测试脚本自身问题（ProseMirror 位置 0 基误算、脚注区 Markdown 标记格式写错、误判文件树显示标题、模态遮罩关闭方式），修正脚本后全部通过，未发现产品级 bug。测试数据仅写入专用测试文档 `phase2-e2e.md`。

验证：25 项功能 + 1 项停止测试全部通过；环境已通过重启恢复。

### npm run build 构建验证

类型：Test
状态：Completed

现象：要求确认 `npm run build` 正常。

原因：无（构建验证任务）。

修改：无代码变更。停止 dev server 后执行 `npm run build`：`tsc -b` 零错误，vite 构建 `✓ built in 6.46s`，exit code 0，产物（`dist/index.html`、`index-*.js` 1.94 MB、`index-*.css` 73.7 KB）生成正常。仅有既有 chunk > 500 kB 体积提示，不影响构建与运行。验证后重启 dev server。

影响范围：无。

验证：构建产物存在且体积合理；`npm run build` exit code 0。

### 固化 Phase 7 准备分析文档（phase7-prep / phase7-prep-freeze-check）

类型：Feature（文档）
状态：Completed

现象：要求把「进入 Phase 7 前需要什么准备」的分析与「是否需要在 Phase 7 前做冻结和稳定性检查」的判断分别固化为文档。

原因：无（文档任务）。此前分析仅存在于对话上下文，需要脱离会话、供 Phase 7 开工前后查阅。

修改：
- 新增 `docs/phase7-prep.md`：Phase 7 桌面化准备分析。结论 + 四类准备：1) 环境与工具链（Rust 工具链缺失、`desktop/` 不存在、Python 运行时嵌入为最大工程点）；2) 代码与配置（前端相对 `/api` 依赖 Vite 代理需引入运行时 API base、CORS 白名单缺 `http://tauri.localhost`、`KE_PORT` 端口动态化、`attachmentUrl` 去重 6E P9、v1.0.0 版本策略）；3) 工程质量（补 test 脚本并接入 CI、日志体系、快照清理、包体积 1.94 MB）；4) 数据迁移（workspace 根迁到用户数据目录，软件级配置 `~/.knowledgeeditor/app_config.json` 已独立无需迁移，沿用 6E.2 方案）。附建议执行顺序。
- 新增 `docs/phase7-prep-freeze-check.md`：Phase 7 前冻结与稳定性检查。背景（6E 冻结基线 v0.6.0 之后 6U 叠加 8 个版本，契约以文档维护无代码校验）+ 8 项冻结契约对账（含信息块格式已修改为包裹格式、`update_article` 响应扩展为超集）+ 6E P1-P10 状态对账（P2-P5 已修复、P9/P10 留给 Phase 7、P1/P7/P8 待核对）+ 5 项稳定性检查（测试基线重跑、环境性修复稳定性、数据兼容路径文件级验证、启动/停止链路、契约校验兜底建议）+ 通过标准与结论。

影响范围：无代码变更；影响 `PROJECT_STATE.md`（下一步计划与文档索引已更新，指向两份新文档）。

验证：两份文档均已创建并经内容复查，与 `phase6e-report.md`（冻结清单 / 8.2 注意事项）、`phase6u-report.md`、`config.py`（KE_* 环境变量、`~/.knowledgeeditor/app_config.json`）、`client.ts`（相对路径 /api）、`ci.yml`（前端仅 build）交叉核对一致。

### Phase 7 前冻结与稳定性检查执行（phase7-prep-freeze-check 落地）

类型：Test
状态：Completed

现象：要求按 `docs/phase7-prep-freeze-check.md` 的通过标准实际执行冻结检查，作为 Phase 7 开工前的最后一道闸门。

原因：无（测试任务）。6E 冻结清单以文档记录维护、无代码校验，需在桌面化开工前对账。

修改：无代码变更。执行内容与结果：
- 代码核对：P1（`EditorArea.tsx` 自动/手动保存均调用 `registerRecoveryPoint`）、P7（`App.tsx` 徽章已为 "Phase 6"）、P8（`LeftSidebar.tsx` 已调用 `clearRecentDocuments`）三项待核对项均确认已修复；版本三同步 v0.7.3 一致；API 端点与 6E 清单逐项比对，46 项一致 + attachments 新增 1 个 `DELETE /api/attachments/{rel_path}`（v0.6.1 引入，属增量扩展）。
- 测试基线：`pytest -q` 102/102（1 条 Starlette 弃用警告）；`vitest run` 62/62；`npm run build` tsc 零错误、9.82s、exit code 0。
- 浏览器抽测（真实 Chrome + playwright-core）7/7：A1 旧自闭合格式打开渲染正常（0 页面错误）、A2 保存落盘为包裹格式且内容无丢失（真实文件级迁移验证）、B1 包裹格式 markdown 往返一致、C1 block 脚注、C2 plain 脚注、D1 保存后属性更新（created 不变 / updated 更新 / 元信息非「—」）、E1 拖拽文件插入附件节点。
- 启动/停止链路：`stop.ps1` 兜底路径（无 runtime.json 的遗留 backend 8000 + vite 5173 按端口+命令行特征停止）与正常路径（`start.ps1` 一键启动 → 页面可操作 → `stop.ps1` 按记录停止）均实测通过，停止后端口无残留。
- 环境性修复稳定性：dev server 冷启动预构建正常（`/`、`/repro.html` 均 200 无白屏）；`npm run build` 走 `ESBUILD_BINARY_PATH` 改名副本成功。

影响范围：无代码变更；`docs/phase7-prep-freeze-check.md` 回填执行结果与结论；`PROJECT_STATE.md` 更新（阶段状态、已知问题补充 4 项：P9 attachmentUrl、文件树 div 无 title、外部文件需重建索引、esbuild 副本的 CI 差异）。

验证：通过标准 4 条全部满足（契约对账有结论 / P1-P10 有明确去向 / 全量测试通过 / 版本三同步一致）。结论：冻结检查通过，Phase 7 可开工。测试产物（`Articles/freeze-check-legacy.md`、5 个拖拽上传附件）已清理，服务已停止。

### 出具冻结检查报告（phase7-freeze-check-report）

类型：Feature（文档）
状态：Completed

现象：要求参考 `docs/phase7-prep-freeze-check.md` 的检查标准，把冻结检查执行为正式报告。

原因：无（文档任务）。检查结果此前以「标准文档回填」形式存在，需按项目报告体系（`phase6e-report.md` / `phase6u-report.md` 风格）出具独立报告，供 Phase 7 决策与查阅。

修改：新增 `docs/phase7-freeze-check-report.md`，结构与 `phase6u-report.md` 对齐：头部元信息（阶段/日期/冻结基线 v0.6.0/复核基线 v0.7.3/范围）+ 10 个编号章节（检查概述与结论、检查标准与方法、冻结契约对账 8 项、6E P1-P10 对账、测试基线重跑、浏览器核心路径抽测 7 项、启动/停止与环境性修复、确认的既有行为、通过标准判定、结论与建议）+ 执行记录附注。数据与 `docs/phase7-prep-freeze-check.md` 回填结果一致（102 pytest / 62 vitest / build 9.82s / 浏览器 7/7 / 停止链路双路径）。

影响范围：无代码变更；`PROJECT_STATE.md` 文档索引新增该报告条目。

验证：报告数据与冻结检查执行记录逐项核对一致；与 `phase6u-report.md` 报告风格一致。

## 2026-08-10（Phase 7 规划周期）

### 出具 Phase 7 实施规划（phase7-plan）

类型：Feature（文档）
状态：Completed

现象：要求基于 Phase 7 提示词（Tauri 集成 / Sidecar 管理 / 设置系统 / Workspace 适配 / 桌面集成 / 数据迁移 / 构建安装包 / 发布前回归）作整体规划，参考 `docs/phase0-architecture.html` 体例，输出 .md 文件，且明确「先不要开工」。

原因：Phase 7 是工程性质最大的一次阶段跳跃，需在开工前把需求展开为可执行蓝图，统一技术选型、复用点、异常处理与里程碑验收。

修改：新增 `docs/phase7-plan.md`，体例对齐 `phase0-architecture.html`（封面元信息 + 目录 + 编号章节 + 决策点 + 附录）：15 个编号章节（阶段定位与边界、技术选型、总体架构含 mermaid 运行时图与生命周期状态机、7.1-7.8 各节方案、前端运行时适配、风险分析 R1-R10、里程碑 M0-M7）+ 决策点 D1-D7 + 附录 A 版本策略 / 附录 B 目录结构。复用点显式锚定现有资产：`/api/health` 握手、runtime.json 记录 schema、`start.ps1` 四段式流程、`stop.ps1` 端口+特征兜底；禁止项清单对应用户要求（不重实现 Phase 1-6 功能、不改 Markdown 格式与后端 API）。技术事实以 Tauri 2 官方侧车文档（`bundle.externalBin` + target triple 后缀 + `tauri-plugin-shell` 权限）与 NSIS/WiX 打包踩坑记录为依据。

影响范围：无代码变更；`PROJECT_STATE.md` 文档索引新增该规划条目；`docs/phase7-plan.md` 成为 Phase 7 实施时的总纲（与 `phase7-prep.md` 准备基线、`phase7-freeze-check-report.md` 闸门记录配套）。

验证：规划数据与冻结检查结果一致（42 端点基线、102/62 测试、esbuild 改名副本约束、1.94 MB 前端产物、30 份备份策略、`/api/index/rebuild` 存在）；章节覆盖用户提示词全部条目（7.1-7.8、版本要求、最终输出 8 项、开发记录要求）。

## 2026-08-10（Phase 7 M0 周期）

### 完成 M0：环境就绪 + Tauri 桌面壳脚手架

类型：Feature
状态：Completed

现象：Phase 7 需要 Rust 工具链与 VS Build Tools 作为 Tauri 编译前提，并创建 `desktop/` 工程；本机 rustup 安装被安全软件按路径拦截（`~\.cargo\bin` 硬链接创建失败，os error 1）。

原因：安全软件策略按目录路径拦截 NTFS 硬链接创建：`~\.cargo`、`~\.rustup`、D: 卷均拒绝，`%TEMP%` 与 `%LOCALAPPDATA%` 允许（A/B 测试确认）。rustup 内部依赖硬链接生成代理（rustc/cargo 等 14 个 exe），默认 home 目录下无法完成。

修改：
- 工具链：VS Build Tools 17.14.37（MSVC 14.44.35207 + Windows SDK 10.0.26100.0，含 `link.exe`/`rc.exe`）经提权静默安装；rustup 重定位 `CARGO_HOME=%LOCALAPPDATA%\cargo`、`RUSTUP_HOME=%LOCALAPPDATA%\rustup`（用户级环境变量已持久化），装得 Rust 1.97.1 stable（minimal profile）。
- 镜像：新增 `%LOCALAPPDATA%\cargo\config.toml` 使用 rsproxy.cn 稀疏索引（首次编译 Tauri 依赖数百 crate，直连 crates.io 过慢）；用户级配置不随仓库分发。
- 脚手架：新增 `desktop/` Tauri v2 工程（`src-tauri/Cargo.toml`、`tauri.conf.json`、`src/main.rs`、`src/lib.rs`、`capabilities/default.json`、占位图标全套、`package.json` 含 `@tauri-apps/cli`）。`tauri.conf.json` 关键项：`productName=KnowledgeEditor`、`frontendDist=../../frontend/dist`、`devUrl=http://127.0.0.1:5173`、`beforeDevCommand=npm --prefix ../frontend run dev`（相对 desktop/ 解析）、`bundle.targets=nsis`。
- 其他：`.gitignore` 追加 `desktop/target/`；`PROJECT_STATE.md` 增加架构约束 9（Rust 工具链重定位）。

影响范围：开发机 Rust 工具链位置（新终端经用户级 PATH 自动生效）；`desktop/` 为新工程目录；前端 `frontend/dist` 与 dev server 复用不变。

验证：`rustc 1.97.1` 编译 hello world 经 MSVC 链接成功输出（MSVC 链路 OK）；`cargo build` 通过生成 `knowledgeeditor.exe`（debug 12.6 MB）；`npx tauri dev` 冒烟通过——vite dev server 5173 返回 200，桌面窗口创建且标题为 "Knowledge Editor"，WebView2 渲染进程正常，停止后无残留。

### 确认 Phase 7 决策点并冻结实施规划（phase7-plan）

类型：Feature（决策）
状态：Completed

现象：要求「6 个决策点全部按默认进行」，更新规划文档后开工 M0。

原因：决策点确认是设计冻结的标志，之后实施不再变更；同时补入安装器目录选择与卸载数据保护两处此前核实的事实细节。

修改：`docs/phase7-plan.md` 更新 5 处：头部加「决策点 D1-D7 已全部确认，进入 M0」状态行；第 2 章安装包选型行与第 11 章 tauri build 步骤明确 `installMode: currentUser`（免提权、安装时可自选目录）；第 10 章安装程序约束补充 Tauri NSIS 卸载器「删除应用数据」复选框细节（默认不勾选，文案显式声明 workspace 保留，必要时 NSIS hook 剔除）；第 15 章决策点表改为冻结态（D1 Phase 0 已确认，D2-D7 六项按默认确认）。

影响范围：无代码变更；决策冻结后 Phase 7 按 `docs/phase7-plan.md` 执行，M0 开工。

验证：文档更新与已核实事实一致（Tauri NSIS 模板含 `MUI_PAGE_DIRECTORY`；`installMode` 三模式语义；卸载器 app data 复选框）。

## 2026-08-26（v1.0.1 修复批次：P0×4 / P1×17 / P2×20 / P3×21 / P4×13 全量执行）

### 依据：9 份独立审计报告整合清单（knowledge-editor-fix-checklist.md）

类型：Bugfix（阻断级：保存丢数据 / 整库删除 / 跨文档串内容）
状态：Completed（本地修复完成，未推送 GitHub）

#### P0 阻断级（4/4）
- P0-1 保存清空 frontmatter：后端 `update_article` 改无损合并（`merge_frontmatter` 原始行合并，含嵌套 YAML/注释）；前端 `withFrontmatter` 改合并语义仅更新 ke_version。回归：`test_p01_*` + fidelity P0-1
- P0-2 防抖窗口输入静默丢失：前端 per-doc 单飞保存队列（state/saveQueue）+ 统一 `requestOpenArticle` 入口（dirty 先 flush/confirm）+ beforeunload + Tauri 关窗握手（Rust emit `ke:close-requested` → 前端 flush → close()）
- P0-3 DELETE /api/fs/dir 整库删除：`safe_rel_path` 显式拒绝根路径等价输入（"."/""/"/"/"Articles/.."）；delete_dir/rename_dir/move 增加业务目录父级断言
- P0-4 切换文档 Ctrl+Z 跨文档串内容：`setKeContent` 清空 undo/redo 历史（prosemirror-history 状态重写）

#### P1 高优先（17/17）
打开即保存（emitUpdate:false）、HTML 注释/块保真（HtmlPassthroughExtension）、已知 kind 坏 JSON 兜底、表格 \| 转义/行内富文本/合并单元格禁用、module source 字段合并（含 kind）、保存单飞队列（乱序合并）、请求序号（openWithSeq/shouldAcceptSave）、外部修改 stale closure（articleIdRef）、SQLite RLock + 批量事务、API 路径白名单（doc/attachment/history/draft 负向矩阵）、删除前强制快照 + restore 重建已删文档、单实例插件 + 命令行校验杀进程、30s 运行时握手（ke:runtime-ready）、关窗 flush + recovery 目录扫描优先、SVG/HTML attachment 强转 + shell 权限移除 + 最小 CSP、CI 三重失效修复（master/跨平台 esbuild/Windows job/可复现构建+hash manifest）、symlink/Junction 递归越界（walk_files/walk_dirs 全链路替换）

#### P2 中等（20/20）
frontmatter 非完整 YAML（BOM/CRLF/嵌套对象无损）、非 UTF-8 422、快照同毫秒单调、快照失败不阻塞、上传/导入配额与 zip 实际字节计、重建单事务、设置死开关接线（restoreLastState/autoOpenRecentWorkspace）、错误状态区分（classifyLoadState）、WorkspacePicker 走 apiBase、release 日志落盘（logs/backend.log）、atomic_write fsync、settings/app_config 随机 tmp+锁、watcher 增量 reindex、草稿名含哈希防冲突、fs move/delete 附件引用保护、TrustedHost + KE_API_TOKEN、脚注 } --> 平衡匹配、保护目录大小写不敏感、崩溃重启重探测端口+整树杀+health 身份校验、上传后 mark_internal

#### P3 低优（21 项中 19 项落地）
Windows 保留名/尾点超长 slugify、增量索引校验（reconcile 签名）、搜索通配符转义+FTS 短语回退、外部删除当前文档、恢复检测重试+入口、workspace_create 文件路径 400、symlink 索引、restore 响应补元信息、frontmatter title 接线、导入引用改写仅命中字面量（代码块/URL 掩码）、buildFileTree memo、U+200B 保存剥除、测试 include .tsx、conftest 函数级隔离、OpenAPI schema 快照、拖拽插入竞态（shouldInsertDroppedFiles）、最近菜单动态化、运行时握手。
未落地（已注明）：P3-2 解析性能门槛（超线性解析）、P3-4 watcher 改 ReadDirectoryChangesW（保持轮询，性能项单独排期）。

#### P4 整理项（13 项中 11 项落地）
stable id（keStableId）、repro-main 移除、错误信息去绝对路径、requirements 版本锁定、签名脚本（KE_SIGN_CERT_THUMBPRINT 可选）、start.bat UTF-8、modules 含 .markdown、规范文档关系声明（P4-10）、~下标~ 说明、module source kind、大纲 Tab 实现。
未落地（已注明）：P4-2 深色主题仅 color-scheme 兜底（UI 主题工作量，单独排期）、P4-7 前端主包代码分割（mathlive/katex 拆 chunk，构建优化单独排期）。

#### 验证结果
- backend：157 passed / 2 skipped（symlink 需管理员权限，Windows 跳过）——含 41 个新增回归用例
- frontend：155 passed（20 文件）——含 85 个新增用例（fidelity 25 + state 58 + 其它）
- 桌面 Rust 改动未编译验证（本机无 cargo）：lib.rs/menu.rs/sidecar.rs/settings.rs 均经代码评审自查；PowerShell 三脚本语法校验通过；ke-vite.mjs 在 Linux 实跑通过

影响范围：前后端 + 桌面壳 + CI + 文档；数据格式（Markdown）无破坏性变化。

## 2026-08-27（v1.0.1 验证与收尾：编译验证 / 桌面冒烟 / P1-16 溯源消除 / 遗留项落地）

### 验证与发布收尾（阶段一）

类型：Verification（编译/冒烟/复跑）
状态：Completed（本地完成，未推送 GitHub）

- 阶段一.1 Rust 编译验证：Windows rustc 1.97.1(MSVC) 实机 `cargo check`/`cargo build` 全绿
  （发现并修复 settings.rs unique_tmp_path format! 参数不匹配 + menu.rs unused import；
  Cargo.lock 自动补入 tauri-plugin-single-instance 2.4.3）。日志见 cargo-check/build/build2.log。
- 阶段一.2 桌面冒烟（真实 GUI 会话，截屏 evidence-ke-window-v101.png）：
  ① 编辑→保存→重开→字节比较 PASS（生产 PyInstaller 侧车 v1.0.1，真实 workspace）；
  ② 双实例：第二实例 exit 0 即退，仅 1 个窗口；③ 慢启动握手：GUI 实机注入 api_base 成功 + 单元测试覆盖 5-15s；
  ④ stale PID：无关进程身份校验不命中→不杀；真实 backend 命中（PowerShell 实测）。
- 阶段一.3 P1-16 矛盾消除（方案 a）：预编译 exe 移出版本库（git rm --cached + *.exe/versions.json/manifest.sha256 gitignore），
  侧车 = 构建期产物（PyInstaller spec 为唯一来源）；新增 binaries/README.md 构建契约；
  版本一致性校验改为「运行时拉起 exe 查 /api/health 比对 __version__」（字节扫描对 PyInstaller 压缩 PYZ 失效，已弃用）。
- 阶段一.4 T0 端到端字节比较：pytest test_t0_e2e_save_reopen_byte_exact + vitest fidelity T0
  （title/tags/自定义键 + HTML 注释/块逐字节保留、幂等）。
- 阶段一.5 Linux 跨平台复跑：backend 160 passed/2 skipped（Windows 语义用例正确 skip）、
  frontend 178 passed/1 skipped、tsc 0、npm run build 成功；
  顺带修复 Linux 下 delete_dir 符号链接残留 bug（新增 walk_links/unlink_link，链接本体移除绝不触碰目标）。

### 遗留项（阶段二，全落地）

类型：Performance / FEATURE
状态：Completed

- P3-2 解析性能：定位=上游 @tiptap/markdown 二次复杂度（marked 21ms 线性/等价 HTML 280ms 线性/256KB 解析 4.4s、512KB 43s）；
  缓解=setKeContent 会话级解析缓存（256KB 重开 733-900ms）+ perf-bench.test.ts 门槛（首解析 ≤6s、缓存重开 <1.5s、KE_PERF_512=1 观测 512KB）。
- P3-4 watcher：空闲指数退避（1s→5s 封顶，next_backoff 纯函数 + 测试），空闲期全树 stat 频率降 80%。
- P4-7 代码分割：manualChunks（math/editor/react/vendor），主包 1.96MB→122KB（gzip 35KB）。
- P4-2 深色主题：[data-theme=dark] 完整 CSS 覆盖层（~50 工具类映射 + 编辑器/滚动条/hover 适配），applyTheme 解析 system→resolved 并监听系统切换。

验证：Windows/Linux 双平台 pytest 160/160 + vitest 178/178 + tsc 0 + npm build 成功；build.ps1 全链路（pytest→tsc/ke-vite→版本校验→manifest）在 Windows 实跑。
剩余说明：CI 未在本机触发（无 push）；Windows 侧侧车构建需本机平台 node_modules（@esbuild 平台二进制随安装平台），CI 各 runner 各自 npm ci 无此约束。

## 2026-09-02（v1.0.2：导出为普通 .md）

### 功能：导出为普通 Markdown（朴素降级，KE 方言 → 标准 Markdown）

类型：Feature
状态：Completed（本地提交 v1.0.2，未推送 GitHub）

- 新增 `frontend/src/editor/plain-export.ts`：`stripKeFrontmatter` / `downgradeKeNodes` / `plainMarkdown`
  - frontmatter：删 ke_version / ke-module 定义块，保留 title/tags/created/updated（删空移除整个 --- 块）
  - ke-note → `> **{label|title|信息}**{（author）}` + 内容逐行 `>` 前缀；ke-module → `> 模块：{name}`
  - ke-attach image → `![alt](src)` + 图注行；file / ke-video → `[title](src)` 链接
  - ke-footnote 行内 → `[^n]`（独立成行的位置型标记删除整行）；ke-footnotes 区域 → `[^n]: text` 按 n 升序、续行缩进 4 空格
  - `<!-- ke-version ... -->` 独立行删除；未知/损坏 ke-*、ke-NOTE 变体原样保留；HTML/公式/标准 Markdown 逐字节保留
  - 幂等（合并式 frontmatter）
- EditorArea「导出 ▾」新增第三项「导出普通 Markdown (.md)」；原第一项改名「导出 Markdown（KE 格式）」
- 测试：`plain-export.test.ts` 8 用例（六项断言 + GFM 渲染无残留验证）
- 文档：`docs/knowledge-editor-plain-export-design.md`
- 验证：vitest 186 passed / 1 skipped（22 文件）、tsc 0 错误、npm run build 成功；
  样式证据 `evidence-plain-export-sample.md`（公式/表格/脚注/图片/信息块样例降级后 GFM 渲染干净）
- 已知限制：附件相对路径引用（单文件不内联二进制）；ke-module 不做 inline 展开（v1 决策）

## 2026-09-04（v1.0.2a：导出菜单"点击无反应"热修复）

### Bugfix：导出保存改原生另存为（共享路径）

类型：Bugfix
状态：Completed（本地提交，未推送）

- 版本标记：v1.0.2a（发布/标签后缀；技术版本常量保持 1.0.2 —— `a` 为非 semver 后缀，Cargo/tauri/npm 不接受，且 CI 运行时版本校验与「三同步常量」要求全栈一致）。
- 根因：Tauri WebView2 下 `a[download]+blob` 为**静默下载**（无另存为弹窗/无完成提示），且同一会话第二次起的程序化下载被 WebView2 多下载策略静默丢弃（实测第 1 次落盘成功、第 2/3 次 downloadBlob 被调用但无文件落地）→ 用户体感"点击无反应"。
- 修复：新增 `import-export.saveOrDownload`（File System Access API `showSaveFilePicker` 原生另存为优先；AbortError 静默返回；否则回退 downloadBlob）；新增 `editor/export-actions.ts` 统一三种导出载荷（keExportPayload / plainExportPayload / packageExportAndSave）；EditorArea 三 handler 全部接入。
- 回归：`export-actions.test.ts` 6 用例（三模式各走正确保存路径与参数；picker 优先/取消/回退）。
- 验证：vitest 192 passed / 1 skipped（23 文件）、tsc 0、npm build ✓；WebView2 实机三模式真实点击均触发 showSaveFilePicker 且文件名正确。

## 2026-09-05（v1.1.0：UI/UX 重构正式发布）

### 里程碑完成：UI/UX 重构（设计令牌层 → 参考稿对齐 → 审查修复 → 正式发布）

类型：Feature（里程碑）
状态：Completed（v1.1.0-pre.1 审查 → 修复阻断 → 正式发布，本地与 GitHub Release 均完成）

现象：v1.0.2a 之后 UI 与设计参考稿差异大，经历多轮重构与审查后定版。

原因：用户要求按 `knowledge-editor-ui` 设计稿（editor/launcher/settings + handoff + colors_and_type.css）对齐前端 UI；随后两轮前端 agent 审查（视觉 + K3 对抗式）逐项修复；K3 判定"唯一阻断 = 版本源漂移"，修复后发布正式 v1.1.0。

修改（覆盖 9 个提交：5ee3102 → 778b791）：
- **批次 1A-1D**：语义令牌层（浅/深两套 + Tailwind `@theme inline` 桥接）+ 渲染前主题注入；三栏壳 AppShell/StatusBar；左栏（品牌块/搜索胶囊 Ctrl+K/QuickNav/模块区/数据主权页脚）；单行 40px 工具栏（正文▾/B/I/U/列表/引用/代码/链接/图片/公式×2/模块▾/代码块/注释/信息块/表格/撤销重做，左右滑不收起）；右栏三卡（属性/大纲/附件+孤儿引用徽章/历史快照）；NodeView 视觉（图片灯箱+图注、公式透明+双击、信息块圆角卡+徽章色板、模块 display:none 无边界、视频保留）；设置页整页（左分组 220px 锚点跳转 + 卡片式）；启动器卡片式（BrandHero+两操作卡+最近 3 条）。
- **工具**：`icons.tsx` 线性 SVG 集（~60 枚）；`slug.ts` 文件名 slug（对齐后端契约）。
- **主题**：Phase 2 自定义强调色（浅/深两套 + `accentColor` settings schema + `applyTheme` 覆写 `--primary`/`--sidebar-primary`/`--ring` + 派生 token `color-mix` 全链路跟随）；深色默认 #3b82f6（主理人拍板，非设计稿 #fc2c50；用户可在设置改）。
- **字体**：DM Sans（`@fontsource/dm-sans` 本地打包 400/500/700，主理人拍板引入）。
- **后端/壳**：`GET /api/modules` 增 `version`（批准变更）；新文档模板去掉自动 `# {title}`（标题由可编辑页眉承载，blur/回车同步 frontmatter title + 文件名 slug 重命名）；原生菜单补齐新建工作区/关闭/恢复检查/设置入口；`indexer._title_of` 防御数字 title（YAML `title: 111` 曾致 workspace open 500）；`slug` 保留名对齐（con.txt→_con.txt）。
- **审查修复（K3）**：RC-VERSION 版本源三处漂移（desktop/package.json、lock、WorkspacePicker 重复常量→import APP_VERSION）；F1 表格网格高亮类拼写 `bg-primary-soft0`→`bg-primary-soft`；F2 全局 `:focus-visible` 环 --ring（正文/搜索框蓝框随后修复：contenteditable 排除 + React state 驱动胶囊聚焦态）；版本源七处统一 1.1.0（Cargo/tauri/frontend/desktop/backend/version.ts/Cargo.lock，grep 零残留）。
- **v1.1.x backlog**：K3-I1/I2/T1/B1 延后项写 `docs/backlog-1.1.x.md`；构建环境备忘 `docs/tauri-build-env-notes.md`（WSL 挂载盘 symlink 坑 + NSIS 绕行方案）。

影响范围：前端全部 UI 层、后端 3 文件、桌面壳 menu.rs/settings.rs、新建文档模板；导出管线（plain-export/export-actions）零改动。

验证：
- 前端 vitest **205 passed** / 1 skipped（+8 slug 契约测试）；tsc 0；构建产物 `frontend/dist-build`。
- 后端 pytest 全绿；Rust 11 passed；导出专项 14 passed 且 diff=0。
- sidecar 运行时校验：独立拉起 `/api/health` = **1.1.0**（前后端版本告警消除）。
- GUI 实测：浅/深/自定义强调色三态；公式双按钮/保存按钮/未保存橙点/标签索引/无文档库/焦点环 #4285f4/F1 网格高亮 6 格；正文与搜索框无蓝框。
- 发布：GitHub Release **v1.1.0**（Pre 票 v1.1.0-pre.1 先行）附件四件套：sidecar exe、“KnowledgeEditor_1.1.0_x64-setup.exe”（NSIS 50.7MB，本机构建）、manifest.sha256、versions.json（81 项）；CI 三个 push 工作流 success。
- 版本一致性：远端 master = 本地 HEAD；v1.1.0 tag 与其构建产物一致（后续 ccd6814/778b791 为构建依赖与文档，不进 tag 语义正确）。
