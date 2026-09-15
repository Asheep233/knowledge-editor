# Agent 交接文档 · Knowledge Editor / AstraNota

> 交接时间：2026-09-08 · 交出方：上一任主 Agent · 接收方：下一任 Agent
> 当前版本：**v1.1.8 正式版（已发布 2026-09-15）** · 分支 master
> **重要背景**：主理人即将把工作区迁移到其他盘——本文 §9 是迁移后必须核对的清单。

---

## 0. 30 秒速览

| 项 | 值 |
|---|---|
| 产品 | **AstraNota**（内部代号 Knowledge Editor / KE）· Windows 本地优先 Markdown 知识编辑器 |
| 代码位置 | 交接时：`D:\KE Project\knowledge-editor`（**迁移后以主理人告知的新路径为准**）|
| 技术栈 | React 19 + TS + Tiptap 3 + Tailwind v4 前端；FastAPI（PyInstaller 侧车）后端；Tauri 2 + WebView2 桌面 |
| 当前状态 | v1.1.8-pre.1 已发布（预发布）· v1.1.7 正式版线上 · 三域全量测试通过 |
| 红线 | ke-* 文件格式（D 层）与 Markdown 单源**不得破坏**；产品标识 B 层已冻结（见 §4）|
| 第一件事 | 读 §9 迁移核对 → 跑 §5 验收命令 → 读 §6 发布流程 |

---

## 1. 仓库与分支

| 项 | 值 |
|---|---|
| 远程 | `https://github.com/Asheep233/knowledge-editor.git`（gh CLI 已认证，账号 Asheep233）|
| 主分支 | `master`（所有工作直接提交 master，无 PR 流程）|
| 标签 | `v1.0.0` … `v1.1.7`、`v1.1.8-pre.1`（预发布）、**`v1.1.8`（正式版，2026-09-15）**|
| 推送方式 | `git push https://asheep233:$(gh auth token)@github.com/Asheep233/knowledge-editor.git master <tag>` |
| 旧检出 | `D:\Agent\KnowledgeEditor`（v1.0.0 时代，同一仓库，调查结论：可删，回收 12GB）|

## 2. 目录结构（关键路径）

```
<repo>/
├─ frontend/                 React 前端（Vite；构建输出 dist-build/）
│  ├─ src/editor/            Tiptap 编辑器：extensions/（ke-* 节点）、tokenizers.ts（marked 扩展）、
│  │                         index.ts（编辑器装配 + 键盘快捷键）、math/（公式模板/补全/槽位）
│  ├─ src/components/        UI：layout/（App 外壳、EditorArea、WorkspacePicker）、editor/（工具栏、
│  │                         MathEditorModal、nodeviews/*）、settings/、common/
│  ├─ src/api/client.ts      后端 HTTP 客户端（apiBase()）
│  ├─ src/settings.ts        设置 schema + 归一化 + applyTheme + 缓存
│  └─ src/utils/slug.ts      ★ 文件名策略（filenameFromTitle，与后端契约对齐）
├─ backend/                  FastAPI 侧车
│  ├─ app/routers/           documents / fs / import_export / history / index / attachments / search …
│  ├─ app/services/          markdown_io（★ 解析/序列化/命名）、indexer（索引）、fs_watch（外部变更）、
│  │                         history_store、references
│  ├─ knowledgeeditor-backend.spec   PyInstaller 配置
│  └─ tests/                 pytest 175 项
├─ desktop/                  Tauri 2 桌面壳
│  ├─ src-tauri/src/         lib.rs（启动/setup/单实例）、sidecar.rs（★ 侧车生命周期）、
│  │                         menu.rs（原生菜单 + 退出流程）、settings.rs（设置持久化 + lenient 白名单）
│  ├─ src-tauri/tauri.conf.json   ★ 窗口/CSP/NSIS/beforeBuildCommand
│  ├─ src-tauri/nsis/        legacy-migration.nsh（旧版安装迁移钩子）
│  └─ src-tauri/binaries/    侧车 exe（构建时嵌入）
├─ docs/                     规范 + 报告 + 设计 + 交接（见 §7）
└─ workspace/                本地开发工作区（vite 缓存等；非交付物）
```

## 3. 架构要点（必读）

