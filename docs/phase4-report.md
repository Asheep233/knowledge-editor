# Phase 4 报告：Workspace 与知识库管理

日期：2026-08-09

> 架构决策：规格 4.1 中示例目录名为 `Notes/`，经确认保留现有 `Articles/` 目录名（不迁移、不并存），其余结构（`Modules/`、`Attachments/{images,videos,files}/`、`.knowledgeeditor/`）与规格一致。

## 一、实现内容

Phase 4 共 8 个子阶段全部完成，后端 + 前端整体交付。

| 子阶段 | 内容 | 实现要点 |
| --- | --- | --- |
| 4.1 Workspace 管理 | 创建 / 打开 / 关闭 / 最近列表 / 启动恢复 | 结构自动补齐（缺目录自动创建）；workspace 状态存于 `app.state`，不依赖 SQLite 即可开关；最近列表存软件配置文件 `~/.knowledgeeditor/app_config.json` |
| 4.2 文件树管理 | 文件夹/文档 新建、删除、重命名、移动 | 真实文件系统操作；删除二次确认；受保护顶层（`.knowledgeeditor`、`Drafts`）拒绝；移动限同顶层目录内；删除绝不越出 workspace（`safe_rel_path` 防穿越） |
| 4.3 文件监听 | 外部修改检测 + UI 提示 | 轮询式 `FsWatcher`（1s）；内部写入标记抑制自身写入；前端兜底 2.5s 时间窗口；弹窗提供「重新加载外部版本 / 保留当前编辑内容」 |
| 4.4 搜索增强 | 文件名/路径/标题/frontmatter meta/标签 命中 + 摘要 | FTS5 v2 索引 5 列（title, rel_path, tags, meta, content），bm25 排序 + snippet；删除重建索引结果一致 |
| 4.5 标签系统 | frontmatter `tags` 解析 / 索引 / 筛选 / 列表 | 支持内联 `[a, b]` 与块列表两种写法；标签写入真实 frontmatter（非仅 SQLite）；`/api/tags` 列表 + 按标签筛选 |
| 4.6 元信息面板 | 标题、路径、创建/修改时间、字数、标签；frontmatter 元信息 | 标题/标签可编辑（PUT /meta 写回 frontmatter）；右侧面板「属性」标签；时间按 Windows `st_ctime`/`st_birthtime` 兼容取值 |
| 4.7 附件管理 | 全量列表（类型/大小/所属文档）+ 点击打开 + 孤儿检测展示 | 引用扫描 = 所有 Markdown 附件引用集合；孤儿 = 补集，仅展示（名称/路径/大小/修改时间），不自动删除 |
| 4.8 最近文档 | 最近打开列表 + 快速重新打开 | 存储于软件配置文件（不写入 Markdown）；去重 + 上限 20 条；侧栏「最近」区 + 清空 |

补充约束落实情况：workspace 切换/关闭均有未保存确认；移动仅改路径、不重写附件引用；监听器用内部写入标记排除自身写入；标签完整生命周期写 frontmatter；最近 workspace/文档同存一份软件配置；保留全量重建索引能力（`activate_workspace` 打开时全量 rebuild）。

## 二、修改文件列表

