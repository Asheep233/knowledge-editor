# Phase 6：搜索与可靠性增强 — 阶段报告

> 完成日期：2026-08-09
> 前置：Phase 5E（开发环境统一启动与进程管理）

---

## 1. 完成功能

### 6.1 全文搜索增强

- 左侧栏顶部新增**全局搜索区**：输入即搜（300ms 防抖）、回车立即确认、点击结果直接打开文档。
- 搜索结果展示文档标题、路径、类型标签、匹配上下文片段；片段中的匹配关键词由后端 FTS5 `snippet()` 的 `[` `]` 标记拆分渲染为高亮 `<mark>`。
- 搜索区内置**「重建索引」按钮**：新增薄路由 `POST /api/index/rebuild`，复用既有 `WorkspaceIndexer.rebuild()`，完成后提示文档/模块/附件数量统计，并自动重跑当前关键词搜索。
- 索引一致性验证（后端测试覆盖）：新增文档可搜索、修改后结果更新、删除后结果消失、重建索引后结果一致。

### 6.2 自动保存与异常恢复增强

- 保存状态四态（已保存/保存中/未保存/保存失败）沿用既有实现；失败保留编辑内容并支持手动重试（既有能力，未重复设计）。
- **启动恢复检测**：工作区打开后自动查询 `GET /api/drafts/recovery`，存在未恢复内容时弹出提示「检测到未恢复的编辑内容，是否恢复？」；每项支持「恢复」「丢弃」，另有「全部丢弃」「稍后处理」。
- **恢复链路补齐**：新增 `POST /api/drafts/recovery/restore` —— 将草稿内容写回原 Markdown 路径（允许重建被删除的文档）→ 快照当前内容 → 更新 SQLite 索引 → 标记内部写入（抑制外部修改误报）→ 清除恢复记录与草稿文件。
- **丢弃链路补齐**：`DELETE /api/drafts/recovery/{doc_path}` 现在同时删除草稿文件（此前只清记录）。
- 前端保存链路接入：每次保存动作先登记恢复点（内容写入 `Drafts/recovery/*.draft.md`），保存成功后再清除；保存中断/异常退出时恢复点保留。

### 6.3 历史版本 UI

- **轻量快照存储**（用户确认方案，不引入新存储系统）：保存/恢复写盘前，若磁盘旧内容与将写入内容不同，将旧内容快照到 `Drafts/backup/{doc_path}/{YYYYMMDD-HHMMSS-mmm}.md`（毫秒精度避免同秒覆盖），每文档保留最近 30 份自动修剪。快照目录不在索引扫描范围，不进 SQLite，不参与搜索。
- **UI 入口**：编辑区工具栏新增「历史」按钮 → 弹出历史版本面板：
  - 顶部固定「当前版本」（当前文档更新时间 + 当前标记）；
  - 版本列表按时间倒序，显示时间与大小；
  - 点击版本只读预览（剥离 frontmatter 的正文）；
  - 「恢复此版本」先弹确认「恢复此版本将替换当前文档内容，是否继续？」；若存在未保存修改先额外提醒；
  - 恢复执行：快照当前内容 → 写回 Markdown → 更新索引 → 刷新编辑器内容 → 刷新版本列表（恢复动作本身产生新快照，操作可逆）。

### 6.4 编辑性能优化

- **消除击键时全量序列化**：编辑器 `onUpdate` 不再即时调用 `getMarkdown()`，改为仅标记 dirty + 防抖，序列化延迟到保存那一刻执行。这是大文档（50KB 级）输入延迟的主要来源，修复后每次击键为 O(1) 状态变更。
- **消除大文档重复解析**：编辑器初始化不再携带内容，文档内容统一由文档切换 effect 的 `setKeContent` 加载一次，避免打开时双重解析。
- **附件懒加载**：图片节点 `loading="lazy"` + `decoding="async"`；视频节点 `preload="metadata"`（默认只取元数据，多附件文档打开时不全部缓冲）。
- 目标「输入响应 < 100ms」：击键路径已无同步序列化，50KB 正文 + 10 图 + 5 公式场景下输入延迟由序列化主导（已消除）；打开解析仍为一次全量，50KB 目标内可接受（打开瞬间，非输入路径）。

### 禁止项遵守

未实现 AI 搜索、向量数据库、知识图谱、云同步、多用户协作、Git 式版本分支。保持本地 Markdown 知识管理工具定位。

### 架构约束遵守

Markdown 仍为唯一事实源；SQLite 仅索引与辅助数据（recovery 记录）；ProseMirror/Tiptap 仅编辑状态；文件管理与模块系统未改动；自动保存/恢复沿用既有机制，仅补齐端点与 UI。

---

## 2. 修改文件列表

### 后端（8 个）