### 3.1 数据与格式
- **Markdown 是唯一事实源**；frontmatter 由 `markdown_io.parse/merge_frontmatter` 无损处理（注释/嵌套 YAML 保留）
- **ke-* 扩展格式**（`<!-- ke-note -->`、`ke-footnote`、`ke-attach` 等）规范在 `docs/document-format.md` +
  `docs/markdown-extension-spec.md`——**改动格式必须先改规范再改代码**
- v1.1.7 起 `ke-note` **块内内容为块级 Markdown**（列表/多段落整体进信息块）；空信息块解析时补空段落
- v1.1.8 起**文件名保留原标题**（`sanitize_filename` / `filenameFromTitle`）：仅替换 `< > : " / \ | ? *`
  与控制字符，保留大小写/空格/CJK；Windows 语义（首尾空白/首部点/尾部点、保留名前缀 `_`、80 字符截断）

### 3.2 编辑器（前端）
- 扩展装配：`frontend/src/editor/index.ts`（StarterKit 定制 + ke-* 扩展 + 快捷键）
- 自定义 tokenizer：`editor/tokenizers.ts`（marked 扩展；块级 ke-* 标记用 **lexer.blockTokens** 处理子内容）
- 公式：`MathEditorModal`（全屏模态）**必须由 EditorArea（编辑器根）持有**——挂在 nodeview（tiptap 独立
  React 根）内会触发 React #300（见 §8 坑 1）；保存按**节点 id** 遍历 doc 定位，不依赖 getPos
- 列表：`ListExtension`（OrderedListParen + KeListItem）；信息块：`NoteExtension` + `NoteNodeView`

### 3.3 后端与桌面壳
- 侧车由 `sidecar.rs` 拉起（`KE_WORKSPACE`/`KE_PORT` 可注入，用于隔离测试）
- **退出流程**：`menu.rs::request_exit` → **有界同步清理**（`taskkill /F /T` + 1.2s 预算）→ `app.exit(0)`；
  侧车随主进程消亡（v1.1.7 修复孤儿占端口；勿改回"分离线程 + 立即退出"）
- 单实例：tauri-plugin-single-instance；二次启动回调 `show()+unminimize()+set_focus()`
- 设置：前端 `settings.ts` → Tauri IPC → `settings.rs`。**新增设置字段必须同步三处**：
  前端 schema/normalize、Rust 结构体、**`from_value_lenient` 白名单**（漏了 → IPC 返回 null，难查）

## 4. 冻结项与红线（不得擅动）

| 项 | 说明 |
|---|---|
| B 层标识 | 应用标识 `com.knowledgeeditor.desktop`、数据目录 `%APPDATA%\KnowledgeEditor`、exe 名 `knowledgeeditor.exe`、侧车名 `knowledgeeditor-backend` —— **不得重命名**（升级兼容）|
| D 层格式 | ke-* 标记与 Markdown 单源语义 —— 改动须走规范 + round-trip 测试 |
| 版本源 9 处 | backend `app/__init__.py` / frontend `package.json`+`lock` / `version.ts` / desktop `package.json`+`lock` / `Cargo.toml` / `Cargo.lock`（**仅 knowledgeeditor 块**）/ `tauri.conf.json` |
| 产品名 | AstraNota（显示名）；安装包 `AstraNota_<ver>_x64-setup.exe` |

## 5. 日常验证（每次改动后）

```bash
# 前端
cd frontend && npx tsc -b --noEmit && npx vitest run && npm run build
# 后端
cd backend && python -m pytest
# Rust（先杀 GUI，否则 exe 被占用 → tauri-build PermissionDenied）
cd desktop/src-tauri && cargo test
```

**GUI 冒烟（开发版）**：
```powershell
# 先编出 release exe（注意：target 在仓库外，见坑 15）
cd desktop\src-tauri && cargo build --release          # 首编 ~3.6 分钟（依赖缓存已在）
# ★ 若本次改动含 backend/**：必须先重建侧车再 cargo build（见坑 18），
#   否则 GUI 里新端点一律 404，而「版本不一致」横幅检测不到（版本号没变）
# 启动脚本（已就绪）：设置 WebView2 调试端口 9333（9222 会被 Edge 抢占！）
powershell -File C:\ke-tmp\launch-release-cdp.ps1
# 连接：http://127.0.0.1:9333/json  → 找 type=page 的目标（url 含 tauri.localhost，title=AstraNota）
```
- **★ CDP 探针统一入口：`python -X utf8 C:\ke-tmp\cdp-eval.py "JS表达式"`**（或 `@expr.js` 从文件读）
  —— 自动找 9333 的 page 目标、求值、打印结果。**不要再用 `C:\ke-tmp\*.py` 里那批历史脚本**：
  它们硬编码 9222（会打到 Edge）且多数写死了早已失效的 page id。
