# KnowledgeEditor v1.0.1 修复报告（本地修复，未推送 GitHub）

> 依据：`knowledge-editor-fix-checklist.md`（9 份审计报告整合，P0×4 / P1×17 / P2×20 / P3×21 / P4×13）
> 仓库：`/mnt/d/KE Project/knowledge-editor`（本地提交 `1135c6d`，基于 `b24003c`）
> 验证：backend **157 passed / 2 skipped**；frontend **155 passed（tsc 干净）**；`npm run build` 成功

---

## 一、P0 阻断级（4/4 完成）

| # | 缺陷 | 修复位置 | 回归测试 |
|---|------|---------|---------|
| P0-1 | 保存清空 frontmatter | 后端 `documents.py:update_article` 用 `markdown_io.merge_frontmatter`（**原始行无损合并**：新正文无 frontmatter 时旧块原样前置；双方都有时旧块缺失键以原始行插回，嵌套 YAML/注释/CRLF 逐字节保留）；前端 `ke.ts:withFrontmatter` 改为合并语义（仅更新 ke_version 键） | `backend/tests/test_v101_regressions.py::test_p01_*`（3）+ `frontend/src/editor/fidelity-regression.test.ts` P0-1（4） |
| P0-2 | 防抖窗口输入静默丢失 | 前端 `state/saveQueue.ts`（per-doc 单飞队列 + `flushPending`）、`App.tsx:requestOpenArticle`（dirty 先 flush/confirm，覆盖新建/导入/恢复/重命名/移动作业）、`beforeunload`、`desktop.ts:setupCloseHandshake`（监听 `ke:close-requested` → flush ≤1.5s → `getCurrentWindow().close()`）；Rust `lib.rs` 首次关窗 prevent+hide+emit，1.5s 兜底强退 | `state/saveQueue.test.ts`（7）+ `closeGuard.test.ts`（3） |
| P0-3 | DELETE /api/fs/dir 整库删除 | `markdown_io.safe_rel_path` 显式拒绝 `candidate == root`（"."/""/"/" 等价输入全局失效）；`fs.py:_require_business_top`（delete/rename/move 必须位于 Articles/Modules/Attachments 之下，含 `Attachments/../Modules` 归一化绕过） | `test_p03_*`（4） |
| P0-4 | 切换文档 Ctrl+Z 跨文档串内容 | `editor/index.ts:setKeContent`：`setContent(..., {contentType:'markdown', emitUpdate:false})` + `clearUndoRedoHistory()`（prosemirror-history 空栈状态注入） | fidelity P0-4+P1-1（3） |

## 二、P1 高优先（17/17 完成）

