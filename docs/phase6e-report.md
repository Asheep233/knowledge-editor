# Phase 6E：发布前冻结审计与桌面化准备报告

> 阶段：6E | 日期：2026-08-09 | 基线版本：v0.6.0
> 范围：不新增用户功能；冻结检查、迁移测试、实机验证、版本统一、日志确认、侧车交接。

## 1. 冻结检查结果

### 1.1 文档冻结

| 文档 | 与代码一致性 | 结论 |
| --- | --- | --- |
| `docs/phase0-architecture.html` | 核心决策（Markdown 唯一事实源、SQLite 仅索引、ProseMirror 仅编辑态）与实现一致；5.3/5.4 节存在 6 处结构性差异（见 2.1） | 设计稿保留，差异以本文档为准 |
| `docs/document-format.md` | KE_KINDS（note/module/attach/video/footnote）、ke_version=1、字段顺序（note/attach/video/footnote）与 `ke.ts` 完全一致；module 字段表漏列 `source`（已修复，见 3.5） | 已修复后一致 |
| `docs/markdown-extension-spec.md` | 为 Phase 1 设计稿，与 document-format.md 冲突处按后者的"以当前实现为准"声明处理 | 一致（按既定裁决） |
| `README.md` | 阶段状态滞后（缺 Phase 6/6E），已更新 | 已修复后一致 |
| API 文档 | 无独立 API 文档；以 FastAPI OpenAPI 自动生成为准（`/docs`），端点清单见 1.4 | 一致 |

### 1.2 代码冻结

- 未发现 `print()` 调试输出（backend/app 全量 grep 零匹配）、未发现 TODO/FIXME/DEBUG 标记。
- 发现并清理死代码：`config.py` 的 `APP_VERSION` 死常量、`fs_watch.py` 的 `_is_indexed` 死函数、`import_export.py` 的 `tempfile` 未使用 import、`routers/__init__.py` 过时 `__all__`（详见第 2、3 节）。
- 发现并删除调试探针：`p2_empty_probe.mjs`、`probe-empty.test.ts`、`probe-editable.test.ts`（含 console.log 调试残留）。
- 保留项（合理预留，非死代码）：`db.py` 的 `get_setting/set_setting`（settings 表公开 API）、`convert/__init__.py`（Phase 1 占位模块，无实现）。

### 1.3 格式冻结

- Markdown 序列化：`ke.ts` 的 `KE_FIELD_ORDER`、`withFrontmatter/parseFrontmatter` 与 document-format.md 一致；module 附加 `source` 字段已补文档（3.5）。
- frontmatter：`ke_version: 1` 不变，字段顺序冻结。
- ke-* 扩展：KE_KINDS 五类 + footnotes 区域，与 tokenizers 的 `KE_KNOWN_KINDS` 一致。
- 快照格式：`Drafts/backup/{doc_rel}/{YYYYMMDD-HHMMSS-mmm}.md`（毫秒精度，保留 30 份）；草稿 `Drafts/recovery/*.draft.md`。本阶段未改动任何已有数据格式。

### 1.4 API 冻结

共 **42 个端点**，按 router 分组（方法/路径/返回要点）：

| 模块 | 端点 |
| --- | --- |
| workspace | POST `/api/workspace/init`、`create`、`open`、`close`；GET `info`、`current`、`recent`、`recent-documents`；DELETE `recent`、`recent-documents`；POST `recent-documents` |
| documents | GET `/api/tree`、`/api/articles`、`/api/articles/{id}`；POST `/api/articles`；PUT `/api/articles/{id}`、`{id}/meta`；DELETE `/api/articles/{id}` |
| modules | GET `/api/modules`、`/api/modules/{path}` |
| attachments | GET `/api/attachments/list`、`orphans`、`{rel_path}`；POST `/api/attachments` |
| search | GET `/api/search?q=&limit=` |
| tags | GET `/api/tags`、`/api/tags/{tag}` |
| drafts | GET/POST `/api/drafts/recovery`；DELETE `/api/drafts/recovery/{doc}`；POST `/api/drafts/recovery/restore` |
| history | GET `/api/history/list`、`preview`；POST `/api/history/restore` |
| index | POST `/api/index/rebuild` |
| fs | POST `/api/fs/dir`、`doc`、`move`；PUT `/api/fs/dir`、`doc`；DELETE `/api/fs/dir`；GET `/api/fs/events` |
| import_export | POST `/api/import/markdown`、`import/package`、`export/package` |
| health | GET `/api/health` |