| 文件 | 变更 |
|---|---|
| `backend/app/routers/index.py` | 新增：`POST /api/index/rebuild` 薄路由 |
| `backend/app/routers/history.py` | 新增：历史版本列表/预览/恢复 API |
| `backend/app/services/history_store.py` | 新增：快照存储（Drafts/backup，30 份修剪） |
| `backend/app/routers/drafts.py` | 扩展：recovery 支持 content 草稿写入、丢弃删文件、新增恢复写回端点 |
| `backend/app/routers/documents.py` | 保存/元信息更新链路接入 `_maybe_snapshot` 历史快照 |
| `backend/app/routers/workspace.py` | 工作区激活时挂载/卸载 `HistoryStore` |
| `backend/app/store/db.py` | `add_recovery` 改为 upsert（每文档单条）+ 新增 `get_recovery` |
| `backend/app/main.py` | 注册 index/history 路由；`app.state.history` 初始化 |
| `backend/tests/test_phase6.py` | 新增 9 项测试 |

### 前端（8 个）

| 文件 | 变更 |
|---|---|
| `frontend/src/types.ts` | 新增 HistoryVersion/HistoryPayload/HistoryPreview/RecoveryItem/RecoveryPayload/RebuildPayload |
| `frontend/src/api/client.ts` | 新增 rebuildIndex/listHistory/previewHistory/restoreHistory/listRecovery/registerRecovery/discardRecovery/restoreRecovery |
| `frontend/src/components/layout/LeftSidebar.tsx` | 顶部全局搜索区（防抖/回车/高亮/重建索引按钮） |
| `frontend/src/App.tsx` | 启动恢复检测弹窗（恢复/丢弃/全部丢弃/稍后处理） |
| `frontend/src/components/layout/EditorArea.tsx` | 历史版本面板（列表/预览/恢复/未保存提醒）；保存链路重构（延迟序列化 + ref 化） |
| `frontend/src/editor/index.ts` | `onUpdate` 签名改为无参（延迟序列化契约） |
| `frontend/src/components/editor/nodeviews/AttachmentNodeView.tsx` | 图片 lazy + async 解码 |
| `frontend/src/components/editor/nodeviews/VideoNodeView.tsx` | 视频 preload="metadata" |

### 文档（1 个）

- `README.md`：阶段状态、功能速览、文档索引

---

## 3. 数据流变化

```
保存（自动/手动）：
  编辑器 onUpdate（仅标记 dirty）→ 3s 防抖 → ed.getMarkdown()（此时才序列化）
  → POST /api/drafts/recovery（登记恢复点：内容写 Drafts/recovery/*.draft.md）
  → PUT /api/articles/{id}
      → _maybe_snapshot：磁盘旧内容 ≠ 新内容 → 快照到 Drafts/backup/{doc}/{ts}.md（保留 30）
      → atomic_write 写回 Markdown（唯一事实源）
      → indexer.update_file 更新 SQLite 索引 → mark_internal 抑制外部误报
  → 成功：DELETE /api/drafts/recovery/{id}（清恢复点+删草稿）

异常退出恢复（启动时）：
  GET /api/drafts/recovery（弹窗，每文档可恢复/丢弃）
  ├─ 恢复：POST /api/drafts/recovery/restore
  │     → 读草稿 → 快照当前 → atomic_write 写回原 Markdown
  │     → indexer.update_file → mark_internal → 清记录+删草稿 → 前端 openArticle 刷新编辑器
  └─ 丢弃：DELETE /api/drafts/recovery/{id} → 清记录 + 删草稿文件

历史版本（工具栏「历史」）：
  GET /api/history/list?doc=… → 版本列表
  GET /api/history/preview?doc=…&version_id=… → 只读预览
  POST /api/history/restore（确认后）
      → 快照当前内容 → atomic_write 写回版本内容 → indexer.update_file
      → mark_internal → 返回新文档 → setKeContent 刷新编辑器

重建索引：
  POST /api/index/rebuild → WorkspaceIndexer.rebuild()（清空后按磁盘重灌）→ 返回统计
```

---

## 4. UI 变化

| 位置 | 变化 |
|---|---|
| 左侧栏顶部 | 新增「搜索」分区：输入框（回车确认）+「重建索引」按钮 + 结果列表（标题/类型/路径/高亮摘要），点击打开文档 |
| 编辑区工具栏 | 新增「历史」按钮（打开历史版本面板） |
| 历史版本面板（弹窗） | 当前版本标识 + 倒序版本列表 + 只读预览 + 恢复确认（未保存修改先提醒） |
| 启动流程 | 检测到未恢复内容时弹出恢复对话框（恢复/丢弃/全部丢弃/稍后处理） |

---

## 5. 测试结果

### 后端单元/集成测试（pytest）

全部 97 项通过（含新增 9 项 Phase 6 测试）：

