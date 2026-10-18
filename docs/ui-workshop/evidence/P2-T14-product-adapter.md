# P2-T14 证据：Core SaveCoordinator ↔ 既有产品 UI 适配层（无 React 测试）

- 日期：2026-10-19 · 代码（产品仓库内 Core 适配层，无 DOM/React 依赖）：
  - `frontend/src/core/session/productAdapter.ts`：
    - `createCoreSaveFn(coordinator, relPath)` → 产品既有 `SaveFn = (signal?) => Promise<unknown>`
      （`state/saveQueue.ts` 类型）：**仅 file_durable 才 resolve**；revision/外部冲突/失败抛类型化
      `CoreSaveError{code,status}`（旧 UI 的 dirty/错误提示可继续使用）；AbortSignal 已取消 → AbortError 且不发请求。
    - `createEditHook`：旧编辑器 onUpdate(content) → Core `recordEdit`（O(1) 标脏，不广播全文）。
    - `createSaveStateReporter`：`SaveCoordinator.subscribe` → 旧 UI 回调 saving/saved/conflict/error
      （保存状态条）；返回取消订阅。
    - `switchDocument` / `hasDirtyDocument`：切档登记新可信快照、切档前 flush 判定。
  - `SaveCoordinator` 新增 `subscribe(listener)`（状态订阅；构造期 `onStateChange` 保留兼容）。
  - `productAdapter.test.ts` 6 例（**不依赖 React 测试框架**，Node/vitest 直接测）
- 证据类型：**U（Core 适配层单测）**；尚未接线真实 EditorArea/SaveQueue（T14 后续），无 Windows/WebView2 W 证据

## 测试结果

```text
$ npx vitest run src/core/session
Tests  29 passed (29)     # 含新增 adapter 6 例
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证语义 |
| --- | --- |
| 产品 SaveFn 成功 | 仅 saved 后 resolve，并返回 revision（旧 UI 可推进保存状态） |
| 产品 SaveFn 冲突 | 抛 `CoreSaveError{code:E_CONFLICT,status:conflict_revision}`（旧 UI dirty 保持） |
| AbortSignal 已取消 | 抛 AbortError，且**不发保存请求** |
| 状态回调 | saving → saved:1（旧 UI 状态条可用） |
| 切档/dirty | 新档快照登记、dirty 判定（切档前 flush 依据） |
| DOM/React 守卫 | 适配层源码无 `document.`/`window.`/react 依赖 |

## 结论

- T14 的**适配器边界**成立：现有产品 UI 的 `SaveFn`/`onUpdate`/保存状态指示可以在不改旧组件的前提下
  逐步切换到 Core 保存语义（快照 revision/三阶段/abort/切档），且 Core 行为变化由 Node 测试覆盖
  （符合「无 React 测试可覆盖 Core 行为变化」）。
- 尚未完成（T14 继续）：
  1. 真实接线：`EditorArea`/`useKeEditor` 保存回调改用 `createCoreSaveFn`（需与真实后端上下文端点联调），
     旧 `saveQueue`/恢复点/源码直存链路的兼容与双写开关；
  2. 一致性：草稿/恢复点/外部改盘对话框与 Core 状态机合并；旧文档切换动画/flush 行为回归；
  3. T15：真实中文 IME/焦点/多 DPI/缩放 Windows 验收（与持续编辑面接线一起）。
