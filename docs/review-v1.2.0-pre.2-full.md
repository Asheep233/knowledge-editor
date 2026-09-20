# AstraNota v1.2.0-pre.2 发布前全面审查报告

> 生成：2026-09-20 | 审查人：高级 coding/review Agent（三路子 agent + 本人逐行复核 + 实证复现）
> 审查对象：v1.2.0-pre.2 完整产品状态（非增量）
> 用途：交付修复 agent。每个问题含：位置 / 证据 / 触发条件 / 修复规格 / 验收测试要求。
> 结论：**NO-GO（不可晋升正式版）**，5 个 BLOCKER 修复 + 独立验证后方可 bump 1.2.0。

---

## 0. 审查执行摘要

| 项 | 结果 |
|---|---|
| 版本一致性（9 处版本源） | ✅ 全部 `1.2.0-pre.2` |
| pytest（实测） | ✅ 630 passed + 2 skipped |
| tsc -b --noEmit（实测） | ✅ 0 错误 |
| vitest（实测 3 次全量） | ⚠️ 达标但不稳：第 1 次 1 failed（cursor.verify）+ unhandled error；第 2、3 次 56 files / 1095 passed + 1 skipped |
| cargo test | ❌ 本环境无法验证（Linux 缺 glib/webkit 系统库）；CI desktop job `continue-on-error`，Rust 侧为弱验证 |
| npm audit | ✅ 0 漏洞 |
| pip 依赖 | ✅ 最小集且精确锁定 |
| 硬编码密钥扫描 | ✅ 无 |
| capabilities 权限面 | ✅ 最小（core:default + dialog:default） |

审查方法声明：所有 BLOCKER 均经**逐行源码阅读 + 可执行实证复现**双重确认（非推测）；后端/前端/桌面壳三路并行深审，重点投入数据丢失、数据损坏、路径穿越、导出静默失败四类红线区。

---

## 1. BLOCKER（5 项，修复前不得发布正式版）

### B1. 后端保存合并路径每次都在损坏 BOM/CRLF 文档的字节格式

