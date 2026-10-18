# P1-T13 证据：Core 门槛 — 无旧 App/EditorArea/UI 框架的端到端门禁（21/21 PASS）

- 日期：2026-10-19 · 代码：
  - 门禁脚本：`docs/ui-workshop/core/gate/t13_gate.ts` + `run_t13_gate.sh`
    （**纯 Node，无 React/DOM/happy-dom**；esbuild 打包真实 Core 模块）
  - 驱动真实产品后端（隔离 uvicorn + 临时工作区，随机端口）
  - 覆盖真实 Core：`SaveCoordinator` / `HttpTransport` / `RecoveryJournal`
- 原始结果：`evidence/T13-core-gate-results.json` · 证据类型：**A（真实后端 + Core 代码，UI-free）**

## 实测结果：**21/21 PASS**

| 组 | 检查 |
| --- | --- |
| 工作区 | 打开 A（create/open）、打开 B（隔离） |
| 快照 | 上下文 A epoch=1；可信快照 revision=0 + disk hash |
| 保存 | Core SaveCoordinator 保存成功（file_durable）；**真实文件落盘**；journal 已提交 |
| 崩溃/abort | abort 后状态 dirty（不假设失败）；**恢复日志保留**；重试保存成功且内容最终落盘；成功后恢复日志被提交/清理 |
| 只读域 | `/api/context/tree` 返回 demo 文档；`/api/context/search` 命中上下文内容 |
| 切库 | 打开 ctx-B 后 switch A → **旧 epoch 保存 stale_context**；新 epoch 可继续保存 |
| 关闭协调 | 有租约时关闭 409；租约释放后关闭成功；关闭后旧上下文读取 404 |

未覆盖（显式记录，不冒充通过）：单实例/退出协调（Rust 主壳）、打印 job 与取消（T16）、
Rust 原生恢复（T20/T24）、恶意包/故障场景（T18 W 探针已部分覆盖）。

## 本轮附带修复（Core 质量）

- 发现并修复 SaveCoordinator 恢复日志的「重试残留」缺陷：abort 后重试保存成功时，旧的同文档恢复记录
  不被清理 → 现在保存成功会提交当前记录并清理同文档旧记录（`journal.pending(relPath)` 全部提交）。
- 新增单测：abort 后重试成功 → journal 无残留、持久化层清空；Core 会话层测试 **23 passed**，tsc 0。

## 结论

- T13 的**核心闭环**（打开→快照→编辑保存→abort 恢复→切库屏障→租约关闭）在**无 UI** 条件下由真实
  Core+后端完成并可自动执行，符合「Core 服务能直接测试，不依赖 UI 测试框架」的要求。
- T13 仍 `in_progress`：待补单实例/退出协调（Rust 主壳）、打印 job（T16）、Rust 原生恢复（T20），
  以及恶意/故障场景与产品工作区打开流程的合并验证；随后可给 P1 阶段报告与 `P1_READY` 口径。