- 请求/返回格式经 `routers/` 全量核查，与前端 client.ts 封装一致；`ArticleOut`、`HistoryVersion`、`RecoveryItem` 等类型已冻结。
- API 无显式版本前缀（`/api/*`），以 v1 语义冻结；Tauri 侧车调用须保持此清单不变。

### 1.5 数据结构冻结

- SQLite（`workspace/.knowledgeeditor/index.db`）：`files`（含 v2 的 `kind`/`meta` 列）、`files_fts`（FTS5 trigram 五列，schema v2）、`settings`、`recovery`。与架构文档的差异已在 2.1 记录，schema 本身冻结。
- workspace 目录：`Articles/`、`Modules/`、`Attachments/{images,videos,files}`、`Drafts/{backup,recovery}`、`.knowledgeeditor/{index.db,settings.json,runtime/}`。
- runtime 文件：`runtime/runtime.json`（`{backend:{pid,port,started_at,version}, frontend:{pid,port,started_at}, project_version, started_at}`）+ `runtime/logs/` 四日志。由 `start.ps1` 维护，backend 不读写。

### 1.6 版本策略

- 唯一版本源：`backend/app/__init__.py` 的 `__version__` → health API → start.ps1 校验 → runtime.json。
- 前端运行版本 `frontend/src/version.ts` 与之人工同步；`npm run build` 产物包版本同步。
- 数据格式版本独立：`ke_version = 1`（Markdown 扩展）、`settings.schema_version = 1`、`_FTS_SCHEMA_VERSION = 2`。

## 2. 发现的问题

| # | 严重度 | 问题 | 位置 |
| --- | --- | --- | --- |
| P1 | 高 | **恢复点登记链路缺失**：`registerRecovery` 客户端封装存在但零调用，前端保存动作（自动保存/手动保存）均未登记恢复点，与 Phase 6.2 契约"保存先登记、成功后清除"不符 | `client.ts:376`、`EditorArea.tsx` |
| P2 | 中 | `config.py` 的 `APP_VERSION = "0.1.0"` 死常量与真实版本 0.5.0 漂移（发布前必须消除） | `config.py:12` |
| P3 | 中 | 调试探针与临时产物：`p2_empty_probe.mjs`（520B）、`probe-empty.test.ts`（含 console.log）、`probe-editable.test.ts`；`.tmp-esbuild/`（10MB）未被 .gitignore 覆盖 | `frontend/` 根、`src/editor/` |
| P4 | 中 | `routers/__init__.py` 的 `__all__` 漏 5 个模块（fs/history/import_export/index/tags） | `routers/__init__.py` |
| P5 | 低 | `fs_watch.py` `_is_indexed` 死函数、`import_export.py` 未使用 `tempfile` import | 见左 |
| P6 | 低 | 文档与代码差异：架构文档未同步 `kind`/`meta` 列、files_fts v2 五列、recovery 主键结构、`.knowledgeeditor/runtime/` 目录、Drafts/backup 实际命名；`document-format.md` module 字段漏 `source` | `phase0-architecture.html`、`document-format.md:51` |
| P7 | 低 | App 顶栏徽章 "Phase 4" 滞后 | `App.tsx:337` |
| P8 | 低 | `clearRecentDocuments` 封装无调用方（LeftSidebar 裸 fetch 绕过） | `client.ts:115`、`LeftSidebar.tsx:427` |
| P9 | 信息 | `ke.ts:72` 与 `client.ts:197` 存在两个同名不同实现的 `attachmentUrl`（ke.ts 版不做 URI 编码） | 见左 |
| P10 | 信息 | `package.json` 无 test 脚本；`dist/` 残留多轮构建产物 | `package.json` |