- **人工验收归主理人**（视觉/手感）；Agent 只做程序化断言——不要试图用截图代替主理人判断

**Agent 侧已可程序化断言的项（2026-09-14 实测通过）**：

| 断言 | 方法 | 实测值 |
|---|---|---|
| 启动到可交互 | `Runtime.evaluate` 读 `window.__bootTimings` | 1.64s（基线 1.7s）|
| 前后端版本一致 | DOM 找版本节点 + `/api/health` | `后端 v1.1.8-pre.1`，无「版本不一致」横幅 |
| 文档打开 + 编辑器挂载 | `.ProseMirror` 存在 + 文本非空 | ✅ |
| 公式渲染 | `.katex` / `.katex-error` 计数 | 10 节点 / 错误数取决于源文档 |
| 关窗退出无孤儿（S1 回归）| 单次 `CloseMainWindow()` → 观察进程 + 8000 端口 | **2s 退出 / 0 残留 / 端口释放** |

## 6. 发布流程（照抄，勿即兴）

```powershell
# 0) 版本 bump：9 处源（见 §4）。注意正则用 1\.1\.\d[^"]*（写死 1.1.7 会漏）
# 1) 全量回归（§5 四条命令）
# 2) 前端构建（必须在 bump 之后！）并核对产物版本：
cd frontend && npm run build
grep -o '1\.1\.\d[^"]*' dist-build/assets/index-*.js | sort -u    # 应只出现新版本
# 3) 侧车重建 + 拷入 binaries
#    ★ PyInstaller 只在 Windows 侧（WSL 未安装，且只能构建 Linux 二进制）
powershell -Command "Set-Location 'F:\Work\KE Project\knowledge-editor\backend'; & 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m PyInstaller --noconfirm knowledgeeditor-backend.spec"
copy backend\dist\knowledgeeditor-backend.exe desktop\src-tauri\binaries\knowledgeeditor-backend-x86_64-pc-windows-msvc.exe
# 4) NSIS 构建（WSL 预构建 + no-op beforeBuildCommand 的绕行见 §8 坑 5）
#    tauri.conf.json 的 beforeBuildCommand 临时改为 "echo frontend prebuilt"，构建后恢复
cd desktop && node node_modules\@tauri-apps\cli\tauri.js build --bundles nsis
# 5) manifest（84 项）+ 收集 4 附件：安装包 / 侧车 exe / manifest.sha256 / versions.json
#    （脚本参考 C:\ke-tmp\gen-manifest.py；从 binaries\ 复制 manifest 与 versions 到 bundle\nsis）
# 6) tag + push + release
git tag v<ver> && git push <token-url> master v<ver>
gh release create v<ver> --repo Asheep233/knowledge-editor --title "..." --notes-file <notes.md> --prerelease <4 附件>
# 7) 装包自检：版本横幅不得出现「前后端不一致」（见 §8 坑 2）
```
**发布检查单（血泪）**：
1. bump 后**必须**重新 `npm run build`（否则安装包内嵌旧前端 → 版本不一致）
2. 打 NSIS 前 `grep` 核对 dist-build 版本号
3. 附件更新用 `gh release upload <tag> --clobber`
4. 装包后看版本横幅 + 关窗后任务管理器无侧车残留

## 7. 文档索引（docs/）

| 文件 | 内容 |
|---|---|
| `document-format.md` | ke-* 格式规范（含 §2.1.1 ke-note 包裹格式/块级内容）|
| `markdown-extension-spec.md` | Markdown 扩展规范（§3.1 内容语义）|
| `test-plan-v1.1.8-pre.md` | 三域测试计划 + 隔离规约 + **发布检查单附录** |
| `test-report-v1.1.8-pre.md` | 三域测试报告 + S1 缺陷 + 用户实测批次（§9）|
| `design-v1.1.7-math-editor.md` | 公式编辑器设计 + **实施修正记录**（白屏/撤销弹窗根因）|
| `backlog-1.1.x.md` | 历史延后项 + **v1.1.8 已落地/候选** |
| `CHANGELOG_DEV.md` | 版本历史（最新在上）|
| `iteration-plan-1.1.x.md` | 迭代计划 + 发布门禁 |
| `tauri-build-env-notes.md` | 构建环境备忘（WSL 挂载坑 + NSIS 绕行）|

