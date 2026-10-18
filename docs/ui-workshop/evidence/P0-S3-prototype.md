# P0-S3 原型证据：可信快照 → 恢复/保存链 + WorkspaceContext/CAS（T04 部分）

- 日期：2026-10-19
- 代码：`docs/ui-workshop/prototypes/p0/s3_save/store.py`（无 UI；纯 Python 标准库）
- 测试：`test_s3.py`（10 例）；演示：`run_demo.py`
- 平台证据：**U（逻辑）**；Linux WSL 与 **Windows Python 3.14（NTFS）** 双平台实测
- 未验证：真实 FastAPI 服务端接入（T09 移植）、真实客户端网络中断/HTTP abort 时序、真实 Tauri UI 切包（W02–W03）

## 覆盖语义与用例

| 语义 | 用例 |
| --- | --- |
| 可信快照（全文 + revision + 磁盘指纹） | `test_snapshot_save_chain`：保存返回 `accepted/recovery_durable/file_durable` 三阶段，只有 file_durable 才算已保存 |
| revision CAS（旧 revision 不覆盖新内容） | `test_stale_revision_rejected` |
| 外部改盘检测（指纹冲突，不覆盖外部内容） | `test_external_modification_rejected` |
| 租约/epoch（切库后旧 UI 迟到写被拒） | `test_stale_lease_after_switch_rejected` |
| 两工作区同相对路径隔离（内容/结果/索引不串） | `test_two_workspaces_same_rel_path_isolated` |
| requestId 幂等 + `query_result`（abort/超时后可查真实结果） | `test_idempotent_request_id` + 快照保存用例中的 query |
| 崩溃恢复：恢复日志后崩溃 → 恢复草稿补齐 | `test_crash_after_recovery_log_recovers_draft`（子进程 `os._exit(98)`） |
| 崩溃恢复：正文写入后、状态提交前 → 判定已提交 | `test_crash_after_file_write_recovers_committed` |
| 崩溃恢复：提交后 → 无恢复日志、无重复写 | `test_crash_after_commit_record_is_clean` |
| 崩溃 + 外部更新：恢复不得覆盖外部新内容 | `test_crash_then_external_change_keeps_external` |

## 运行记录（2026-10-19）

```text
# Linux WSL
$ python3 -m pytest docs/ui-workshop/prototypes/p0/s3_save/test_s3.py -q
..........                                                               [100%]
10 passed in 1.50s

$ python3 docs/ui-workshop/prototypes/p0/s3_save/run_demo.py
snapshot: Articles/note.md rev= 0 hash= 13970ecc3d25
save: completed rev= 1 file_durable= True
stale revision save: conflict_revision -> 目标 revision 0 已过期（当前 1）
external conflict: conflict_external disk= b'external edit'
late write after switch: stale_context
ws2 disk（不应被 ws1 影响）: b'ws2: other'
OK: 快照/CAS/外部冲突/切库隔离 语义演示完成

# Windows Python 3.14（NTFS）
> python.exe -m pytest docs\ui-workshop\prototypes\p0\s3_save\test_s3.py -q
..........                                                               [100%]
10 passed in 0.89s
```

## 结论与缺口

- 结论：保存垂直切片的核心语义（可信快照、CAS、外部指纹冲突、切库隔离、迟到写拒绝、requestId 幂等/结果查询、崩溃三阶段恢复）在原型的逻辑与文件系统层成立，Linux + Windows 双平台通过。
- T04 仍未 `passed`：需移植到真实 FastAPI 后端（WorkspaceContext/租约/幂等表/T09）与真实 Core/DocumentSession（T10），并在真实 UI 下注入迟到请求/abort/外部改盘（W02、F07–F08）。
