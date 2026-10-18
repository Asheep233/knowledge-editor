# P3-T19/A7 证据：产品 guest 宿主适配器 + 会话状态命令（U，cargo 41 / frontend 7 例）

- 日期：2026-10-19 · 代码：
  - 产品 Rust `pack_store.rs`：`workshop_pack_session_status`/`workshop_pack_session_report`
    （状态枚举校验 idle/starting/active/suspended/failed/stopped；packId safe_rel 校验；原子写
    `workshop-session-status.json`；单测 roundtrip + 非法状态/路径拒绝）→ cargo **41 passed**；
  - 前端 `core/packs/productHostAdapter.ts`：
    - `PackageHostBackend` 产品实现（verify/readManifest/deactivate/recover 映射真实命令）；
    - `loadEntry`：从已安装包读取 entry + css/js（`{{STYLE}}`/`{{SCRIPT}}` 注入或追加），缺失可选资产
      不阻断；
    - `sessionStatus/reportSession` 映射（供工坊 UI/诊断/恢复读取）；
    - `isolationGuard`：ADR-004 隔离守卫（guest 可访问 Tauri globals → E_ISOLATION 禁用）；
    - `capabilityCeilingFor`：T24 信任等级 ∩ manifest → 运行期能力上限（不允许则空集=禁用包）；
  - 测试 `productHostAdapter.test.ts` 7 例（mock invoke）：manifest 校验/命令映射/entry 注入/
    会话状态/隔离守卫/能力上限/无 DOM 守卫。
- 证据类型：**U（产品 Rust 单测 + 前端单测）**；产品 UI 宿主组件与 A7 产品 W 未做（ADR-004 步骤 4-5）

## 结论

- A7 的**数据/命令层**就绪：真实 entry 读取、PackageHost 后端映射、会话状态持久化、隔离守卫判定、
  能力上限计算；
- 剩余：前端 iframe 心跳宿主组件（启用/停用 UI、safeMode 禁用）、A7/A5 产品 W 探针（CDP）。