| 测试组 | 覆盖 | 结果 |
|---|---|---|
| `test_phase6.py::test_rebuild_index_endpoint` | 重建索引入口 + 重建后搜索一致 | 通过 |
| `test_search_index_updates_on_crud` | 新增可搜/修改更新/删除消失 | 通过 |
| `test_search_multi_keyword_chinese` | 中文多关键词命中 | 通过 |
| `test_recovery_register_list_restore` | 登记/列表/恢复写回（Markdown+索引一致+清理） | 通过 |
| `test_recovery_discard_clears_record_and_draft` | 丢弃清记录+删草稿 | 通过 |
| `test_recovery_restore_none_exists` | 无记录恢复返回 404 | 通过 |
| `test_history_snapshot_list_preview_restore` | 快照产生/列表倒序/预览/恢复（写回+索引一致）+ 恢复动作产生新快照 | 通过 |
| `test_history_preview_missing_version_404` | 非法版本 404 | 通过 |
| `test_history_prune_keeps_max_versions` | 超过 30 份修剪 + 非法 version_id 防穿越 | 通过 |

既有测试套件无回归（Phase 1–5E 全部保持通过）。

### 端到端冒烟（真实服务，uvicorn + 脚本）

对真实工作区执行完整链路，输出全绿：

```
workspace: ok | created ✓ | saved v1 v2 ✓ | history count 2 ✓
preview(最新快照= v1) ✓ | restore(最旧快照=初始内容) ✓ | search hit after restore ✓
recovery listed ✓ | recovery restored ✓ | recovery cleared ✓
rebuild: ok docs=7 ✓ | cleanup ✓
```

并验证 `Drafts/backup/Articles/…/{ts-mmm}.md` 快照文件真实落盘（毫秒级时间戳），`Drafts/recovery` 草稿文件按清除规则删除；测试后工作区残留已清理。

### 前端验证

- `tsc --noEmit`：通过（0 错误）。
- `vite build`：本沙箱环境触发 esbuild 转译临时文件清理失败（`Access is denied`，环境限制，详见第 6 节）；以 `--minify false --target esnext` 跳过转译插件后构建成功（7s）。类型检查已由 tsc 覆盖，功能验证由 dev server 完成。
- `vite dev`（5174 独立实例）：启动 1.1s；首页与全部改动模块（App/LeftSidebar/EditorArea）编译 200。

---

## 6. 当前风险

1. **运行中的旧后端**：用户当前 dev 环境（`127.0.0.1:8000` 后端、`5173` 前端）是 Phase 6 之前的代码。Phase 6 的新端点（`/api/index/rebuild`、`/api/history/*`、`/api/drafts/recovery/restore`）与前端调用在新代码里，旧后端上会 404。**需执行 `.\scripts\stop.ps1` 后重新 `start.ps1`（或重启 dev）才能生效。**
2. **沙箱环境 esbuild 转译限制**：本环境 `npm run build` 完整构建失败（大 chunk 转译时 esbuild.exe 清理临时文件被拒，疑似 Defender/文件锁），绕过参数可构建。用户本机构建是否受影响需实机确认；若复现，可考虑 `build.target: 'esnext'` + terser minify 或升级 esbuild。
3. **快照累积**：频繁自动保存会产生较多快照文件（上限 30 份自动修剪）。快照目录不在索引范围，不影响搜索；长期使用建议纳入「存储占用」观察。
4. **快照时间戳为本地时间**：跨时区迁移工作区后，文件名排序仍正确（按名称），显示时间按浏览器时区渲染，无一致性问题但语义上是「本机保存时刻」。
5. **大文档打开仍为一次全量解析**：50KB 目标内无感；超大文档（>1MB）打开瞬间解析耗时可能超 100ms（打开路径，非输入路径）。如 Phase 7 需要可做异步分块解析。
6. **删除文档不产生快照**：规格未要求；删除操作仍不可通过历史版本恢复（恢复端点要求文档存在）。如需要可在 Phase 7 评估「回收站」式方案。

---

## 7. Phase 7（Tauri 桌面化）前建议

1. **先实机验证构建**：在用户本机执行 `cd frontend && npm run build`，确认 esbuild 转译限制是否为沙箱特有；同时验证 `stop.ps1` + `start.ps1` 重启后 Phase 6 功能完整可用。
2. **侧车进程方案已就绪**：后端为独立 uvicorn 进程 + `/api/health`（version/started_at）+ `runtime.json` 进程记录，Tauri 只需拉起/守护该进程（复用 start.ps1 的握手逻辑）。
3. **桌面端打包注意**：`workspace/` 必须随应用数据目录迁移（快照 `Drafts/backup`、恢复草稿 `Drafts/recovery`、索引 DB 均在工作区内）；建议 Tauri 安装时配置数据目录并做迁移引导。
4. **异常退出模拟测试**：Phase 7 集成测试建议覆盖「强杀后端进程」场景，验证恢复检测/恢复/丢弃全流程（后端端点已齐备）。
5. **性能后续项**：如桌面端面向超长文档，可将 `setKeContent` 改为分块异步解析；附件可视惰性渲染按需进行，当前 50KB 场景无需额外工作。
6. **索引/搜索增强可放 Phase 8**：FTS5 trigram 已满足中文搜索；Phase 6 明确禁止的 AI 搜索/向量库等如后续需要，可作独立阶段评估，不与桌面化耦合。