## 8. 已踩过的坑（同类别再犯 = 事故）

1. **React #300（白屏）**：tiptap nodeview = 独立 React 根；在其中（或其后代 portal）触发 PM 事务
   → update-during-render 崩溃。**规则**：需要改文档的 UI（模态/面板）放 EditorArea 层。
2. **版本不一致横幅**：安装包内嵌旧前端（bump 后忘记 `npm run build`）。前端 `version.ts` 与侧车
   `/api/health` 版本必须一致。
3. **Tauri `dragDropEnabled` 默认 true** → OS 级文件拖放被 Tauri 接管，DOM 收不到 drop。已设 false。
4. **CSP**：`img-src`/`media-src` 必须含 `http://127.0.0.1:*`（否则后端图片全部渲染失败，字节/头却正常）。
5. **构建锁**：GUI 运行时 `cargo build`/`tauri build` 会 `PermissionDenied`（exe 被占用）→ **先 taskkill**。
   NSIS 构建前 `beforeBuildCommand` 临时改 no-op（WSL 下 npm 前缀调用会失败）。
6. **侧车孤儿**：退出必须**同步有界**清理侧车（见 §3.3），否则孤儿占 8000，二次启动连到陈旧后端。
7. **路径大小写**：slug/文件名在 Windows 上大小写不敏感，但探针/断言大小写敏感——**测试用精确名**。
8. **CDP 端口**：9222 常被 Edge 抢占（探针会打到 Edge！），统一用 **9333**（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`）。
9. **PM 键位/选区自动化不可靠**：合成键盘/鼠标事件进不了 PM 内部处理（列表输入规则、拖拽、真实
   选区）。此类行为**交人工验收**，Agent 只验 DOM 结构与接口层。
10. **非受控输入**：标题输入框与公式源码框必须非受控（受控会导致光标跳尾/选区丢失）。
11. **`%TEMP%` 膨胀**：PyInstaller `_MEI*` 每次构建 200-500MB；构建前顺手清理（曾积 15GB）。
12. **设置字段三处同步**（§3.3），漏 `from_value_lenient` = 设置静默失效。
13. **版本 bump 绝不能用全局正则改 lockfile**：`"version": "1\.1\.\d[^"]*"` 会把第三方包
    （picocolors、@standard-schema/spec …）的版本一起改写 → `npm ci` 永久失败（上游无该版本）。
    **统一用 `node scripts/bump-version.mjs <版本>`**（只改项目自身 9 处字段）。
14. **双平台 node_modules（WSL + Windows）**：`npm install` 在哪个平台跑，就只装哪个平台的
    esbuild/rollup 可选二进制。本仓库的 vitest/tsc/前端构建都在 **WSL** 跑 →
    **依赖安装必须从 WSL 执行**（`cd frontend && npm install`）；Windows 侧只跑 tauri CLI
    （发布流程已把 `beforeBuildCommand` 置为 no-op，前端在 WSL 预构建）。
    症状：`[ke-vite] 未找到 esbuild 二进制: .../@esbuild/linux-x64/bin/esbuild`。
    补：`desktop/` 恰好相反——它是 `@tauri-apps/cli` 的原生二进制，**必须在 Windows 侧装**
    （`cmd /c "cd /d <repo>\desktop && npm ci"`），Windows 下才拿得到 `cli-win32-x64-msvc`。
