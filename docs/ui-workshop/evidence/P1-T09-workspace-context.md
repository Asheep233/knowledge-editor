# P1-T09 原型证据：WorkspaceContext / 租约 / 幂等与 CAS 写入一致性

- 日期：2026-10-19 · 代码：`docs/ui-workshop/core/workspace_context/app.py`（独立 FastAPI 原型，不改产品后端）
- 测试：`test_context.py`（10 例）· 平台：**Linux WSL Python 3.14：10 passed**；**Windows Python 3.10（CI 对齐 venv）：10 passed**
- 证据类型：**U+A（逻辑 + 独立 API 原型）**；不是产品后端集成，也不是 Windows 桌面/WebView2 证据

## 原型覆盖的语义（对应 ARCHITECTURE / T09）

| 语义 | 实现 | 测试 |
| --- | --- | --- |
| 上下文 `{id, epoch, root, docs, index, history}` | `Context` + `Manager` | 基础用例 |
| 切库 epoch 失效（旧 UI 迟到请求拒绝） | `switch()` epoch+1；写/读均校验 epoch | `test_switch_invalidates_old_epoch` |
| 服务端租约 + 关闭前排空 | `lease/release`；`close()` 有租约时 409 | `test_close_blocked_by_outstanding_lease` |
| 可信快照（revision + 磁盘指纹） | `snapshot()` / `/api/doc/read` | `test_snapshot_write_chain` |
| revision CAS + 外部改盘冲突 | `write()` 校验 expectedRevision 与磁盘 hash | `test_stale_revision_rejected`、`test_external_modification_rejected` |
| requestId 幂等 | 结果表命中直接返回，不重复写 | `test_idempotent_request_id` |
| 原子写 | tmp + `os.replace`，不留临时文件 | `test_snapshot_write_chain` 断言 glob 为空 |
| accepted / in_flight / completed 结果查询（abort/超时后可查真实结果） | 结果表 in_flight→completed | `test_request_result_queryable_while_in_flight` |
| 后台任务绑定发起时上下文（切库不串库） | `rebuild_index` 捕获 ctx_id，线程只改原 context | `test_background_task_binds_original_context` |
| 切库屏障：accepted 写入在提交前发现 epoch 失效 → 不落盘 | 写提交前二次校验 epoch | `test_switch_barrier_aborts_accepted_write_before_commit` |
| 两工作区同相对路径隔离 | 每 context 独立 root/docs | `test_two_workspaces_same_rel_path_isolation`（见测试文件） |

## 运行记录

```text
# Linux WSL
$ python3 -m pytest docs/ui-workshop/core/workspace_context/test_context.py -q
..........                                                               [100%]
10 passed, 1 warning in 1.64s

# Windows Python 3.10（CI 对齐 venv）
> python.exe -m pytest docs\ui-workshop\core\workspace_context\test_context.py -q
..........                                                               [100%]
10 passed, 1 warning in 1.65s
```

## 结论与缺口

- 结论：T09 要求的核心语义（context/epoch、租约排空、快照+revision CAS、磁盘指纹、requestId 幂等与结果查询、
  后台任务绑定上下文、切库屏障）在独立原型中成立，Linux + Windows 双平台测试通过。
- T09 仍未 `passed`：需要把上述机制**移植进产品后端**（`backend/app`）——
  真实 `WorkspaceContext` 需覆盖 store/indexer/history/watcher/store 生命周期、workspace 路由切换屏障、
  附件/导入/恢复/打印 job 的上下文绑定、HTTP abort 后的真实结果查询；并更新既有后端测试与 API 快照。
- 与 S3 原型的关系：S3 验证了保存链语义（DocumentSession 侧），T09 原型验证服务端绑定/幂等/CAS/屏障；
  两者将在 T10（Core/SaveCoordinator）+ 后端移植时合流。