- **位置**：[backend/app/services/markdown_io.py](file:///workspace/backend/app/services/markdown_io.py) `merge_frontmatter`（L307-318 assembled 分支）、`set_meta`（L194-216）、根因 `split_frontmatter_block`（L250-251 剥 BOM 不还原）
- **触发链**：前端 WYSIWYG 保存 PUT 载荷 frontmatter 只含 `ke_version`（[EditorArea.tsx:361](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L361)）→ [documents.py:276](file:///workspace/backend/app/routers/documents.py#L276) `merge_frontmatter(old_raw, body.content)` → 磁盘文档含 title（API 创建即带）→ `missing_lines` 恒非空 → assembled 分支 `splitlines()` + `"\n".join()` 重建 frontmatter 块。
- **实证**（已在沙箱用真实后端函数复现）：

```text
old = '﻿---\r\ntitle: 我的文档\r\n---\r\n\r\n正文第一行\r\n'
new = '﻿---\nke_version: 1\n---\n\n正文第一行（编辑后）\r\n'
merge_frontmatter(old, new)
→ BOM 保留: False
→ 输出: '---\nke_version: 1\ntitle: 我的文档\n---\n\n正文第一行（编辑后）\r\n'
  （BOM 丢失；frontmatter 块 CRLF→LF；正文保持 CRLF → 混合换行文件）
```

- **影响**：带 BOM 的文档首次 WYSIWYG 保存后 **BOM 永久丢失**；CRLF 文档变为混合换行且每次保存重演。前端回包后 `captureTraits(docId, saved.content)`（EditorArea.tsx:396）把 traits 同步为 `bom:false`，错误自洽固化、不可自愈。`PUT /meta`（属性面板改 title/tags → `set_meta`）同根因触发。直接违背 v1.2.0 主打卖点（F-4/F-5 BOM/换行保真）与验收清单 A3「磁盘字节一致」。
- **注意**：L305-306 `return new_content` 分支（missing 为空）安全；源码模式通道因携带完整原 frontmatter 而免疫——这解释了为何 pre.2 验收未暴露。
- **修复规格**：
  1. `merge_frontmatter` 与 `set_meta` 重建分支：记录原内容的 BOM 与 frontmatter 块换行风格，写回前还原（或在原块上做字符串手术插入 missing 行，避免 splitlines/join）。
  2. 保持现有语义不变：仅修字节级保真，不改合并逻辑。
- **验收测试要求**：
  - 新增 pytest：「BOM+CRLF+title 文档经 WYSIWYG 保存（只带 ke_version 的 PUT）后，磁盘字节 = 原 BOM + 原 CRLF frontmatter（含 title）+ 新正文」；`set_meta` 同矩阵。
  - 覆盖四种组合：BOM×{LF,CRLF} × {merge, set_meta}。
  - 回归：既有 630 测试全绿。

### B2. 桌面菜单「退出」/ Ctrl+Q 绕过 flush 握手，未保存编辑静默丢失

- **位置**：[desktop/src-tauri/src/menu.rs:133](file:///workspace/desktop/src-tauri/src/menu.rs#L133) `MID_EXIT => request_exit(app)`；`request_exit`（L152-161）直接 `hide → cleanup_on_exit → app.exit(0)`。
- **对照**：关窗路径（X / Alt+F4）有完整握手——[lib.rs:48-67](file:///workspace/desktop/src-tauri/src/lib.rs#L48-L67) 首次 CloseRequested 时 `prevent_close + hide + emit("ke:close-requested") + 1.5s 兜底`；前端 [desktop.ts:43-52](file:///workspace/frontend/src/desktop.ts#L43-L52) 监听该事件执行 `flushPendingAll()` 后二次 close。
- **影响**：保存模型为尾部防抖（[saveQueue.ts:90-104](file:///workspace/frontend/src/state/saveQueue.ts#L90-L104)，连续击剑会无限推迟落盘），`app.exit(0)` 立即销毁 WebView（`beforeunload` 不执行）→ **连续输入后 Ctrl+Q / 菜单退出，丢失自上次自动保存以来全部内容，无任何提示**。这是项目自定的 P1-14 级数据保护，主流退出路径在保护之外。
- **修复规格**：`MID_EXIT` 改走与关窗完全相同的路径——emit `ke:close-requested` + 复用 `CLOSE_REQUESTED` 标记与 1.5s 兜底逻辑（可将该逻辑抽为公共函数供 CloseRequested 与菜单退出共用）；不得直接调 `request_exit`。
- **验收测试要求**：
  - CDP 实证（Windows 真机）：连续输入（不停顿满 3s）→ Ctrl+Q → 进程退出后重开 → 磁盘文档含全部输入。
  - cargo test 不覆盖交互路径，需在 GUI 验收报告中留证据。

### B3. rename_dir / rename_doc 未拦截反斜杠，Windows 下路径穿越出工作区

- **位置**：[backend/app/routers/fs.py:254-261](file:///workspace/backend/app/routers/fs.py#L254-L261)（rename_dir）、[fs.py:357-366](file:///workspace/backend/app/routers/fs.py#L357-L366)（rename_doc）。
- **问题**：两处对 `new_name` 只校验 `"/" in new_name`，随后裸拼接 `target = full.parent / new_name`，无 `_guard_rel`、无构造后包含性校验。Windows 上 `\` 是路径分隔符，`PUT /api/fs/dir {"path":"Articles/sub","new_name":"..\\..\\..\\evil"}` 会把整个文件夹移出工作区。附件上传有 `_is_single_component` 拒 `\`（attachments.py:106-127）、move 有 F9c 净化，唯独这两个端点漏防——与 F8 同族。
- **影响**：用户文件被静默移出工作区（用户视角 = 数据丢失），落点由输入控制；模块自述的沙箱保证被打破。POSIX 下 `\` 是合法文件名字符，不构成穿越（Windows-only）。
- **修复规格**：
  1. `new_name` 拒绝含 `\`（与附件 `_is_single_component` 同口径）；
  2. 构造 `target` 后追加一次 resolve 级包含性断言（`root in target.resolve().parents`，复用 `_require_business_top` 级语义）。
  3. 顺带对齐：rename 两处未捕获 OSError（Windows 保留名/尾点尾空格 → 500），按 move_path 的 L459-462 口径映射 400。
- **验收测试要求**：pytest 新增 Windows 语义用例（可复用现有 `_win_only` 标记体系）：`..\..\evil` 重命名 → 400/409 且源文件原地不动；POSIX 下 `a\b` 合法名行为不变（如决定全平台拒 `\` 需明确声明）。

### B4. 工作区切换/关闭/新建文档的「放弃」分支缺 discardPending，迟到 PUT 跨工作区串写

- **位置**：[frontend/src/App.tsx:491-507](file:///workspace/frontend/src/App.tsx#L491-L507)（switchWorkspace）、L553-563（handleCloseWorkspace）、L565-583（handleNewArticle）。
- **问题**：`flushWithTimeout` 超时返回 false → 用户确认放弃后，在途 PUT 与确认期间重新入队的 latest 仍存活。PUT 到达后端时 root 已切换（后端按请求时刻的 `workspace_root` 解析，documents.py:261-264）→ **ws1 内容覆盖 ws2 同相对路径文件**。对照组已修：requestOpenArticle（[App.tsx:338](file:///workspace/frontend/src/App.tsx#L338)）、closeTabById（[:370](file:///workspace/frontend/src/App.tsx#L370)）都有 `discardPending`（task-35 C 语义），工作区级三处入口漏修。App.tsx:489-490 的 F02 注释防的正是此问题，防了一半。
- **修复规格**：三处入口的用户确认放弃分支各补 `discardPending(articleIdRef.current)`，与 L338/L370 对齐。
- **验收测试要求**：新增 vitest：「flush 超时 → 确认放弃 → 切换工作区 → 零迟到 PUT / 零再入队落盘」；三处入口各一例。

### B5. plain 导出对「正文以 HR 开头 + 后文含独立 HR」的文档静默吞掉首段

- **位置**：[frontend/src/editor/plain-export.ts:104-123](file:///workspace/frontend/src/editor/plain-export.ts#L104-L123)（`splitLeadingFm`）；调用链 `plainMarkdown`（L373-376）→ `withPlainFrontmatter`（L151-163）。
- **问题**：ADD-1/EDGE-1 已把 frontmatter 判定收紧进 [ke.ts:50-75](file:///workspace/frontend/src/editor/ke.ts#L50-L75) 的 `scanFrontmatter`（首有效行须 YAML 形态、闭合须独立整行），但 plain 导出仍用宽松正则 `/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n+)+/`。PM 把 thematicBreak 序列化为 `---`，故正文以 HR 开头的文档 `getMarkdown()` 输出首行即 `---`；正则误判整段为 frontmatter，非 `key:` 行在 L110-118 分组时被静默丢弃（`cur === null` 不进 fmLines 也不在 rest）。
- **实证**（已按源码逐行复制逻辑复现）：

```text
输入 body = "---\n\n第一段\n\n---\n\n第二段\n"
splitLeadingFm(body) → fmLines: [], rest: "第二段\n"   // 「第一段」被静默吞掉
```

- **影响**：「导出普通 Markdown (.md)」产物静默丢段/移位（磁盘源文件无损，导出产物损坏）。历史上「行首 HR + 正文 + 行尾 HR 误判 frontmatter 致整篇丢失」同类漏洞在导出口径的残留；验收清单 A4 明确将导出静默失败列为红线。
- **修复规格**：`splitLeadingFm` / `stripKeFrontmatter`（L172-191 同款宽松正则）统一改用 ke.ts 的 `scanFrontmatter` 判定，与保存/导入同口径。
- **验收测试要求**：plain-export.test 新增：「正文首行 HR + 后文独立 HR」「首行 HR + 空 frontmatter 形态」「BOM/CRLF 变体」导出零丢失回归；既有导出测试全绿。

---

## 2. 建议同批修复（MAJOR，均为小改动）

### M1. 后端 rename_doc 可改名被引用附件，绕过 P2-15 引用保护（全平台）
[fs.py:351-356](file:///workspace/backend/app/routers/fs.py#L351-L356)：文档类型校验 `_top_of(rel)` 用**未归一化原始字符串**。`PUT /api/fs/doc {"path":"Articles/../Attachments/images/x.png","new_name":"y"}` → `_top_of` 得 "Articles" 通过校验，实际改名附件；rename_doc 无 move_path 的 `referencing_docs` 检查 → 全部引用断裂。修复：顶层判定改用 `full.relative_to(root).parts[0]`（F8 对齐），或对 Attachments 落点补引用检查。

### M2. 附件删除 409 保护用原始 rel_path 比对规范化引用键（Windows 可绕过）
[attachments.py:270-278](file:///workspace/backend/app/routers/attachments.py#L270-L278)：`if rel_path in refs` 用 URL 原始输入；`DELETE .../Attachments/images/USED.PNG`（或反斜杠变体）在 Windows 下 `is_file()` 命中但不在 `refs` → 被引用附件被永久删除。修复：用 `full.relative_to(root).as_posix()` 规范化结果做成员判断。

### M3. delete_dir / move_path 目录分支附件引用保护对顶层名大小写敏感（Windows 可绕过）
[fs.py:278](file:///workspace/backend/app/routers/fs.py#L278)、L394/L406：`dir_rel.startswith(DIR_ATTACHMENTS + "/")` 大小写敏感，而顶层校验大小写不敏感 → `DELETE /api/fs/dir?path=attachments/images` 绕过保护。修复：`parts[0].lower() == DIR_ATTACHMENTS.lower()`。

### M4. 源码模式下三种导出全部产出陈旧内容
[EditorArea.tsx:705-739](file:///workspace/frontend/src/components/layout/EditorArea.tsx#L705-L739)：导出基于 `editor.getMarkdown()`，源码态 textarea 不回灌 ProseMirror → 导出 = 进入源码前的旧正文（即使已自动保存到磁盘）。修复：导出 handler 增加 `viewMode === 'source'` 分支，KE/zip 用 `buildSourceSavePayload(sourceBaseRawRef.current, sourceValueRef.current)`，plain 对 `sourceValueRef.current` 跑 `plainMarkdown`；或导出前强制 flush 后以回包组装。

### M5. sidecar 启动握手期 / 崩溃重启期关窗 → 后端进程永久孤儿化
[sidecar.rs](file:///workspace/desktop/src-tauri/src/sidecar.rs)：`state.info`（PID 唯一记录）仅在 health 握手成功（最长 30s）后写入（L353-357），进程在 `.spawn()`（L274-281）时已诞生；`cleanup_on_exit`（L455-485）只在 `info=Some` 时杀进程。慢启动期或崩溃重启窗口（`watch_sidecar` L376-411 的 sleep(1s) 与 health 等待期间不查 `SHUTTING_DOWN`）关窗 → 孤儿 backend 永久驻留（占 8000 端口、持 workspace 句柄），且 runtime.json 已删 → `cleanup_stale` 永久失明。修复：spawn 成功立即把 PID 登记到独立 AtomicU32，`cleanup_on_exit` 优先按登记值 kill_tree；`wait_health` 循环与重启 sleep 后各加一次 `SHUTTING_DOWN` 检查。

### M6. 退出强杀缺 is_backend_process 校验，PID 复用可误杀无关进程树
[sidecar.rs:462-468、479-481](file:///workspace/desktop/src-tauri/src/sidecar.rs#L462-L468)：`is_backend_process`（L120-136）只用于 `cleanup_stale`，退出路径两处 `taskkill /F /T` 直接按旧 PID 杀整树。修复：强杀前复用该校验，不匹配则只清 runtime.json。

### M7. KE_API_TOKEN 是半成品功能（启用即全功能不可用）
[main.py:121-146](file:///workspace/backend/app/main.py#L121-L146)：① 中间件顺序导致 token 校验在 CORS 之前，OPTIONS 预检无 `X-KE-Token` → 401；② 前端 client.ts 从不发送该头；③ Rust sidecar 从不生成/注入 token（grep 无匹配）。当前默认空 token 不受影响，但任何设置该环境变量的用户会砖掉整个应用。修复（二选一）：移除该功能与文档；或补齐（中间件放行 OPTIONS + 前端注入 + sidecar 生成）。

### M8. 文件夹删除为永久物理删除且无快照
[fs.py:288-305](file:///workspace/backend/app/routers/fs.py#L288-L305)：单文档删除走回收站 + P1-11 强制快照；`DELETE /api/fs/dir` 对目录内全部文档直接 `unlink`，不进回收站、无历史快照；循环内无 per-file 容错（Windows 文件锁 → 已删文件永久丢失 + 500）。属设计边界（回收站 MVP 仅文档），但是当前最大的用户可见永久丢失敞口。**产品决策项**：至少做到删除前对每个 .md 调 `hist.snapshot` + per-file 容错并在响应中报告失败清单。

---

## 3. 可延期（MINOR，不阻塞发布，建议记 backlog）

| # | 位置 | 问题 |
|---|---|---|
| m1 | markdown_io.py:416-418 + indexer.py | atomic_write 崩溃残留 `.tmp-*.md` 被当文档索引/显示 |
| m2 | markdown_io.py:226-240 等 | title/tags 含换行可注入破坏 frontmatter 结构（正文不丢） |
| m3 | markdown_io.py:409-430 | atomic_write 缺父目录 fsync（断电场景目录项可能未持久化） |
| m4 | documents.py | 文档保存无乐观并发（双开 last-write-wins；有历史快照兜底） |
| m5 | import_export.py:449/528、96-118、351 | 列表型 title 导入 500；导出包无大小上限；`_rewrite_refs` 只匹配三种空格变体 |
| m6 | trash.py:233-238、fs_watch.py:130-141、history_store.py:147 | purge 对普通文件 500（restore 端有检查、purge 端没有）；watcher 对自删除产事件（UX 噪音）；rglob 在 ≤3.12 跟随符号链接 |
| m7 | desktop Cargo.toml | 无 `[profile.release]`（strip/lto）；backend.log 无轮转 |
| m8 | desktop/nsis/ | NSIS 钩子双份漂移（desktop/ 版为死副本）；生效版卸载器 ExecWait 不查错误、强杀旧实例无提示 |
| m9 | sidecar.rs:377-416 | 前端未监听 `ke:sidecar-exited`/`ke:runtime-error`，后端彻底启动失败时用户看到无根因坏界面 |
| m10 | sidecar.rs:453-481 注释 | 退出清理注释描述旧流程（优雅 5s），实现是有界强杀（1.2s），注释误导 |
| m11 | tools/gen-manifest.py:3 | 硬编码 `D:\KE Project\knowledge-editor`，仓库外不可复现（build.ps1 有等价实现） |
| m12 | 深色主题 | 完整深色适配未实现（已知声明项） |

---

## 4. 未充分验证区域（正式版前必须闭合）

| # | 区域 | 缺口 | 闭合方式 |
|---|---|---|---|
| U1 | **Rust 侧** | 本沙箱无法编译（缺 glib）；CI desktop job `continue-on-error` → Rust 侧实质弱验证 | Windows 实机 `cargo test` 确认 20 passed，发布清单显式要求人工核对 desktop-artifacts |
| U2 | **导出口径** | 四件产物字节校验上次执行于 v1.1.3；本次 B5+M4 恰好落在导出路径，证明缺口已造成漏网 | 在修复后版本上复跑四件产物字节校验（KE 导出 diff=0 / plain 导出零 ke- 残留 / zip sha256 一致 / 二次导出一致） |
| U3 | **干净 Windows 首装演练** | 清空 `%APPDATA%\KnowledgeEditor` 模拟首装，自 v1.1.x 起一直未做 | 按 release-acceptance-checklist A1-A2 执行 |
| U4 | **门禁稳定性** | vitest 间歇 `ReferenceError: document is not defined`（PM EditorView 在 jsdom 拆除后被异步访问），实测 3 次全量中 1 次致 cursor.verify 真实失败 | 定位并修复异步 teardown（在 cursor/math 相关测试等所有 timer/view 销毁后再结束），否则正式版门禁带 flaky |
| U5 | **Windows 路径语义测试** | B3/M1/M2/M3 全为 Linux CI 跑不出的 Windows-only 缺陷族 | 扩充 `_win_only` 标记体系覆盖 rename/附件删除/目录删除的变体输入（大小写/反斜杠/`..%2F`） |
| U6 | **性能** | 长文档/大工作区 F22 未修，仅「不卡死」验收 | 维持现状并在发布注记中声明，或立项 |
| U7 | **Windows GUI 验收** | 多实例/原生菜单/关窗握手/崩溃拉起仅真机可验；pre.2 已做过一轮（有记录），但 B2 修复后必须重验退出路径 | B2 修复后按 checklist A7 复验菜单退出 + 关窗两条路径 |

---

## 5. 修复验收门禁（修复 agent 完成标准）

1. B1-B5 全部修复，每项附对应新增测试且全绿；
2. 全量门禁不低于基线：pytest ≥630 passed + 2 skipped · tsc 0 · vitest ≥56 files / 1095 passed + 1 skipped ·（Windows）cargo test 20 passed；
3. 独立对抗验证（实现者与验证者分离）：
   - B1：BOM/CRLF × merge/set_meta 四组合字节级矩阵 + 真实 API 端到端保存复算 sha256；
   - B2：CDP 实证连续输入 → Ctrl+Q → 重开零丢失；
   - B3/B4/B5：按上文「验收测试要求」逐条给出 PASS/FAIL 证据；
4. 复跑导出四件产物字节校验（U2）；
5. 更新 `CHANGELOG_DEV.md` 与本报告的处置状态。

---

## 6. 已验证无问题（无需再投入复核）

- **源码模式核心直存链路**：`buildSourceSavePayload` 零编辑恒等、BOM/CRLF 还原、切档不串档（时序推演 + V0-V4 系列既有用例）、enterSourceMode 无陈旧窗口；
- **frontmatter 三函数**（ke.ts scanFrontmatter 族）：开块判定安全，「行首 HR 误判」在保存/导入路径已杜绝；
- **WYSIWYG 串档守卫体系**（editorDocIdRef + resolveSaveContent + createDeferredLoader 代次）；恢复点 id/内容同源（F-S1-4 无残留）；
- **回收站**：原子 rename、恢复冲突不覆盖、符号链接拒绝、测试含 inode 不变证明；
- **zip 导入**：zip-slip 双保险、按实际字节计大小、staged 提交永不覆盖、失败回滚；
- **启动自愈**：作用域限定应用内部目录、只改名不动内容、歧义 fail-safe、异常不阻断启动；
- **路径穿越主防线**（safe_rel_path/_guard_rel/move）：resolve 包含性 + NUL 拒绝 + 受保护根大小写不敏感，测试覆盖充分；
- **设置系统**：白名单三处同步有守门测试、深合并对齐、原子保存、BOM 兼容；
- **CSP / capabilities / 单实例 / 崩溃风暴防护 / bump-version.mjs**；
- **附件上传**：净化 + 白名单 + resolve 二道防线 + O_EXCL 防竞态覆盖 + SVG 强制下载。

---

## 7. 处置状态（Lead 维护 · 2026-09-20 起滚动更新）

| 项 | 处置 | 证据 |
|---|---|---|
| **B1** BOM/CRLF 字节损坏 | ✅ 已修（`dc4f99e`）· 待 verifier-s2 复核 | 首因 = 重建分支 `splitlines/join`；**第二根因（报告未列）= `read_text` 通用换行读把 CRLF 在读时折成 LF** → 改 `newline=""` 逐字节读。实测 `/articles` 与 `/meta` 两条路径均恢复「原 BOM + 原 CRLF + 原 title + 新正文」 |
| **B2** 菜单退出绕过 flush 握手 | ✅ 已修（`73d48b9`）· 待 verifier-trash 静态核验 + Lead 真机验证 | 抽出 `begin_close_handshake`，关窗与菜单退出共用；`MID_EXIT` 不再直接 `request_exit` |
| **B3** rename 反斜杠穿越 | ✅ 已修（`dc4f99e`）· 待复核 | 全平台拒 `\` + `_guard_rename_target` 包含性断言 + OSError→400；实测 BEFORE 200 → AFTER 400 且源不动 |
| **B4** 工作区级放弃分支缺 `discardPending` | 🔄 task-44 实施中（dev-trash-fe） | — |
| **B5** plain 导出吞段 | 🔄 task-44 实施中 | — |
| **M1** rename_doc 顶层判定 | ✅ 已修（`dc4f99e`） | `parts[0]`（F8 对齐）；BEFORE 200 真改名 → AFTER 400 |
| **M2** 附件删除保护规范化 | ✅ 已修（`dc4f99e`） | resolve 后 canonical rel + 仅 Windows 大小写兜底；BEFORE 200 被删 → AFTER 409 |
| **M3** 附件保护大小写 | ✅ 已修（`dc4f99e`） | `_is_under_attachments` 不敏感；Windows-only 集成断言标注 `_win_only` |
| **M4** 源码态导出陈旧 | 🔄 task-44 实施中 | — |
| **M5/M6** sidecar 孤儿 / 误杀 | ✅ 已修（`73d48b9`）· 待静态核验 | `SPAWNED_PID` spawn 即登记 + `SHUTTING_DOWN` 检查 + 强杀前 `is_backend_process` |
| **M7** KE_API_TOKEN 半成品 | ✅ 已修（`dc4f99e`）· 按 Lead 决策**移除功能** | `token=secret` 时 `GET /api/tree` BEFORE 401 → AFTER 200 |
| **M8** 目录删除无快照 | ✅ 已修（`dc4f99e`）· 契约：全成功 204 / 有失败 200 + `failed[]` | 每 `.md` 一份快照 + per-file 容错；BEFORE 首个锁文件即 500 且其余未删 → AFTER 部分成功 + 失败清单 |
| m1–m12（MINOR） | 📋 已登记 backlog（不阻塞 1.2.0） | 见 `docs/backlog-1.1.x.md` |
| **U1** Rust 弱验证 | ✅ 补：Windows `cargo test` **20 passed**（Lead 实跑） | — |
| **U2** 导出四件产物字节校验 | ⏳ Lead 待修完 B5/M4 后复跑 | — |
| **U4** 门禁 flaky | 🔄 task-44 实施中（要求连跑 3 次全绿） | — |
| **U6** 长文档性能 | 📋 发布注记声明，未立项 | — |
| **U7** B2 后 GUI 重验退出路径 | ⏳ Lead 待打包版真机验证（连续输入 → Ctrl+Q → 重开 → 磁盘含全部输入） | — |
| **F-3/F-4/F-5/F-1/F-2**（回收站硬化，审查外新增发现） | 🔄 task-48（dev-attach）· F-6 由 Lead 改契约文本 | 见 task-48 |
