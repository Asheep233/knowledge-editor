# P1-T09 产品后端纵向切片证据：/api/context/*（上下文/租约/幂等/CAS）

- 日期：2026-10-19 · 代码（产品仓库内，**增量接口，不改既有端点行为**）：
  - `backend/app/services/context_registry.py`：WorkspaceContext 注册表/租约/快照/幂等 CAS 写入
  - `backend/app/routers/context.py`：`/api/context/*` 9 个端点（open/switch/current/close/lease/release/snapshot/write/request）
  - `backend/app/main.py`：include context router
  - `backend/tests/test_ui_workshop_context.py`：8 例
- 契约更新（显式评审，只做加法）：
  - `backend/tests/test_openapi_snapshot.py`：39→**48 路径**、51→**60 方法**、新增 6 个 Context* schema
    （模块 docstring 记录「2026-10-19 UI 工坊 T09 纵向切片」）
  - `backend/tests/test_trash_verify.py::TestOpenAPISnapshotIntegrity`：新增 `WORKSHOP_CONTEXT_PATHS/SCHEMAS`
    常量，把「恰好 trash +3」更新为「trash +3 ∪ T09 context +9」，既有 frozen schema 断言不弱化
- 证据类型：**A（真实产品后端 API + pytest）**；非 Windows 桌面/WebView2 证据

## 测试结果

| 项 | 结果 |
| --- | --- |
| `backend/tests/test_ui_workshop_context.py`（新 8 例） | **8 passed** |
| `test_openapi_snapshot.py`（路径/方法/schema 冻结） | passed（更新为 48 路径 / 60 方法 / +6 schema） |
| `test_trash_verify.py::TestOpenAPISnapshotIntegrity`（契约只做加法校验） | passed |
| 后端全量 pytest（WSL Python 3.14） | **835 collected，exit 0（全绿）** |
| 后端全量 pytest（Windows Python 3.10，CI 对齐 venv） | **exit 0（全绿）** |

新接口覆盖语义（测试一一对应）：
- open/current/switch（epoch+1）· 租约阻止 close（409→释放→200）·
  快照 revision=0 → CAS 写入 completed rev=1 + 文件内容 + requestId 结果查询 ·
  requestId 幂等（同 id 不重复写）· stale revision 冲突 / 外部改盘冲突（不覆盖）·
  旧 epoch 写入与快照均 409（切库屏障）· 两工作区同相对路径隔离 · `../` 路径穿越 400。

## 结论与缺口

- 结论：T09 的「上下文/epoch/租约/幂等/CAS/结果查询」在**真实产品后端**以增量接口落地并通过全量回归；
  既有 `/api/workspace/*`、`/api/articles/*` 等端点行为未改；OpenAPI 契约显式更新且可审计。
- 仍未完成（T09 继续 / T12 统一）：
  1. 注册表为进程内内存态：docs revision/幂等结果不持久化；重启语义待定（T10/T12）；
  2. 既有业务端点仍使用全局 workspace_root，未绑定 ContextRegistry；watcher/indexer/history/store
     生命周期、附件/导入/恢复/打印 job 的上下文绑定属于 T12 分域迁移；
  3. HTTP 客户端 abort 后的 in-flight 结果查询：当前写入同步完成，只有 completed/conflict；
     真实慢 I/O 需要 staged accepted→in_flight→completed 状态机（S3 原型已给出语义）；
  4. 前端尚未使用这些端点（T10 Core/SaveCoordinator 接入）。