## 3. 修复内容

| # | 修复 | 验证 |
| --- | --- | --- |
| 3.1 | 恢复点登记接入保存链路：`EditorArea.tsx` 新增 `registerRecoveryPoint`/`clearRecoveryPoint`，接入自动保存（3s 防抖）与手动保存（Ctrl+S/按钮）两路径——保存前登记草稿、成功后幂等清除；登记/清除失败不阻断保存主流程 | tsc -b 通过；构建通过 |
| 3.2 | 删除 `config.py` 的 `APP_VERSION` 死常量，版本唯一来源注释说明 | pytest 99 项全过 |
| 3.3 | 删除调试探针 `p2_empty_probe.mjs`、`probe-empty.test.ts`、`probe-editable.test.ts`；`.gitignore` 增加 `.tmp-esbuild/` 规则（沙箱安全策略限制物理删除该目录，已通过忽略规则解决版本控制问题） | 文件删除确认 |
| 3.4 | `routers/__init__.py` `__all__` 补全 12 个模块；删除 `_is_indexed` 死函数与 `tempfile` 未使用 import | pytest 全过 |
| 3.5 | `document-format.md` module 字段表补 `source`；`App.tsx` 徽章 "Phase 4" → "Phase 6" | 文档/代码核查 |
| 3.6 | `LeftSidebar.tsx` 改用 `clearRecentDocuments` 封装（消除裸 fetch） | tsc 通过 |
| 3.7 | 版本统一 v0.6.0：`__init__.py`、`version.ts`、`package.json`、`package-lock.json` 四处同步；runtime.json 由启动脚本自动刷新为 0.6.0 | 实机 health 验证 |

未修复（记录在案）：P9 重复 `attachmentUrl`（行为差异小，Tauri 阶段合并）；P10 测试脚本入口（Phase 7 前补）；P6 架构文档 HTML 不直接改写，差异以本文档为冻结基线。

## 4. 迁移测试结果（6E.2）

方法：将 `workspace/` 完整复制（28 文件，含 `.knowledgeeditor` 内部数据）至新绝对路径，以 `KE_WORKSPACE` 指向新位置启动 backend（独立端口 5177），14 项冒烟断言**全部通过**：

- health 显示 workspace 指向新位置 ✓
- 文档列表与打开 ✓（含中文文件名文档）
- 附件列表含图片且图片可读（HTTP 200）✓；视频目录存在 ✓
- 模块列表 ✓
- 历史版本快照随迁移保留（`phase2-e2e-232018.md` 3 份快照）且预览可读 ✓
- 索引重建成功、搜索命中迁移文档 ✓

**结论：workspace 不依赖原绝对路径**（索引存 rel_path 相对路径），Markdown-first 架构迁移安全。

## 5. 实机测试结果（6E.3）

在用户本机按正式流程执行：

1. **frontend 构建**：`npm run build` 中 `tsc -b` 通过（修复 3.1 引入的 TDZ 依赖序问题后零错误）；完整 vite build 在本环境沙箱的 esbuild 临时文件清理阶段失败（`Access is denied`，环境限制非代码问题）；以 `--minify false --target esnext` 参数构建成功（130 模块）。
2. **stop.ps1**：停止旧 backend（PID 21880）/ frontend（PID 68012），释放 8000/5173，清理 runtime.json ✓。
3. **start.ps1**：环境检查全过 → backend 就绪（health ok，version=**0.6.0**）→ frontend 启动（PID 37280，http://localhost:5173）→ runtime.json 写入 ✓。
4. **功能冒烟 7 项全过**：health v0.6.0、frontend 页面 200、`POST /api/index/rebuild`、`GET /api/history/list`、`POST /api/drafts/recovery/restore`（无记录 404 正常）、`GET /api/search`、`GET /api/drafts/recovery`。

**结论：用户本机已运行 v0.6.0 最新代码，Phase 6 功能可用。** 注意：frontend 为 vite dev 模式（start.ps1 默认），源码即最新。

## 6. 当前版本号（6E.4）