- **P1-1 打开即保存**：同上 `emitUpdate:false`（加载不再触发 onUpdate）。✅ fidelity 测试
- **P1-2 HTML 注释/块被删**：新增 `extensions/HtmlPassthroughExtension.ts` + `tokenizers.ts` 块级/行内保真 tokenizer（跳过 ke-* 与行内格式化标签）。✅ fidelity（4）
- **P1-3 已知 kind 坏 JSON 被弃**：fallback tokenizer 放开负向前瞻（块级仅排除 footnote），损坏 JSON 的已知/未知 kind 原文保留。✅ fidelity（3）
- **P1-4 表格保真**：`parseTableRow` 按未转义 `|` 分割（`\|` 还原为字面量）；单元格行内 Markdown 往返（`renderChildren` 递归 + 序列化转义）；`mergeCells/splitCell` 在扩展层禁用（`can()`=false，气泡菜单自动置灰）。✅ fidelity（3）
- **P1-5 + P4-12 module 字段丢失**：`ModuleExtension.renderMarkdown` source 并入字段对象、输出带 kind。✅ phase5-module.test.ts
- **P1-6 autosave/手动保存乱序**：`saveQueue` 同 docId 串行化 + 在途合并（latest-wins）；恢复点仅在最新序号时清除。✅ saveQueue.test.ts
- **P1-7 响应无请求序号**：`state/requestSeq.ts`（openWithSeq + shouldAcceptSave），`handleSaved` 校验 doc.id 等于当前文档。✅ requestSeq.test.ts（5）
- **P1-8 外部修改 stale closure**：`articleIdRef` + `classifyFsEvent/isCurrentDocEvent` 纯函数。✅ fsEvent.test.ts（9）
- **P1-9 SQLite 跨线程无锁**：`IndexStore` 全方法 `RLock` + `batch()` 事务上下文（P2-6 一并）；20 线程压测零异常。✅ test_p19_*（2）
- **P1-10 路径白名单**：`is_doc_rel/is_attachment_rel/is_recovery_draft_rel` 应用于 articles/attachments/history/drafts 全部端点；负向矩阵（`.knowledgeeditor`、`Drafts`、越区 `.md` 一律 4xx）。✅ test_p110_*（2）
- **P1-11 删除无兜底/restore 404**：`delete_article` 删除前强制快照；`history/restore` 允许重建已删文档。✅ test_p111
- **P1-12 多实例 + stale PID 盲杀**：Rust 接入 `tauri-plugin-single-instance`；`cleanup_stale` 先校验命令行含 `knowledgeeditor-backend` 再杀；start/stop.ps1 同步校验。⚠ 未编译验证（本机无 cargo）
- **P1-13 4s vs 30s 握手**：前端 `state/runtimeWait.ts`（30s + 优先 `ke:runtime-ready` 事件 payload 带出 api_base）+ main.tsx 接线。✅ runtimeWait.test.ts（6）；Rust 侧 health 超时整树杀
- **P1-14 关窗 flush + recovery 寄生 index.db**：Rust `ke:close-requested` 两次关闭协议；前端 flush→close；后端 `drafts.py` 恢复点改为**目录扫描优先、DB 兜底**（草稿名 `{stem}-{hash8}.draft.md`，哈希反查 doc_path；索引库被删后仍可恢复）。✅ test_p114
- **P1-15 inline 返回 + shell 权限 + CSP**：后端附件非位图/视频强制 `Content-Disposition: attachment`（SVG 不内联）；删 `shell:allow-spawn/execute`；tauri csp null→最小 CSP。✅ test_p115
- **P1-16 CI 三重失效**：`branches: master`；`ke-vite.mjs` 按平台选 esbuild（Linux 实跑通过）；Windows job（pytest+vitest+build）；desktop job（PyInstaller 源码构建 + hash manifest，continue-on-error）；`test_delete_safety` Windows 语义用例加 `skipif`。✅ CI YAML/JSON 合法
- **P1-17 symlink/Junction 越界**：`markdown_io.walk_files/walk_dirs`（跳过链接）替换全部 `rglob`（tree/indexer/fs/fs_watch/attachments/modules/workspace info/references）。✅ test_p117_*（2，Windows 无管理员权限时 skip）

## 三、P2 中等（20/20 完成）

P2-1 BOM/CRLF/嵌套 YAML 无损（parse 剥离 BOM + set_meta 逐键手术）｜P2-2 非 UTF-8 → 422｜P2-3 快照同毫秒单调递增｜P2-4 快照失败不阻塞保存｜P2-5 上传/导入配额（流式 limit，zip 按实际字节）｜P2-6 重建单事务原子提交｜P2-7 死开关接线（restoreLastState/autoOpenRecentWorkspace 启动接线）｜P2-8 加载错误区分（classifyLoadState + LeftSidebar/EditorArea 错误态+重试）｜P2-9 WorkspacePicker 走 apiBase｜P2-10 release 日志落盘 `%APPDATA%\KnowledgeEditor\logs\backend.log`｜P2-11 atomic_write flush+fsync｜P2-12 settings.rs + app_config 随机 tmp+锁｜P2-13 watcher 事件→索引增量同步（set_handler）｜P2-14 草稿名含路径哈希｜P2-15 fs move/delete 附件引用保护（409）｜P2-16 TrustedHost + KE_API_TOKEN｜P2-17 脚注 `} -->` 平衡匹配｜P2-18 保护目录大小写不敏感｜P2-19 整树杀 + 崩溃重探测端口｜P2-20 上传后 mark_internal。

回归：`test_p2*`（10 项）+ 既有用例全绿。

## 四、P3 低优先（21 项中 19 项落地）