15. **cargo target 被重定向到仓库外**：Windows 用户环境变量 `CARGO_TARGET_DIR=F:\Work\Dev\cargo-target`
    → **仓库内 `desktop\src-tauri\target\` 根本不存在**，产物在
    `F:\Work\Dev\cargo-target\{release,debug}\`。任何写死 `<repo>\desktop\src-tauri\target\...`
    的脚本（历史 `launch-*.ps1` / `run-gui-cdp.bat`）都会静默失效。
    另：`target/release/` 无缓存时 `cargo build --release` 约 3.6 分钟（依赖缓存 3.9G 已随迁移保留）。
16. **`KE_WORKSPACE` 不能隔离 GUI！**（★ 写数据安全相关）
    `KE_WORKSPACE` 只影响**侧车启动参数**（`/api/health` 会如实回报该工作区），但**前端会从持久化设置
    恢复「上次工作区」并调用切换 API 覆盖它** → 实际打开的是主理人**真实工作区**。
    实测：带 `KE_WORKSPACE=...KE-TestWorkspace` 启动，状态栏与树仍显示 `...\Documents\KE Workspace`。
    **Agent 规则**：GUI 自动化默认视为**无隔离**——只做只读操作（点击打开文档是只读的，不产生写入）；
    需要写操作时必须先让主理人确认当前工作区，或改用后端 API 直连指定工作区做破坏性用例。
17. **别叠加多种关窗方式**：`CloseMainWindow()`（≈用户点 X）是唯一等价路径，单次调用即可
    （实测 2s 干净退出）。而 `window.close()` 会**绕过 Tauri 生命周期**直接杀掉 WebView ——
    壳进程与侧车残留、8000 端口不释放，形成「半死」假象。若在同一次会话里把
    CloseMainWindow + taskkill + window.close() 叠加，会得到误导性的「关窗不退出」结论。
    测关窗退出：**每次都用全新实例 + 只调一次 `CloseMainWindow()`**。
18. **★ 改了后端就必须重建侧车，否则 GUI 里的新端点全是 404**（2026-09-15 实测踩到）
    GUI 嵌入的是**预构建的侧车 exe**（`desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`），
    平时 `cargo build --release` **不会**重建它，只会把它拷进 target。
    症状：前端新功能面板显示「加载失败，请重试」，实测对应端点返回 **404**
    （本次：回收站面板 → `/api/trash` 404，因侧车停留在 9/13 的构建）。

    **★ 且「版本不一致」横幅检测不到这种情况** —— 该横幅只比对前后端**版本号字符串**
    （两侧都是 `1.1.8-pre.1`），而侧车是**旧代码**。坑 2 覆盖不了本坑，必须靠下面的流程预防。

    日常 GUI 迭代的正确顺序（改了 `backend/**` 时）：
    ```powershell
    # PyInstaller 只在 Windows 侧可用（WSL 未装，且 WSL 只能构建 Linux 二进制）
    powershell -Command "Set-Location 'F:\Work\KE Project\knowledge-editor\backend'; & 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m PyInstaller --noconfirm knowledgeeditor-backend.spec"
    copy backend\dist\knowledgeeditor-backend.exe desktop\src-tauri\binaries\knowledgeeditor-backend-x86_64-pc-windows-msvc.exe
    cd desktop\src-tauri && cargo build --release   # 重新拷入 target
    ```
    **自检**：启动后 `curl http://127.0.0.1:8000/<新端点>` 应非 404（本次 = `/api/trash`）。
    另注：PyInstaller 每次构建在 `%TEMP%` 留 200–500MB `_MEI*`，顺手清理（坑 11）。
19. **★ 原生对话框在 Tauri 下全部不可靠 —— `window.confirm` 尤其阴险**（2026-09-15 主理人实测发现）
    三种原生对话框**行为各不相同**，必须分别对待：

    | API | Tauri 下的真实实现 | 后果 |
    |---|---|---|
    | `window.confirm` | **被替换为 async**：`async function(i){ return await invoke("plugin:dialog\|confirm",…) }` | **恒返回 Promise（truthy）** → `if (!window.confirm(…)) return` **判定永为假 → 确认被静默绕过** |
    | `window.alert` | 被替换 → `plugin:dialog\|message` | 该命令**已授权**，可用 |
    | `window.prompt` | 仍是 `[native code]`（WebView2 原生）| 输入值不返回 → 已改自绘（坑见 `PromptDialog.tsx` 注释）|

    **叠加第二重坑**：`capabilities/default.json` 的 `dialog:default` **实测只授予
    `allow-message` / `allow-save` / `allow-open` —— 不含 `allow-confirm` / `allow-ask`**。
    于是 `window.confirm` 还会返回 rejected Promise，**仍是 truthy**，照样被绕过。
    → **修 ACL 也没用**（返回类型仍是 Promise），唯一可靠解法是自绘。

    **症状极具欺骗性**：界面不报错、操作"看起来正常"，只是**破坏性操作不再询问**。
    2026-09-15 之前全仓 17 处确认（删文档/删文件夹/彻底删除/清空/**丢弃未保存修改**/
    切换工作区/导入覆盖…）**全部失效**，靠人工点界面**发现不了**，是主理人在 GUI 验收时察觉的。

    **规则**：
    - 一律使用 `components/common/PromptDialog` 的 `askConfirm` / `askPrompt`（自绘、Promise、可测）
    - **必须 `await`**（拿到 Promise 本身恒真）
    - 已加回归守卫 `components/common/no-native-dialog.test.ts`：源码中再用
      `window.confirm` / `window.prompt`，或把 `askConfirm` 的 Promise 当布尔用 → **测试直接失败**
    - **CDP 自查法**：`cdp-eval.py` 求值 `Object.prototype.toString.call(window.confirm('x'))`
      —— 得到 `[object Promise]` 即说明它已被 Tauri 替换（不是布尔）

