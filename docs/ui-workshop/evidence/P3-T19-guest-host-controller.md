# P3-T19/A7 证据：guest 会话宿主控制器（U，4 例）

- 日期：2026-10-19 · 代码：`frontend/src/core/packs/guestHost.ts`（DOM-free，可单测）
  - `start(packId,version)`：读取 manifest → **T24 能力上限**（`capabilityCeilingFor`，空集=禁用）→
    PackageHost 启动受限会话 → `loadEntry` 读取真实 entry → 返回 `{session, entryHtml, assets, capabilities}`；
    会话状态变化经 adapter `reportSession` 落盘 `workshop-session-status.json`；
  - 心跳监控：guest 心跳（`heartbeat()`）后超时（默认 1200ms）自动 `host.reportCrash`；
  - `stop()`：PackageHost.stop + 持久化 stopped；崩溃/超限由 PackageHost deactivate/recover/safeMode；
  - 安全边界：本模块不接触 DOM；sandbox/隔离守卫由 UI 组件注入前执行（ADR-004）。
  - 测试 `guestHost.test.ts` 4 例（fake backend + fake timers）：
    trusted 启动（active/能力上限/entry/状态落盘）；community 能力不允许 → blocked 不启动；
    心跳超时 3 次 → suspended→suspended→failed + deactivate/recover/safeMode；
    未收到心跳不误报。
- 证据类型：**U（前端单测）**；产品 UI（iframe 注入/启用停用按钮）与 A7/A5 产品 W 未做

## 结论

- A7 的**会话控制层**就绪：启动/能力上限/真实入口/心跳崩溃检测/状态持久化/停止，均有单测覆盖；
- 剩余：`WorkshopGuestFrame` UI 薄封装（sandbox iframe + isolationGuard + postMessage wire +
  启用/停用按钮 + safeMode 禁用）、A7/A5 产品 W 探针。
