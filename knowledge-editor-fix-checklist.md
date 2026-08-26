# KnowledgeEditor v1.0.0 修复任务清单（Agent 执行版）

> 整合自 9 份独立审计报告，经去重与交叉验证。共 **P0 × 4、P1 × 17、P2 × 20、P3 × 21、P4 × 13**。
> 每条缺陷含：**文件路径 → 根因 → 修复动作 → 验收标准（回归测试断言）**。按编号顺序执行；每修完一项，必须补一条能"锁死"它的回归测试，否则视为未完成。

---

## 目录
- [P0 阻断级（4）](#p0)
- [P1 高优先级（17）](#p1)
- [P2 中等（20）](#p2)
- [P3 低优先（21）](#p3)
- [P4 整理项（13）](#p4)
- [执行顺序建议](#order)
- [回归测试清单](#tests)

---

<a id="p0"></a>
## 一、P0 阻断级缺陷（发布前必须修复，4 项）

### P0-1 保存清空 frontmatter
- **文件**：`frontend/src/editor/ke.ts:34-37`（`withFrontmatter`）、`frontend/src/components/layout/EditorArea.tsx:113,168`、`backend/app/routers/documents.py:227-251`
- **根因**：`withFrontmatter` 先 `stripFrontmatter` 剥离全部字段，再只写回 `ke_version`；后端 PUT 逐字节覆盖，无合并。属性面板（`PUT /meta`）写入的 title/tags 与正文保存是两条互不知情的写者。
- **修复动作**：
  1. `withFrontmatter` 改为合并语义：保留 `stripFrontmatter` 解析出的全部原字段，仅更新 `ke_version`；
  2. 或后端 `update_article` 落盘前 `parse_frontmatter(旧文件)` 后合并非 `ke_version` 键。
- **验收标准**：构造含 `title/tags/自定义键` 的文档 → 走真实编辑器 `加载→getMarkdown→withFrontmatter→PUT` → 重开断言所有 frontmatter 键逐字节保留。当前实现下该测试必红。

### P0-2 防抖窗口内输入静默丢失
- **文件**：`frontend/src/components/layout/EditorArea.tsx:139-144`（切换只 `clearTimeout` 不 flush）、`frontend/src/App.tsx:200-211,351-362,388-401`（openArticle/handleNewArticle/handleFsMutation 无 `hasUnsaved` 检查）、全仓无 `beforeunload`/`onCloseRequested`
- **根因**：恢复点仅在"保存动作发生时"登记；防抖（默认 3s，可调至 10min）窗口内输入从未落盘，也无草稿。
- **修复动作**：
  1. 所有替换 article 的入口统一走 `requestOpenArticle(id)`：当 `saveState ∈ {dirty,saving,error}` 时先 `flushPendingSave()` 或弹 confirm；
  2. 覆盖新建、删除、重命名、移动、恢复草稿、切换 workspace 六类入口；
  3. Tauri 侧 `onCloseRequested` emit 事件通知前端 flush 后再关窗。
- **验收标准**：组件测试（fake timers）断言"输入 → 3s 内切换/关窗 → 内容已被保存或被确认拦截，不出现静默丢失"。

### P0-3 `DELETE /api/fs/dir?path=Articles/..` 整库删除
- **文件**：`backend/app/services/markdown_io.py:192-198`（`safe_rel_path` 显式放行 `candidate == root`）、`backend/app/routers/fs.py:62-70,127-144`（`_guard_rel`/`delete_dir`）
- **根因**：`rel = path.strip("/")` 后为 `"."`/`""` 时不在顶层目录白名单；`_guard_rel` 对根取 `top=""` 跳过保护目录检查 → 进入 `rglob("*")` 递归删除，最后 `rmdir` 连根目录一并删除。同族问题：`rename_dir` 传 `path=.` 会把 workspace 根改到父目录。
- **修复动作**：`_guard_rel` 与 `delete_dir`/`rename_dir` 入口显式拒绝 `full == root`；`delete_dir` 增加"目标必须在 Articles/Modules/Attachments 之下"的父级断言。
- **验收标准**：`DELETE/PUT /api/fs/dir` 传 `"."`、`""`、`"/"`、`Articles/..`、`Modules/..` 一律 4xx，且 workspace 文件数不变。

### P0-4 切换文档后 Ctrl+Z 跨文档串内容
- **文件**：`frontend/src/editor/index.ts:149-151`（`setKeContent` → `setContent` 未设 `addToHistory:false`）、全仓无 `clearHistory`
- **根因**：Tiptap `setContent` 默认进入 undo 栈；加载 B 后 undo 把 A 的内容灌进 B 并随 autosave 落盘。
- **修复动作**：`setKeContent` 内 `setContent` 后立即 `editor.commands.clearHistory()`，或传第三参 `{ addToHistory: false }`。
- **验收标准**：测试"加载 A → 切 B → `can().undo() === false`"。

---

<a id="p1"></a>
## 二、P1 高优先级缺陷（17 项）

### P1-1 打开文档即触发保存
- **文件**：`EditorArea.tsx:142`（加载 effect 调 `setKeContent`）
- **根因**：`setContent` 默认 `emitUpdate=true`，触发 `onUpdate → handleUpdate → 标 dirty → 3s 后自动保存`。
- **修复**：加载用 `setContent(md, { emitUpdate: false })`，或加 loading guard 抑制程序性载入的 update。
- **验收**：挂载 EditorArea → `setKeContent` → 推进 fake timer 3s → 断言无 PUT 发出、saveState 为 idle。

### P1-2 普通 HTML 注释/HTML 块被静默删除
- **文件**：`frontend/src/editor/tokenizers.ts:262-289`、`GenericFallbackExtension` 仅覆盖 ke-* 命名空间
- **根因**：无普通 HTML 注释/HTML block 的保真节点，marked 归为 html token 后 DOMParser 丢弃。
- **修复**：为普通 `<!-- -->` 注释与 HTML block 注册保真节点（原样保留 raw），或校验失败时整块降级 fallback。
- **验收**：`<!-- 普通注释 -->`、`<div class="x">内容</div>` round-trip 后原文保留（断言注释与标签本身，而非仅两侧段落）。

### P1-3 已知 kind 的非法 JSON ke-* 标记被丢弃
- **文件**：`tokenizers.ts:53-83,262-276`（`JSON.parse` 失败 `return undefined`；负向前瞻排除已知 kind）
- **根因**：负向前瞻把"已知 kind + 损坏 JSON"挡在 fallback 之外。
- **修复**：放开负向前瞻，已知 kind + 损坏 JSON 也走 fallback 原文保留。
- **验收**：`<!-- ke-attach: {bad json} -->` round-trip 后标记整体保留。

### P1-4 表格保真不足（转义管道符/富文本/合并单元格）
- **文件**：`TableMarkdownExtension.ts:15-63`（`cellText` 只取纯文本、不输出 colspan/rowspan）、`tokenizers.ts:183-217`（`parseTableRow` 朴素 `split('|')`）
- **根因**：序列化写 `\|` 但解析不识别转义；单元格 inline marks 退化；合并单元格无持久化字段。
- **修复**：解析兼容 `\|`；单元格递归序列化 inline；若 v1 不支持合并则禁用 UI 合并并提示。
- **验收**：`| a | b \| c |` round-trip 列数不变；单元格内加粗/链接保留；合并语义要么保留要么禁用。

### P1-5 ke-module 混合字段丢失
- **文件**：`frontend/src/editor/extensions/ModuleExtension.ts:102-116`（`if (a.source) return 仅含 source`）
- **根因**：`renderMarkdown` 遇到 source 就独占返回，丢弃 id/name/version/params。
- **修复**：render 时合并——source 追加到已有字段对象而非独占分支。
- **验收**：`{kind,id,name,version,params,source}` round-trip 后字段全保留。

### P1-6 autosave 与手动保存并发乱序覆盖
- **文件**：`EditorArea.tsx:100-123,159-179`（`saveNow` 只清定时器不取消在途请求）、后端 `documents.py:227-251`（无版本/etag 校验）
- **根因**：两条保存路径并发 PUT，完成顺序不定；两个成功响应都会 `clearRecoveryPoint`。
- **修复**：前端 per-doc single-flight 保存队列（在途时合并/排队，完成后若内容更新再补一次）；后端可选加 `content_hash`/`If-Match` 乐观锁。
- **验收**：mock 两个 PUT 延迟乱序返回，断言磁盘最终为最新内容、恢复点不被旧响应清除。

### P1-7 保存/打开响应无请求序号，跨文档/跨工作区串写
- **文件**：`frontend/src/App.tsx:200-211,251-254,298-306`（`handleSaved` 无条件 `setArticle`；openArticle 无 AbortController）、后端 `workspace.py:68-84`（全局 app.state）
- **根因**：旧响应无条件覆盖 React 状态；保存请求不绑定 workspace 标识。
- **修复**：`handleSaved` 校验 `doc.id === 当前 article.id`；openArticle 加请求序号/AbortController；保存请求携带 workspace 标识，后端不一致返回 409。
- **验收**：快速点击 A→B 断言最终显示 B；切换 workspace 时在途保存不写进新工作区。

### P1-8 外部修改检测 stale closure 失效
- **文件**：`frontend/src/App.tsx:163-198`（轮询 effect 依赖 `[workspace.open,root]`，闭包捕获 article=null 的旧 `handleFsEvent`）
- **根因**：effect 不随 article 重跑，`ev.rel === cur` 永远 false，弹窗永不出现。
- **修复**：把 `article?.id` 移入 ref 供 `handleFsEvent` 读取，或加入 effect 依赖。
- **验收**：打开文档后 mock `/api/fs/events` 返回 modified 事件，断言外部修改弹窗出现。

### P1-9 SQLite 单连接跨线程无锁
- **文件**：`backend/app/store/db.py:82-107`（`check_same_thread=False` 无 mutex）、FastAPI 线程池 + fs_watch 线程共用同一 Connection
- **根因**：多线程交错 `execute/commit` 产生 `Recursive use of cursors`/事务交错。
- **修复**：`IndexStore` 加 `threading.RLock` 包装 execute/commit/executemany；或每请求短事务/连接池。
- **验收**：`ThreadPoolExecutor` 20 线程混合 save/search/tree/update 30s，断言零异常且最终索引与文件一致。

### P1-10 附件/文章端点无路径白名单
- **文件**：`attachments.py:131-153,192-198`、`documents.py:60-67`（`_article_path` 只做根目录防穿越）
- **根因**：只校验"在 workspace 内"，不校验业务目录，可读写删 `.knowledgeeditor/settings.json`、`index.db`、任意 .md。
- **修复**：article 端点限定 `Articles/`+`Modules/` 的 `.md`；attachment 端点限定 `Attachments/`；history/draft 限定各自目录；永久拒绝 `.knowledgeeditor` 与 `Drafts`。
- **验收**：负向矩阵——`GET/DELETE /api/attachments/Articles/x.md`、`PUT /api/articles/.knowledgeeditor/index.db` 等必须 4xx。

### P1-11 删除文档无回收站/无快照；已删文档快照 restore 404
- **文件**：`documents.py:254-261`（delete 不调 `_maybe_snapshot`）、`history.py:50-60`（restore 要求 `full.is_file()`）
- **根因**：删除无兜底；restore 对已删文档直接 404，但快照文件仍保留。
- **修复**：删除前强制 `_maybe_snapshot` 或移入 trash；`restore` 允许对已删文档重建（父目录 `mkdir` 已具备）。
- **验收**：写 v1→v2 产生快照 → DELETE → restore 断言文件重建且内容正确。

### P1-12 多实例无互斥 + stale PID 盲杀
- **文件**：`desktop/src-tauri/src/sidecar.rs:116-129`（cleanup_stale 只查 PID 存活）、`scripts/start.ps1:98-119`、`stop.ps1:29-59`；无 single-instance 插件
- **根因**：双开互杀后端；PID 复用后强杀无关进程（`taskkill /T /F`）。
- **修复**：接入 `tauri-plugin-single-instance`；杀进程前校验命令行/镜像名含 `knowledgeeditor-backend`，不匹配只清记录不杀。
- **验收**：双实例测试只聚焦第一个窗口；陈旧 runtime 指向无关进程时不杀。

### P1-13 首启前端 4s vs 后端 30s 握手
- **文件**：`frontend/src/main.tsx:25-45`（10×400ms 后放弃不重试）、`sidecar.rs:153-183`（30s 超时）、`workspace.py:68-84`（同步全量 rebuild）
- **根因**：前端放弃注入后回退相对路径且不再恢复。
- **修复**：前端等待对齐 30s，或监听 `ke:runtime-ready` 事件驱动注入；启动 rebuild 改后台/增量。
- **验收**：mock 后端 5-15s 才就绪，断言前端最终仍拿到 API 基址并显示连接正常。

### P1-14 关窗无 flush 握手 + recovery 寄生 index.db
- **文件**：`desktop/src-tauri/src/lib.rs:24-32,menu.rs:129-139`（CloseRequested 直接清理）、`backend/app/store/db.py:361-389`（recovery 表）、`workspace.py:50-65`（损坏删库重建）
- **根因**：关窗丢弃未保存输入；索引损坏自愈后 recovery 记录消失，草稿成孤儿。
- **修复**：Rust emit close-requested，前端 flush/登记 recovery 后再退出；recovery 登记改为"目录扫描优先、DB 兜底"（启动枚举 `Drafts/recovery/*.draft.md`）。
- **验收**：写 recovery → 删 index.db → 重启，断言草稿仍可见可恢复。

### P1-15 SVG/HTML 附件 inline 返回 + shell 权限过宽 + CSP null
- **文件**：`attachments.py:192-198`（FileResponse 按扩展名）、`capabilities/default.json:8-9`（shell:allow-spawn/execute）、`tauri.conf.json:24-26`（csp:null）
- **根因**：html/svg 以 `text/html`/`image/svg+xml` inline 返回，同源可调全部 API；叠加 shell 权限可本地 RCE。
- **修复**：非图片/视频附件强制 `Content-Disposition: attachment`；移除前端 shell 权限；设置最小 CSP。
- **验收**：上传/导入 `.html`/`.svg` 后断言响应头 `Content-Disposition=attachment` 且非内联 MIME。

### P1-16 CI 三重失效 + 发布不可复现
- **文件**：`.github/workflows/ci.yml:5-6`（branches:[main] 但默认 master）、`ke-vite.mjs:19-27`（硬编码 win32-x64 esbuild.exe）、`test_delete_safety.py`（Windows 路径语义无 skipif）
- **根因**：push 不触发 CI、Linux build 必 exit 1、pytest 3 项必败；12.6MB 预编译 exe 入库无校验。
- **修复**：branches 改 master；ke-vite 按 `process.platform` 选 esbuild 包；Windows 语义用例加 skipif；加 Windows runner 的 cargo/test/tauri build job；sidecar 从源码构建并生成 hash manifest。
- **验收**：ubuntu + windows runner 全绿；构建产物 version/hash 与源码一致。

### P1-17 目录 symlink/Junction 递归删除越界到 workspace 外
- **文件**：`fs.py:136-143`、`indexer.py:45-82`、`documents.py:116-126`、`fs_watch.py:79-93`（所有 `rglob` 枚举均无 symlink 检查）
- **根因**：Python≤3.12 的 `pathlib.rglob` 默认跟随目录 symlink；workspace 内含指向外部的 junction 时，`delete_dir` 递归 unlink 的是链接目标的真实文件。
- **修复**：递归遍历统一跳过 symlink 目录（或 `os.path.islink` 判断）；删除前 resolve 校验目标仍在 workspace 内。
- **验收**：构造指向外部的 junction → delete_dir → 断言外部文件未被删除。

---

<a id="p2"></a>
## 三、P2 中等缺陷（20 项）

| # | 缺陷 | 文件 | 修复 |
|---|------|------|------|
| 1 | frontmatter 非完整 YAML（CRLF/BOM/嵌套对象被改写） | `markdown_io.py:51-118`、`ke.ts:20-36` | 用成熟 YAML parser 并保留 raw；BOM/CRLF 前端剥离后解析 |
| 2 | 非 UTF-8 .md 打开 500 | `documents.py:157`、`indexer.py:65-68` | GET 捕获 `UnicodeDecodeError` 返回 422 + 提示 |
| 3 | 历史快照同毫秒覆盖 + retention 死参数 | `history_store.py:20-30` | 快照名加单调序号；retention 接线或删除 |
| 4 | 快照失败阻塞主保存 | `documents.py:89-106`（`_maybe_snapshot` 无 try/except） | 快照失败记日志继续保存 |
| 5 | 附件/导入无总量上限、zip 整包入内存、file_size 可伪造 | `attachments.py:156-189`、`import_export.py:225-242,373-381` | 上传加配额；解压按实际字节；导入流式化 |
| 6 | 重建索引非事务 | `indexer.py:90-107`、`db.py:258-263` | 临时库重建后原子替换，或单事务+互斥 |
| 7 | 三个设置项死开关 | `settings.rs`/`settings.ts`/`SettingsPanel.tsx` | 接线或从 UI 移除 |
| 8 | 错误静默吞掉（失败显示为空/旧/已保存） | `App.tsx:206-208`、`LeftSidebar.tsx:66-109`、`EditorArea.tsx:223-231` | 统一 ApiError，区分 loading/empty/error/stale |
| 9 | WorkspacePicker 裸 fetch 绕过 apiBase | `WorkspacePicker.tsx:92-105` | 改用 client.ts 封装 |
| 10 | 桌面 release 零日志 | `sidecar.rs:295-305` | 输出落盘 `%APPDATA%\logs\backend.log` |
| 11 | atomic write 无 fsync | `markdown_io.py:169-185` | 写后 `flush+fsync` 再 replace |
| 12 | settings/app_config 并发写固定 tmp | `settings.rs:117-127`、`app_config.py:67-73` | 随机 tmp 名 + 加锁 |
| 13 | 外部改盘不自动更新索引 | `fs_watch.py` 只产事件不 update_file | watcher 增量 reindex 或提示重建 |
| 14 | 草稿同名冲突（a.md vs a.markdown） | `drafts.py:36-46`（`_draft_rel` 只取 stem） | 草稿名含完整相对路径哈希或扩展名 |
| 15 | fs move/delete_dir 绕过附件引用保护 | `fs.py:127-145,210-230` | 命中 Attachments 时复用引用检查返回 409 |
| 16 | 本地 API 无 token/Host 校验 | `main.py:80-103` | 加 TrustedHostMiddleware 或随机 token |
| 17 | 脚注条目文本含 `} -->` 整条脚注丢失 | `tokenizers.ts:240-249`（非贪婪正则） | 复用 `matchBalancedJson` 匹配平衡括号 |
| 18 | Windows 大小写绕过保护目录（小写 drafts/ 删快照） | `fs.py:62-70`（保护名单大小写敏感） | 保护名单比较改大小写不敏感 |
| 19 | 端口 TOCTOU + 崩溃重启不重探测端口 + health 超时只 kill bootloader | `sidecar.rs:72-80,265-283,321-327` | 健康失败整树杀；重启重新探测端口 |
| 20 | 附件上传后无内部写入标记 | `attachments.py`（上传后未 `mark_internal`） | 上传完成写 mark_internal 抑制自身 watcher 事件 |

---

<a id="p3"></a>
## 四、P3 低优先缺陷（21 项）

| # | 缺陷 | 文件 / 要点 |
|---|------|------|
| 1 | Windows 保留名（CON/NUL/COM1）、尾点/空格、超长路径 → 500 | `markdown_io.py:16,27-36`（slugify） |
| 2 | 解析性能超线性（256KB≈10.5s、512KB≈31s） | H 实测；`editor/index.ts` 解析链路，建议 profiler 定位 + 性能门槛 |
| 3 | 每次启动/切库全量重建索引 | `workspace.py:39-65`、`indexer.py`，改增量校验 |
| 4 | watcher 每秒全树 rglob+stat | `fs_watch.py:79-93`，改 ReadDirectoryChangesW |
| 5 | 已知 kind 未知属性被白名单丢弃 | `ke.ts:49-58`（KE_FIELD_ORDER），违反 spec 承诺 |
| 6 | 搜索特殊字符/FTS 语法错误静默空结果；2 字中文 LIKE 全表扫描 | `db.py:280-297,311-312` |
| 7 | 外部删除当前文档只刷新树，保存报 404 | `App.tsx:182-198`，补 deleted 事件处理当前文档 |
| 8 | 恢复检测失败后会话不再重试；"稍后处理"无再入口 | `App.tsx:150-161` |
| 9 | workspace_create 传文件路径 → 500 | `workspace.py:128-131` |
| 10 | rglob 跟随 junction 索引外部内容 | `indexer.py:45`、`fs_watch.py:85` 等，resolve 前判断 symlink |
| 11 | 恢复历史后属性面板显示"—"（响应缺元信息） | `history.py:78-86`、`EditorArea.tsx:282-283` |
| 12 | frontmatter title 死参数 | `documents.py:28-30` |
| 13 | 侧车崩溃重启固定旧端口、health 不校验进程身份 | `sidecar.rs:288-328` |
| 14 | 导入引用改写朴素 str.replace 误改 URL/代码块 | `import_export.py:267-277`，从节点 attrs 收集 refs |
| 15 | 每次击键 App 级重渲染 + buildFileTree 未 memo | `App.tsx:564`、`LeftSidebar.tsx:355-357` |
| 16 | 插入脚注注入零宽空格 U+200B 写进文件 | `FootnoteExtension.ts:156,202` |
| 17 | 前端测试 include 排除 `.test.tsx` | `vite.config.ts:36-39` 只匹配 `.test.ts` |
| 18 | 后端 fixture session 共享顺序耦合 | `conftest.py:15-39`，改 function fixture |
| 19 | OpenAPI snapshot 只锁路径不锁 schema | `test_openapi_snapshot.py:52-79` |
| 20 | 多文件拖拽固定 pos / 上传异步返回插入错误文档 | `EditorArea.tsx`/toolbar 上传竞态 |
| 21 | 无 updater / 最近工作区菜单仅启动构建 | `tauri.conf.json`、`menu.rs:29-30` |

---

<a id="p4"></a>
## 五、P4 整理项（13 项）

| # | 缺陷 | 文件 / 要点 |
|---|------|------|
| 1 | 无 id 节点每次序列化生成新随机 id 不回写 attrs | Attachment/Video/Footnote/Note/Module renderMarkdown |
| 2 | 深色主题仅 color-scheme 兜底 | 项目已自认 |
| 3 | repro-main.tsx 调试残留（`window.__repro`） | 移出 src |
| 4 | 错误信息回显本地绝对路径 | `attachments.py:151` |
| 5 | requirements.txt 范围约束无哈希锁定 | `requirements.txt`，改 pip-compile |
| 6 | 安装包未签名 | 已披露，加 Authenticode |
| 7 | 前端主包 1.95MB 无代码分割 | mathlive/katex 拆 chunk |
| 8 | start.bat GBK 编码乱码 | `scripts/start.bat` |
| 9 | modules 列表只枚举 *.md 不含 .markdown | `modules.py:22` |
| 10 | spec 与 document-format 文档自相矛盾 | 合并为单一权威文档 |
| 11 | `~下标~` 被规范化为删除线 | 文档说明或对齐 GFM 预期 |
| 12 | ke-module source 序列化缺 kind 字段 | `ModuleExtension.ts`，与 P1-5 同源 |
| 13 | 大纲 Tab 是占位符 | `RightPanel.tsx:156-162`，实现或移除声明 |

---

<a id="order"></a>
## 六、执行顺序建议（含依赖关系）

**阶段一（阻断，发布 v1.0.1 前）**：P0-1 → P0-2 → P0-3 → P0-4 → P1-1（打开即保存是 P0-1 的放大机制，一并修）→ P1-6 → P1-10 → P1-11。
> 说明：P0-1 与 P1-1 同源，应一起改；P1-6/P1-10/P1-11 是保存链路与文件边界，属于"数据不丢"的核心闭环。

**阶段二（核心加固）**：P1-2 → P1-3 → P1-4 → P1-5（Markdown 保真一组）→ P1-7 → P1-8 → P1-9（并发状态机一组）→ P1-12 → P1-13 → P1-14（桌面生命周期一组）→ P1-15 → P1-16 → P1-17（安全与发布一组）。

**阶段三（可靠性与体验）**：P2 全部（按编号），重点先做 P2-1/P2-3/P2-4/P2-17（仍属数据保真）。

**阶段四（收尾）**：P3、P4 按编号，性能项（P3-2/3/4/15）可单独排期。

---

<a id="tests"></a>
## 七、回归测试清单（每个缺陷必须配套）

| 优先级 | 测试 | 锁死缺陷 |
|--------|------|----------|
| T0 | frontmatter 保全端到端（meta PUT → body PUT → 重开断言字段完整） | P0-1 |
| T0 | 文档切换/关闭未保存状态机（dirty 时 flush 或 confirm） | P0-2 |
| T0 | delete_dir/rename_dir 根路径等价输入（".","","/","Articles/.."）4xx | P0-3 |
| T0 | setKeContent 后 `can().undo()===false` | P0-4 |
| T0 | 加载不触发保存（fake timer 3s 无 PUT） | P1-1 |
| T0 | API 路径白名单负向矩阵（articles/attachments/history/draft 越区 4xx） | P1-10 |
| T1 | 并发保存乱序（mock 双 PUT 延迟，断言 latest-wins） | P1-6 |
| T1 | 外部修改冲突（外部写盘 → 弹窗出现） | P1-8 |
| T1 | 异常 Markdown 语料库（HTML 注释/块、非法 JSON、表格 \|、脚注 }-->、BOM/CRLF） | P1-2/3/4 + P2-17 |
| T1 | 恢复点与索引损坏组合（写 recovery → 删 index.db → 草稿仍可见） | P1-14 |
| T1 | sidecar 生命周期（双实例、stale PID、慢启动、未 ready 关闭） | P1-12/13 |
| T2 | Windows 路径专项（中文/空格/保留名/尾点/长路径） | P3-1 |
| T2 | 规模基准（1k/10k 文档、1MB+ Markdown 延迟） | P3-2/3 |
| T2 | Python/sidecar 可复现构建（Windows CI + hash manifest） | P1-16 |

> **最高价值单测**：`编辑→保存→重开→字节比较` 的端到端数据完整性测试，能一次抓住 P0-1、P0-2、P1-1、P1-2 等多类缺陷，建议最先落地。