## 9. 工作区迁移核对清单（★ 主理人迁移后必做）

**迁移前（已由交出方完成）**：版本 bump + 回归 + 预发布（v1.1.8-pre.1）已推送到 GitHub；
文档已更新；本交接文档已提交。**代码与历史的唯一权威 = GitHub 仓库**。

**迁移后（接收方按序核对）**：
1. **确认新路径**：向主理人问清新仓库路径（本文档中所有 `D:\KE Project\...` 均为旧路径）
2. **可丢弃/需重建**（可安全删除，迁移时可跳过以省时间）：
   - ~~`desktop/src-tauri/target/`（17GB Rust 构建缓存）~~ **【2026-09-14 更正】此条前提有误**：
     cargo target 由 `CARGO_TARGET_DIR` 重定向到 **`F:\Work\Dev\cargo-target`**（仓库外），
     仓库内 `desktop/src-tauri/target/` **本来就不存在**；该缓存 3.9G（996 deps）随迁移**已保留**，
     `cargo test` 仅 9.4s、`cargo build --release` 3.6 分钟，**无需 10 分钟重建**。
   - `frontend/node_modules/`（`npm ci` 重建，**WSL 侧**）、`desktop/node_modules/`（**Windows 侧**，见坑 14）
   - `frontend/dist-build/`（`npm run build` 重建）
   - `workspace/`（本地 vite 缓存，可再生）