### 后端（新建 8，修改 6，新增测试 8 个文件）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `backend/app/services/app_config.py` | 新建 | `AppConfig`：最近 workspace（10）/最近文档（20）持久化，原子保存，损坏 JSON 回退 |
| `backend/app/services/fs_watch.py` | 新建 | `FsWatcher`：轮询快照（mtime_ns,size）、内部写入标记、`events_since(seq)` 增量游标 |
| `backend/app/routers/fs.py` | 新建 | 目录/文档增删改 + 移动 + `/api/fs/events` 监听事件 |
| `backend/app/routers/tags.py` | 新建 | `/api/tags` 列表与按标签筛选 |
| `backend/app/routers/workspace.py` | 重写 | create/open/close/current/info/recent/recent-documents + `activate_workspace`/`close_workspace` |
| `backend/app/routers/attachments.py` | 修改 | 列表（含 referenced_by）、孤儿检测（补集）、静态打开 |
| `backend/app/routers/documents.py` | 修改 | `ArticleOut` 扩展元信息字段；新增 `PUT /articles/{id}/meta`；写入标记 |
| `backend/app/routers/main.py` | 修改 | lifespan 装配 AppConfig+FsWatcher、`require_workspace` 中间件（未开 workspace 返回 409）、新路由注册 |
| `backend/app/config.py` | 修改 | 新增 `APP_CONFIG_PATH`（`KE_APP_CONFIG` 环境变量可覆盖，测试重定向） |
| `backend/app/services/markdown_io.py` | 修改 | frontmatter 块列表解析、`set_meta`（保留 body 字节）、`parse_tags`、`word_count`（CJK+拉丁）、`attachment_refs_in`、`safe_rel_path` |
| `backend/app/store/db.py` | 修改 | `meta` 列（ALTER 容错迁移）、FTS v2 五列索引 + 版本迁移、`list_by_tag`（json_each）、`list_tags`、`list_files(prefix)`、search 增强 + snippet |
| `backend/app/services/indexer.py` | 修改 | meta/tags 解析入库、`update_move`（按索引前缀迁移）、重建一致性 |
| `backend/tests/conftest.py` | 修改 | session 级 `KE_APP_CONFIG` 隔离 |
| `backend/tests/test_workspace_mgmt.py` 等 8 个 | 新建 | 见「四、测试结果」 |

### 前端（新建 5，修改 4）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `frontend/src/types.ts` | 重写 | WorkspaceState / FsEvent / TagInfo / AttachmentItem / OrphanItem / RecentDocument 等 |
| `frontend/src/api/client.ts` | 扩展 | workspace / fs / tags / meta / attachments / recent 全部 API |
| `frontend/src/utils/tree.ts` + `tree.test.ts` | 新建 | 文件树构建（文件夹优先 + 区域感知排序）+ 4 项单测 |
| `frontend/src/components/layout/WorkspacePicker.tsx` + css | 新建 | 首屏选择页（新建/打开/最近） |
| `frontend/src/components/layout/LeftSidebar.tsx` | 重写 | 最近文档/标签/文件树（右键菜单 + 二次确认删除/重命名/移动）/模块/附件 |
| `frontend/src/App.tsx` | 重写 | workspace 状态机、fs 事件轮询、外部修改弹窗、未保存确认、Phase 4 徽章 |
| `frontend/src/components/layout/EditorArea.tsx` | 修改 | 新增 `onSaved` 回调（保存成功时间戳兜底抑制） |
| `frontend/src/components/layout/RightPanel.tsx` | 重写 | 属性（元信息编辑）/ 附件（列表 + 孤儿检测） |

## 三、架构变化

```
启动
  └─ AppConfig（软件配置：recent workspaces/documents，独立于 workspace）
  └─ FsWatcher（轮询监听，内部写入标记抑制）
  └─ activate_workspace(default) → 补齐目录 → 打开 SQLite → 全量重建索引
       └─ app.state.{workspace_root, store, indexer, watcher}

API 访问
  ├─ require_workspace 中间件：workspace 未打开 → 全部 /api/* 返回 409（health/workspace 除外）
  ├─ /api/workspace/* ：创建/打开/关闭/当前/最近（切换时重建索引 + 重绑 app.state）
  ├─ /api/fs/* ：目录/文档 CRUD + 移动（真实文件系统，indexer.update_move 同步索引）
  ├─ /api/fs/events ：监听事件增量读取（前端 1.5s 轮询）
  ├─ /api/tags / /api/articles/{id}/meta / /api/attachments/*
  └─ 写入链路：保存 → mark_internal(rel) → watcher 抑制自身事件 → 前端 2.5s 兜底

数据一致性原则（延续 Phase 3 冻结格式）
  Markdown = 唯一事实源（标签/title/meta 全部写 frontmatter）
  SQLite = 仅索引（FTS5 v2：title/rel_path/tags/meta/content）
  移动/重命名 = 只改路径，不重写附件引用
  删除 = 索引同步清理，绝不越出 workspace
```

关键设计点：