落地：P3-1（保留名/尾点/超长 slugify + 建文 201）｜P3-3（reconcile 签名增量，跳过全量重建）｜P3-5（keJson 保留未知字段）｜P3-6（LIKE 通配符转义 + FTS 短语回退）｜P3-7（外部删除当前文档提示）｜P3-8（恢复检测失败重试 + 「恢复检查…」入口）｜P3-9（workspace_create 传文件 → 400）｜P3-10（索引不跟随 junction）｜P3-11（restore 响应补 created/updated/size/word_count，属性面板不再「—」）｜P3-12（create 写入 frontmatter title 接线）｜P3-13（health 校验 KE 标识 + 整树杀）｜P3-14（**后端** `_rewrite_refs` 仅改写引用字面量：ke-src 值 + `![](url)`，URL/代码块掩码；前端提取同步精确化）｜P3-15（buildFileTree useMemo）｜P3-16（U+200B 保存剥除）｜P3-17（vitest include .tsx）｜P3-18（conftest 函数级隔离，消除顺序耦合）｜P3-19（OpenAPI schema 签名快照）｜P3-20（拖拽插入竞态纯函数）｜P3-21（最近菜单动态化 `ke-menu:refresh-recent`）。

**未落地（已注明，建议单独排期）**：P3-2 解析性能超线性（256KB≈10.5s，需 profiler 定位，属性能专项）；P3-4 watcher 改 ReadDirectoryChangesW（当前保持轮询，功能正确仅开销）。

## 五、P4 整理项（13 项中 11 项落地）

落地：P4-1（keStableId 确定性 id）｜P4-3（repro-main.tsx 删除）｜P4-4（错误信息去绝对路径）｜P4-5（requirements 精确锁定）｜P4-6（KE_SIGN_CERT_THUMBPRINT 可选签名）｜P4-8（start.bat UTF-8+chcp 65001）｜P4-9（modules 枚举 .markdown）｜P4-10（规范/实现记录文档关系声明，冲突以 document-format.md 为准）｜P4-11（~x~ 删除线说明）｜P4-12（source 含 kind）｜P4-13（大纲 Tab 实现 extractOutline + 点击跳转）。

**未落地（已注明）**：P4-2 深色主题（color-scheme 兜底，UI 主题工作量）；P4-7 主包 1.95MB 代码分割（mathlive/katex 拆 chunk，构建优化专项；`npm run build` 已出警告）。

---

## 六、关键接口契约（桌面 ↔ 前端，供后续开发）

| 事件/命令 | 方向 | 语义 |
|---|---|---|
| `ke:close-requested` | Rust → 前端 | 首次关窗；前端 flush 后 `getCurrentWindow().close()` 触发第二次（Rust 1.5s 兜底强退） |
| `ke:runtime-ready` | Rust → 前端 | payload `{api_base,...}` → 写入 `window.__KE_API_BASE__` |
| `ke-menu:refresh-recent` | Rust → 前端 | 前端打开工作区菜单（最近列表所有权在前端） |
| `get_runtime_info` | 前端 → Rust | 轮询兜底（30s 等待窗口） |
| `/api/health` | 后端 | 保持返回 `status=ok` + `version`（Rust wait_health 依赖） |

新增可测纯函数模块（`frontend/src/state/`，13 个文件 58 用例）：saveQueue / requestSeq / fsEvent / classifyLoad / recovery / settingsGates / runtimeWait / outline / dropInsert / workspaceRecent / closeGuard / memoTree。

## 七、验证记录

- `cd backend && python -m pytest` → **157 passed, 2 skipped**（skipped = 符号链接越界测试，Windows 无管理员权限；Linux CI 可跑）
- `cd frontend && npx tsc -b --noEmit` → 0 errors；`npx vitest run` → **155 passed**（20 文件）
- `npm run build` → 成功（ke-vite 跨平台 esbuild 选择在 Linux 实测通过）
- Rust 侧（lib.rs/menu.rs/sidecar.rs/settings.rs）**未编译验证**（本机无 cargo）——已逐行评审自查；PS 脚本语法解析通过；CI YAML/JSON 合法
- 全部改动已本地提交 **`1135c6d`**，**未推送 GitHub**（`git push` 未执行）

## 八、环境说明

- Python 3.14.7（Windows）+ pip 用户级安装；pytest 运行于 Windows 解释器（与产品目标平台一致）
- 前后端依赖版本：fastapi 0.141.1 / uvicorn 0.52.1 / pydantic 2.13.4 / pytest 8.4.2 / Node 24
- 若需在 Linux 复跑后端：`pip install -r backend/requirements.txt && cd backend && python -m pytest`（Windows 语义用例自动 skip）
