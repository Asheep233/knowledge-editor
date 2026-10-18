# P3-T19/A7 证据：guest 宿主 UI（WorkshopGuestFrame）+ 工坊面板集成（2 例 U）

- 日期：2026-10-19 · 代码：
  - `frontend/src/components/workshop/WorkshopGuestFrame.tsx`：
    - 「启用 guest」：GuestSessionHost 启动（能力上限/真实 entry）→ sandbox iframe（`allow-scripts`，
      不透明 origin）注入 entry → 心跳 postMessage 监听（`guest-heartbeat` → host.heartbeat()）；
    - 隔离守卫：父窗口尝试访问 iframe document（跨域应抛异常）；若可访问且暴露 Tauri globals →
      `E_ISOLATION` 并停止；
    - 状态 UI：guest 状态/能力列表/safeMode 横幅；「停用 guest」；状态经 adapter 落盘；
  - `tauriPackAdapter` 新增 `createGuestBackend()`（A7 产品命令后端工厂）；`WorkshopPanel` 在
    已激活包行内渲染 guest 宿主（有工厂时）；
  - 测试 `WorkshopGuestFrame.test.tsx` 2 例：community 能力不允许 → 错误/无 iframe/failed；
    trusted 启用 → active + 能力显示 + iframe 渲染；
- 证据类型：**U（组件测试 + tsc）**；产品 W（真实产品壳启用/崩溃/safeMode/停用持久化）未做

## 结论

- A7 的 **UI 层最小闭环**落地：工坊面板可启用/停用 guest，能力上限/真实 entry/隔离守卫/心跳
  状态可见；
- 剩余：A7/A5 产品 W 探针（真实产品壳 + CDP：启用→active→能力子集→移除 iframe→自动 suspended→
  超限 failed+safeMode→停用持久化；越权方法 E_CAPABILITY）；协议消息线（broker dispatcher 完整接线）
  与 guest SDK 打包在后续。