1. **单 workspace 状态机**：`app.state` 重绑 + 打开时全量 rebuild，workspace 切换后搜索/标签/文件树结果全部一致（有测试覆盖）。
2. **自身写入抑制**：后端 `mark_internal`（mtime/size 匹配）+ 前端 `lastSavedAt` 2.5s 窗口双重保险，外部修改弹窗只对真正的第三方修改触发。
3. **FTS v2 向后兼容**：老库打开时 `ALTER TABLE` 容错加列 + FTS 版本检测自动重建，旧数据可迁移。
4. **孤儿检测纯展示**：`全部附件 - 被引用集合` 的补集，只读信息不触发删除。
5. **附件引用归一化**：`./Attachments/...` 前缀统一，网络/绝对路径忽略。

## 四、测试结果

| 验证项 | 结果 |
| --- | --- |
| 后端 pytest 全套 | **76/76 通过** |
| 前端 vitest 全套 | **42/42 通过**（原 38 + tree.test 4） |
| 前端 `tsc -b --noEmit` | 通过（0 错误） |
| 前端 `npm run build` | 构建成功（仅 chunk 体积提示，既有问题） |

新增后端测试（8 个文件，46 项新增）：

| 测试文件 | 覆盖 |
| --- | --- |
| `test_workspace_mgmt.py` | 结构创建/current/最近；拒绝非空目录；打开重建标签索引；关闭后 API 被 409 拦截；软件配置持久化/损坏回退；最近文档去重+清空 |
| `test_file_tree.py` | 文件夹/嵌套文档创建；文件夹重命名索引迁移；文档重命名/移动内容字节不变；跨顶层移动禁止；删除后索引清理 |
| `test_index_rebuild.py` | 从零重建后标签/搜索一致；meta 可搜索；v1 旧库自动迁移 |
| `test_fs_watch.py` | 外部修改事件；内部写入被抑制；created/deleted；rename 事件；`events_since` 游标；忽略 Drafts/.knowledgeeditor |
| `test_tags.py` | 内联/块列表解析；ke_version 整型；标签索引+列表+筛选；meta PUT 写入真实 frontmatter；标签移除 |
| `test_search_enhanced.py` | 文件名/路径/meta/标签命中；snippet 含关键词；短查询 LIKE 回退；删除重建后命中移除 |
| `test_delete_safety.py` | 路径穿越防护；受保护目录拒绝；递归删除索引清理；workspace 外文件不受影响 |
| `test_attachments_mgmt.py` | 列表 referenced_by；孤儿补集计算；引用归一化；网络/绝对路径忽略；打开附件 |

## 五、当前风险

1. **轮询式监听延迟**：外部修改最多 1.5s（前端轮询）+ 1s（watcher 间隔）才提示，非实时；对「保存竞态」已用双重抑制，但极端时序（外部修改与自身保存同刻）仍有极小概率误报。
2. **移动限制同顶层**：规格要求「移动只改路径、不重写附件引用」，故跨 `Articles/`↔`Modules/` 的移动被禁止（附件相对引用会失效）。后续如需支持，需引入引用重写策略。
3. **元信息编辑仅覆盖 title/tags**：`PUT /meta` 只写回这两个 frontmatter 字段，其余 meta 键值仅展示（面板只读 JSON），未提供通用键值编辑器。
4. **孤儿附件无自动清理**：仅信息展示，长期使用会产生未引用垃圾文件，需用户手动删除。
5. **`require_workspace` 409 语义**：workspace 未打开时前端首屏已拦截，但直接调 API（如 curl）会收到 409，属预期行为，文档需注明。
6. **软件配置路径依赖环境变量**：`KE_APP_CONFIG` 未设置时默认 `~/.knowledgeeditor/app_config.json`，多用户共用同一系统账户时配置共享（测试已用 env 隔离）。

## 六、下一阶段建议

1. **引用安全移动**：在「只改路径」基础上增加可选的「自动重写附件引用」模式（移动时扫描受影响 Markdown 并更新引用），由用户确认后执行。
2. **实时监听**：Windows 上引入 `ReadDirectoryChangesW` 或 watchdog，把轮询改为事件驱动，降低延迟与误报窗口。
3. **回收站化删除**：删除改为移入 `.knowledgeeditor/trash/` 而非直接删除，配合孤儿附件管理提供真正的可恢复删除。
4. **元信息通用编辑**：扩展 `PUT /meta` 支持任意 frontmatter 键值（白名单校验），面板提供键值对编辑器。
5. **最近文档分组**：最近列表按 workspace 分组展示，避免多 workspace 混用时的歧义。
