# P1-T10 证据：常驻 Core / SaveCoordinator 无 UI 垂直切片

- 日期：2026-10-19 · 代码（**产品仓库内新增 Core 会话层，无 React/DOM 依赖**）：
  - `frontend/src/core/session/types.ts`：类型化边界（ContextBinding / DocumentSnapshot / SaveStatus /
    WriteRequest / WriteResult / SaveTransport）
  - `frontend/src/core/session/saveCoordinator.ts`：SaveCoordinator（快照绑定、O(1) 标脏、save、reconcile、
    switchContext、迟到响应丢弃）
  - `frontend/src/core/session/memoryTransport.ts`：确定性故障注入测试替身
  - `frontend/src/core/session/saveCoordinator.test.ts`：9 例
- 证据类型：**U（逻辑单测 + 源码守卫）**；不是 Windows/WebView2 证据，也尚未接入真实 HTTP/UI

## 测试结果

```text
$ npx vitest run src/core/session/saveCoordinator.test.ts
Test Files  1 passed (1)
     Tests  9 passed (9)
$ npx tsc -b --noEmit
TSC_EXIT=0
```

| 用例 | 验证语义 |
| --- | --- |
| 保存成功 | 请求携带快照 revision/content；结果 file_durable=true 才 `saved` 且 revision 推进 |
| accepted/recovery_durable 无 file_durable | **不得报告 saved**（三阶段语义） |
| 未绑定/epoch<=0 | 本地 `stale_context`，不发请求（切库屏障） |
| revision 冲突 | `conflict_revision`，保留本地 dirty 内容与旧 revision |
| 外部改盘冲突 | `conflict_external`，不覆盖快照 revision |
| abort/超时 | `dirty` 且保留 requestId；`reconcile` 查到服务端 completed → `saved`（不假设失败） |
| 切库后迟到响应 | 旧 ctx-A 结果被标记 stale 并丢弃，新 ctx-B 状态不被污染 |
| recordEdit | 只标脏、零 transport 调用（不广播全文） |
| DOM/React 守卫 | `types/saveCoordinator/memoryTransport` 源码无 `document`/`window`/`react` 依赖 |

## 结论

- T10 的第一步（**常驻 App/DocumentSession 与 SaveCoordinator 的无 UI 逻辑边界**）成立：
  快照/revision/三阶段/abort 结果查询/切库迟到响应/冲突语义均有确定性单测覆盖，且 src 可被
  Tauri/WebView 官方 UI 与 guest shell 两侧共用（不依赖 React/DOM）。
- 尚未完成（T10 继续）：
  1. 真实 HTTP Transport（对接 T09 `/api/context/*`）与集成测试；
  2. 恢复点/恢复日志的持久化写入与「recovery_durable」真实判定（当前由 WriteResult 标志表示）；
  3. 与真实文档加载/切换（workspace 切换、外部改盘 watcher）接线，删除/替换旧 `useKeEditor`
     保存回调路径（T14/T15）；
  4. 索引/history 更新绑定（T12 分域）。