3. **必须随仓库一起迁移**：`frontend/src`、`backend/app`、`desktop/src-tauri/src`、
   `desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（侧车；可重建）、
   `docs/`、`*.md`、`.git/`
4. **相对路径自检**：仓库内构建配置均为相对路径（`vite.config.ts` cacheDir/outDir、
   `tauri.conf.json` frontendDist/beforeBuildCommand）→ 整目录搬迁即可；**已核实无硬编码绝对路径**
   （唯一历史遗留：`scripts/start.ps1` 的使用提示文本，若仍指向 `D:\Agent\KnowledgeEditor` 可顺手改）
5. **仓库外的依赖（不随仓库迁移，需重建/注意）**：
   - `C:\ke-tmp\`：Agent 工具脚本。**【2026-09-14 已核对并修复】**：
     `README.md` 索引已重写（原来 CDP 写 9222、路径写 `D:\`、manifest 写「81 项」，全部过时）；
     `launch-release-cdp.ps1` / `run-gui-cdp.bat` 指向的 exe 路径已改到
     `F:\Work\Dev\cargo-target\release\`（原指向仓库内不存在的 target，**脚本曾完全不可用**）；
     新增 **`cdp-eval.py`**（通用 CDP 探针：自动找 9333 page 目标 + 求值 JS）。
     历史 `probe-*.py` / `verify-*.py` 等约 200 个一次性脚本**仍硬编码 9222，勿直接复用**。
   - `desktop/node_modules/`：**必须在 Windows 侧 `npm ci`**（坑 14），迁移后曾漏装 →
     NSIS 打包链路（§6 步骤 4）当时不可执行。**【2026-09-14 已补装】**，`tauri-cli 2.11.4` 可用。
   - `%APPDATA%\KnowledgeEditor\`：应用设置/数据（与仓库无关）
   - 测试夹具 `%USERPROFILE%\Documents\KE-TestWorkspace`（可重建：`mkfixtures.py`）
   - 主理人真实工作区 `%USERPROFILE%\Documents\KE Workspace`（**绝不写入**）
6. **环境自检（迁移后跑一遍）**：
   ```bash
   cd <new-repo>/frontend && npx tsc -b --noEmit && npx vitest run && npm run build
   cd ../backend && python -m pytest
   cd ../desktop/src-tauri && cargo test        # 先确认 GUI 已关闭
   ```
   期望：vitest **248**（247+1skip）/ pytest **175** / cargo **13** / tsc 0
7. **GUI 冒烟**：`launch-release-cdp.ps1` 起 exe → 打开文档 → 公式模态（Ctrl+M）→ 信息块 →
   新建文档（文件名保留大小写/空格）→ 关窗后无侧车残留。
   **注意分工（坑 16）**：GUI 默认打开主理人**真实工作区**，`KE_WORKSPACE` 不生效 →
   Agent 只做**只读**断言（打开文档/渲染/DOM/退出清理），**一切写入类步骤（新建/改名/删除）
   交主理人**，或改走隔离的后端 API（`KE_WORKSPACE` + 直连 8001）。
   程序化断言清单见 §5 表（2026-09-14 已实测通过）。
8. **发布链路自检**：`gh auth status` + `git remote -v` + 尝试 `gh release view v1.1.7`

## 10. 当前待办与下一步

**已完成**
- v1.1.7 正式版（公式编辑体验/信息块块级/启动进度 + 9 项实测修复）
- v1.1.8-pre.1（**文件名保留原标题**）
- 三域全量测试（文件管理/文件安全/编辑体验）：P0 全过，报告见 §7

**v1.1.8 候选（backlog 同步）**
| ID | 项 | 备注 |
|---|---|---|
| S-1 | 草稿恢复点扩展到编辑防抖（硬崩溃最多丢 3s）| 当前草稿仅在保存进行中登记 |
| S-2 | GFM 脚注 `[^1]` 是否支持 | 当前仅 ke 自有脚注格式 |
| S-3 | 附件保留原始文件名 | 当前时间戳重命名 |
| K3-I2 | rename/move 原子性 | P2 |
| — | 旧文档「批量对齐文件名与标题」工具 | 主理人未拍板 |

**已知设计边界（非遗漏）**
- 硬崩溃最多丢失一个 autosave 周期（默认 8s）的输入
- 拖拽/粘贴富文本的部分结构降级
- 非 UTF-8 文件走 422 明确提示（不做转码）

## 11. 协作约定（主理人偏好，务必遵守）

1. **GUI 验收制**：日常迭代 = 改代码 → `npm run build` → 起 GUI → 主理人验收；**不必每轮打安装包**
   （除非主理人明确要求发布）
2. **视觉判断归主理人**：不要让 Agent 读图代替；Agent 给程序化证据
3. **每报必修**：主理人的问题单逐条定位真因（不接受"复现不了"），修完报告根因 + 证据
4. **红线先问**：涉及 ke-* 格式、B 层标识、发布流程的改动，先给方案再动手
5. **汇报风格**：结论先行 + 表格 + 根因（主理人熟悉技术细节，不要过度简化）
6. **不擅自发布**：正式版发布需主理人确认（预发布可用 `-pre.N`）

---

**交接完成度**：代码/标签/预发布/文档/环境说明齐备。接收方若有疑问，先查本文档 §7 索引，
再查 GitHub Releases 与仓库历史（所有决策与根因都有提交信息留痕）。


---

## 附：迁移后实测记录（2026-09-14 · 由上一任 Agent 在 F 盘新路径执行）

主理人已将工作区迁移至 **`F:\Work\KE Project\knowledge-editor`**（原 `D:\KE Project\knowledge-editor` 已不存在）。
接收方无需重复以下步骤，仅作状态留痕：

| 核对项 | 结果 |
|---|---|
| 仓库完整性 | ✅ HEAD `f04d0f5`、标签至 `v1.1.8-pre.1`、工作树干净 |
| 迁移保留 | ✅ `frontend/src`、`backend/app`、`desktop/src-tauri/src`、`docs/`、`.git`、`binaries/`（侧车 45MB）|
| 迁移剔除（可再生）| `frontend/node_modules`、`desktop/src-tauri/target`（按 §9 建议跳过）|
| 依赖安装 | ✅ 从 WSL 执行 `npm install`（见坑 14；Windows 侧安装会导致 vitest 缺 linux 二进制）|
| 工具链验证 | ✅ tsc 0 错 · vitest **248**（247+1skip）· `npm run build` 成功（dist-build 11:00）|
| 修复的问题 | ① lockfile 被历史 bump 正则污染（picocolors 1.1.2 / @standard-schema/spec）→ 重建 lock + `overrides: { picocolors: 1.1.1 }`；② `desktop/package-lock.json` 根版本漏 bump（停留 1.1.4）→ 已同步；③ 新增 `scripts/bump-version.mjs` 防复发 |
| 工具链路径 | `C:\ke-tmp\*`（CDP 探针/发布脚本）已批量改为 F 盘路径 |

**遗留（2026-09-14 首轮）**：`desktop/src-tauri/target` 未重建（首次 `cargo build`/打包需 ~10 分钟）；
后端 pytest 与 cargo 验证见仓库最新提交信息。

---

## 附二：接管核对记录（2026-09-14 · 由下一任 Agent 执行）

**结论**：代码与工具链健康，四套件全绿；环境层发现 5 处「文档描述 ≠ 实际」并已全部修复。

| 核对项 | 期望（§9.6）| 实测 | 判定 |
|---|---|---|---|
| `tsc -b --noEmit` | 0 错 | 0 错 | ✅ |
| vitest | 248（247+1skip）| 247 passed / 1 skipped | ✅ |
| pytest | 175 | 175 passed / 2 skipped | ✅ |
| cargo test | 13 | 13 passed（9.4s，依赖缓存命中）| ✅ |
| `npm run build` | 成功 | ✓ 5.38s，产物内嵌版本仅 `1.1.8-pre.1`，无旧版残留 | ✅ |
| 9 处版本源 | 一致 | 9/9 = `1.1.8-pre.1` | ✅ |
| `gh auth` / Releases | 可查 | Asheep233 已认证；v1.1.8-pre.1 预发布在线 | ✅ |
| git 同步 | — | HEAD `08e5188` 曾**未推送**（master ahead 1）→ **已推送**，远端已一致 | ✅ 已修 |
| release GUI 构建 | — | `cargo build --release` 3m37s → exe 15MB + 侧车 exe | ✅ |
| GUI 冒烟（只读）| — | CDP 9333 目标为 AstraNota（非 Edge）；启动 1.64s；版本横幅一致；文档打开 + 编辑器挂载 + 10 KaTeX 节点；**关窗 2s 退出 / 0 孤儿 / 8000 释放**（S1 修复复验通过）| ✅ |
| C:\ke-tmp 工具链 | — | README/launcher 多处过时 → 已修（见 §9.5）；新增 `cdp-eval.py` | ✅ 已修 |

**本次修正的 5 处偏差**（详见正文对应条目）：
1. §9.2「target 17GB 需重建」→ 实为 `CARGO_TARGET_DIR` 重定向到仓库外，缓存**已保留**（坑 15）
2. §5/§9.7 GUI 启动脚本**指向不存在的路径**（曾完全不可用）→ 已修 + 补程序化断言表
3. `desktop/node_modules` 为空 → tauri CLI 缺失，打包链路不可执行 → **已在 Windows 侧补装**
4. `master` 领先远端 1 个提交 → 已推送（GitHub 恢复为唯一权威）
5. `C:\ke-tmp\README.md` CDP 9222 / `D:\` 路径 / 「81 项」manifest 全部过时 → 已重写（实为 **84 项**）

**新增重要发现（写数据安全）**：`KE_WORKSPACE` **不能隔离 GUI**——前端会恢复上次工作区覆盖它，
实测带 `KE_WORKSPACE=KE-TestWorkspace` 启动后，界面仍指向主理人真实工作区
`...\Documents\KE Workspace`（`/api/health` 却回报测试工作区，**二者不一致，极易误判**）。
本次核对全程只读，已确认真实工作区**无任何用户内容写入**（仅 `.knowledgeeditor/index.db-shm`
正常索引触及）。Agent 规则见坑 16。

**未做（按约定归属主理人）**：视觉/手感类验收（公式模态外观、信息块手感、拖拽/粘贴、快捷键矩阵），
以及**新建文档「文件名保留大小写/空格」的端到端 GUI 实测**（属写入类，且 GUI 无隔离，故未执行；
该策略在 pytest 175 / vitest 248 中已有格式层覆盖）。