| 项目 | 版本 | 说明 |
| --- | --- | --- |
| 应用版本 | **v0.6.0** | Phase 6 完成冻结基线；唯一来源 `backend/app/__init__.py` |
| Markdown 扩展版本 | ke_version = 1 | 数据格式不变 |
| API 版本 | v1（无前缀） | 42 端点冻结清单见 1.4 |
| settings schema | 1 | 不变 |
| FTS schema | 2 | 不变 |

版本策略：建议后续里程碑按 v0.x.0 递增；进入 Tauri 正式发布前再评估 v1.0.0。已确认未修改任何已有数据格式。

## 7. 日志系统确认（6E.5）

| 场景 | 现状 |
| --- | --- |
| backend 异常输出 | uvicorn stdout/stderr 重定向至 `runtime/logs/backend.log` / `backend.err.log`（start.ps1 L152-159） |
| frontend 错误提示 | 打开/新建/导入失败均有 `console.error` + 用户可见提示（App.tsx L165/269/288） |
| 启动失败信息 | start.ps1 环境检查不静默失败，明确中止并输出原因（如依赖缺失提示） |
| frontend 日志文件 | `runtime/logs/frontend.log` / `frontend.err.log`（vite dev 输出） |

按规格：本阶段不开发完整用户日志系统；错误追踪能力已确认满足发布前要求，完整日志体系（滚动、分级、Tauri 端汇总）放入 Phase 7。

## 8. Phase 7 注意事项（含 6E.6 侧车进程方案交接）

### 8.1 侧车进程方案（6E.6）

已具备的前置能力：

- 独立 FastAPI backend（`backend/app/main.py`），与前端解耦，可独立 `uvicorn app.main:app` 启动。
- `/api/health` 返回 `{status, app, version, started_at, workspace, python_ready}` —— Tauri 侧车就绪探针。
- `runtime.json` PID/端口/版本/启动时间管理（start.ps1 维护），Tauri 可复用该约定。
- backend 配置全部走环境变量：`KE_WORKSPACE`、`KE_PORT`（config.py），侧车注入方便。

Tauri 启动 backend 流程（Phase 7 实施建议）：

1. **拉起 backend**：`spawn`（或 sidecar）启动 `backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port {KE_PORT}`，cwd 指向 `backend/`，注入 `KE_WORKSPACE` 与 `KE_PORT` 环境变量。
2. **等待 health**：轮询 `GET http://127.0.0.1:{KE_PORT}/api/health`，超时（建议 30s）后重试或报错退出；以 `status=ok` 且 `version` 匹配前端版本为就绪条件。
3. **启动 frontend 界面**：Tauri 的 WebView 直接加载前端资源（v0.6.0 构建产物或 dev server URL），`/api` 请求经代理/直连到 backend 端口。
4. **关闭应用时回收进程**：按 runtime.json 记录（或进程句柄）先终止 backend（优雅：发 `SIGTERM`/`taskkill`，等待退出），再关闭 WebView；异常退出时利用 recovery 机制（Drafts/recovery）兜底。

### 8.2 进入 Phase 7 前的注意事项

1. 用户本机 `npm run build` 需在真实环境复验（本环境沙箱 esbuild 临时文件清理受限，构建已用替代参数验证通过）。
2. 前端缺测试运行入口（package.json 无 test 脚本），建议 Phase 7 前补 `vitest run` 并纳入 CI。
3. `ke.ts` 与 `client.ts` 重复的 `attachmentUrl` 建议在侧车封装时合并（行为差异：URI 编码）。
4. 大文档打开解析仍为同步（超长文档建议异步解析，Phase 8 项）。
5. 快照累积：每文档保留 30 份，长期使用注意磁盘占用（可在 Tauri 阶段提供清理入口）。
6. 本地时间戳：快照/草稿文件名基于本机时间，迁移/备份多机场景以文件内容为准。
7. Tauri 侧车需自带 Python 运行时或嵌入打包方案（当前依赖本机 venv），是 Phase 7 最大工程点。
8. 数据目录建议：Tauri 版将 workspace 根迁移到用户数据目录（如 `%APPDATA%`），沿用 6E.2 验证过的整体搬迁方案即可。
