# Agent 交接文档 · Knowledge Editor / AstraNota

> 交接时间：2026-09-08 · 交出方：上一任主 Agent · 接收方：下一任 Agent
> 当前版本：**v1.1.8-pre.1**（文件名保留原标题预发布）· 分支 master
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
| 标签 | `v1.0.0` … `v1.1.7`、`v1.1.8-pre.1`（预发布）|
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
# 启动脚本（已就绪）：设置 WebView2 调试端口 9333（9222 会被 Edge 抢占！）
powershell -File C:\ke-tmp\launch-release-cdp.ps1
# 连接：http://127.0.0.1:9333/json  → 找 type=page 的目标（url 含 tauri.localhost）
```
- CDP 探针脚本示例在 `C:\ke-tmp\*.py`（python + websocket-client；`Runtime.evaluate` 驱动 DOM）
- **人工验收归主理人**（视觉/手感）；Agent 只做程序化断言——不要试图用截图代替主理人判断

## 6. 发布流程（照抄，勿即兴）

```powershell
# 0) 版本 bump：9 处源（见 §4）。注意正则用 1\.1\.\d[^"]*（写死 1.1.7 会漏）
# 1) 全量回归（§5 四条命令）
# 2) 前端构建（必须在 bump 之后！）并核对产物版本：
cd frontend && npm run build
grep -o '1\.1\.\d[^"]*' dist-build/assets/index-*.js | sort -u    # 应只出现新版本
# 3) 侧车重建 + 拷入 binaries
cd backend && python -m PyInstaller --noconfirm knowledgeeditor-backend.spec
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

## 9. 工作区迁移核对清单（★ 主理人迁移后必做）

**迁移前（已由交出方完成）**：版本 bump + 回归 + 预发布（v1.1.8-pre.1）已推送到 GitHub；
文档已更新；本交接文档已提交。**代码与历史的唯一权威 = GitHub 仓库**。

**迁移后（接收方按序核对）**：
1. **确认新路径**：向主理人问清新仓库路径（本文档中所有 `D:\KE Project\...` 均为旧路径）
2. **可丢弃/需重建**（可安全删除，迁移时可跳过以省时间）：
   - `desktop/src-tauri/target/`（17GB Rust 构建缓存；重建 ~10 分钟）
   - `frontend/node_modules/`、`desktop/node_modules/`（`npm ci` 重建）
   - `frontend/dist-build/`（`npm run build` 重建）
   - `workspace/`（本地 vite 缓存，可再生）
3. **必须随仓库一起迁移**：`frontend/src`、`backend/app`、`desktop/src-tauri/src`、
   `desktop/src-tauri/binaries/knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（侧车；可重建）、
   `docs/`、`*.md`、`.git/`
4. **相对路径自检**：仓库内构建配置均为相对路径（`vite.config.ts` cacheDir/outDir、
   `tauri.conf.json` frontendDist/beforeBuildCommand）→ 整目录搬迁即可；**已核实无硬编码绝对路径**
   （唯一历史遗留：`scripts/start.ps1` 的使用提示文本，若仍指向 `D:\Agent\KnowledgeEditor` 可顺手改）
5. **仓库外的依赖（不随仓库迁移，需重建/注意）**：
   - `C:\ke-tmp\`：Agent 工具脚本（CDP 探针 `launch-release-cdp.ps1`、`gen-manifest.py`、
     `mkfixtures.py`、各验证脚本）。**建议随迁移一并复制或在新盘重建**（交接方已尽量把关键脚本
     内容写入本文档 §5/§6）
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
7. **GUI 冒烟**：启动开发版 exe（§5 脚本，注意改脚本里的 exe 路径为新路径）→ 打开文档 →
   公式模态（Ctrl+M）→ 信息块 → 新建文档（文件名保留大小写/空格）→ 关窗后无侧车残留
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
