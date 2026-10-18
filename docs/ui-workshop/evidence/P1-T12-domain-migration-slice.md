# P1-T12 证据：只读域迁移切片 — tree/search 绑定 WorkspaceContext（真实后端）

- 日期：2026-10-19 · 代码（产品后端，增量接口；既有全局端点行为不变）：
  - `backend/app/services/context_registry.py`：新增上下文绑定只读域
    `tree(ctx, epoch)`（`Articles/**.md` → rel_path/size）与
    `search(ctx, epoch, query, limit)`（有界扫描，snippet 摘要；产品级 FTS/indexer 绑定见后续）；
    两者均经 `_require_bound` 校验 context/epoch（切库后旧连接拒绝）。
  - `backend/app/routers/context.py`：`POST /api/context/tree`、`POST /api/context/search`
    + `ContextTreeReq` / `ContextSearchReq`。
  - `backend/tests/test_ui_workshop_context_domains.py`：5 例
- 契约显式更新（只做加法）：OpenAPI 48→**50 路径**、60→**62 方法**、+2 schema
  （`test_openapi_snapshot.py` + `test_trash_verify.py` 均记录「2026-10-19 T12 只读域切片」）
- 证据类型：**A（真实产品后端 API + pytest）**；非 Windows/WebView2 证据

## 测试结果

| 项 | 结果 |
| --- | --- |
| T12 新 5 例（tree/search 上下文隔离、epoch 过期 409、空查询 400/关闭 404、旧全局端点不受影响） | **5 passed** |
| OpenAPI 快照（50 路径 / 62 方法 / +2 schema） | passed |
| trash 契约完整性（只做加法校验，含 T12 增量） | passed |
| 后端全量 pytest（WSL Python 3.14） | **840 collected，exit 0** |
| 后端全量 pytest（Windows Python 3.10，CI venv） | **exit 0** |

## 结论

- T12 分域迁移的**第一刀（只读域）** 落地：同一相对路径在两个 context 下 tree/search 完全隔离；
  旧 epoch 请求被 409 拒绝；旧 App 的全局 `/api/tree` 等端点保持可用（**未隐藏旧 App、未破坏现有功能**）。
- 尚未完成（T12 继续）：
  1. 写域（articles/doc create/rename/delete/attachments/import/export/print job）逐域绑定；
  2. 真实 store/indexer/history/watcher 生命周期迁移（当前 tree/search 为切片实现，非产品 FTS）；
  3. 前端调用从全局端点切到上下文端点（T13/T14 接线）；旧端点按阶段标记 deprecated 后移除。
