# ADR-004 产品侧包隔离宿主（T26/A7）：真实入口资源 + Core 会话装配

- 决策 ID / 日期：ADR-004 / 2026-10-19
- 目标：把原型已验证的「已安装包真实入口 + PackageHost/Broker 受限会话 + 心跳崩溃检测 +
  降级/safeMode」接入**产品壳**（A7），并支撑 A5 能力上限运行时验证。
- 关联证据：`P3-T19-pack-entry-probe.md`、`P3-T19-multiasset-heartbeat-probe.md`（原型 W 8/8 ×2）、
  `P0-S1-windows-probe-results.json`/ADR-001（iframe 暴露 Tauri globals 的发现）、
  `P3-T18-broker-probe.md`（能力/恶意 guest）、`P5-T26-A3-recover.md`（产品启动 safeMode）。

## 背景与既有发现

- 原型证明：**已安装包 entry 资源可真实加载**（`pack_read_asset` + 安装期哈希校验），
  PackageHost + Broker + HostDispatcher 能把 guest 限制在声明的能力内，心跳中断可自动检测崩溃
  并降级/safeMode（T19 W 8/8 ×2）。
- ADR-001 发现：**iframe 会继承父窗口的 `__TAURI_INTERNALS__`**，同源 iframe 可直接调用 app 命令。
  产品 guest 必须验证/规避该风险，不能只依赖「不暴露 API」。
- 产品已有：`pack_store`（安装/激活/回滚/recover/uninstall/验签/list/read_asset）、
  `print_snapshot`（隐藏 renderer）、启动 recover + safeMode 状态文件、工坊 UI（flag 关闭默认）。

## 决策

## 修订（2026-10-19，A7 首跑 W 发现）

**srcdoc 方案不可行**：产品 CSP `script-src 'self'` 会阻断 sandbox srcdoc 中的包内联脚本（心跳/协议全不执行）。
→ 采用**自定义协议 `workshop://`**：Rust 注册协议按 packId/version 解析已安装包文件（路径/大小限制），
iframe 以 `src=workshop://…` 加载（独立 origin、可设置包文档 CSP），sandbox 保持 `allow-scripts`；
隔离守卫改为校验 iframe origin + `__TAURI_INTERNALS__` 不可达。

1. **入口资源**：新增产品命令 `workshop_pack_read_asset(id, version, path)`（已实现）：
   - `safe_rel` 路径校验（禁止 `..`/绝对路径）、id/version 同样校验、5MB 上限、仅已安装目录；
   - 首版由产品宿主读取 entry HTML 后以 **sandbox iframe `allow-scripts`（srcdoc，不透明 origin）**
     注入；资产仍以安装期 sha256 校验为准（读取时不再重复哈希，T17 安装已保证不可变目录）。
2. **隔离防线（必须实测）**：产品宿主启动 guest 后执行**隔离守卫**——
   在 guest 上下文探测 `typeof window.__TAURI_INTERNALS__` / `typeof window.parent.__TAURI_INTERNALS__`；
   若 guest 能访问 Tauri globals → **不进入可用状态**，标记 `isolation-failed` 并禁用该包
   （回退方案：ADR-001 的独立 origin WebviewWindow / custom protocol 页面，后续实现）。
3. **会话装配**：复用 Core（`PackageHost`/`Broker`/`brokeredHandlers`/`HostDispatcher`）：
   - `PackageHostBackend` 由产品命令实现（readManifest=read_asset 解析或 list 数据、
     deactivate=`workshop_pack_*` 命令、recover=`workshop_pack_recover`）；
   - 会话连接能力 = `capabilityCeiling`（信任等级 ∩ manifest，T24）→ 即使 manifest 声明更多，
     guest 运行时也只能用到等级允许子集；
   - guest 侧必须使用 SDK `GuestClient`（版本化协议），消息只走 `postMessage` JSON 线（T11 结论：
     MessagePort 无法传入 opaque sandbox iframe）。
4. **崩溃与降级**：guest 每 200ms 心跳；宿主 >1200ms 无心跳 → `reportCrash('heartbeat timeout')`；
   崩溃策略沿用 PackageHost（suspended→超限 failed→deactivate+recover+safeMode），
   状态落盘 `workshop-session-status.json`（app data）供工坊 UI/诊断读取。
5. **产品 UX（flag 门控）**：新增 `VITE_KE_WORKSHOP_GUEST=1`（默认关闭）与工坊面板「启用/停用」
   按钮；safeMode 时禁用危险操作并提示修复；默认关闭保证旧行为零变化。
6. **测试与验收**：
   - Rust 单测：read_asset 路径/大小/未安装拒绝；命令注册；（T17/T21 已有安装/状态机覆盖）
   - 前端单测：宿主适配器（invoke mock）、隔离守卫失败路径、能力上限（capabilityCeiling）传入；
   - **产品 W（A7）**：隔离构建安装真实签名包 → 启用 guest → 断言会话 active/capabilities 子集/
     真实 entry（含 css/js）→ 崩溃（移除 iframe）→ 自动 suspended → 超限 failed + safeMode →
     停用/恢复持久化；安全场景：guest 尝试越权方法 → E_CAPABILITY/E_FORBIDDEN。

## 被拒方案

- 直接在**主窗口**执行包 JS / 允许包访问编辑器 DOM：违反 Core/包隔离红线。
- 只靠「不注入 API」而不验证 iframe 是否继承 Tauri globals：ADR-001 已证伪。
- 首版即上自定义协议服务多资源：先 read_asset 内联（可控/可测），多资源完整性后续演进。

## 实施顺序（A7 收尾）

1. ✅ 产品 `workshop_pack_read_asset`；
2. ✅ 产品命令 `workshop_pack_session_status`/`session_report`（落盘 `workshop-session-status.json`，cargo 41）；
3. ✅ 前端 `core/packs/productHostAdapter.ts`：PackageHostBackend/命令映射/entry 注入/隔离守卫/能力上限（7 例 U）；
4. ✅ `core/packs/guestHost.ts` 会话控制层（启动/能力上限/心跳/状态落盘，4 例 U）；
   工坊面板「启用/停用 guest」+ safeMode 禁用（✅ UI 最小闭环，2 例 U；A7 W 待做）；
5. ✅ 产品 W A7 探针 + A5 能力上限验证（W 11/11，`P5-T26-A7-A5-guest.md`）；
6. 文档/证据/台账更新，之后重新评估 T26 认证。

## 安全核对结果（2026-10-19，`P5-T26-A7-isolation.md`）

- ✅ guest 运行于独立 origin `http://workshop.localhost`；
- ⚠️ guest 仍可见 `__TAURI_INTERNALS__`（跨域 iframe 继承 Tauri 注入），但 `invoke` 实测无响应
  （remote IPC 未生效）；**不得宣称绝对隔离**，按「受限优先 + 残余风险」表述；
- 必做硬化：guest SDK 自检 internals 存在则拒绝运行/上报；Tauri remote-domain IPC 配置审计与
  升级回归（复跑 isolation 探针）；评估独立 WebviewWindow/独立 profile 形态。

## 追加硬化（2026-10-19，负结果记录）

- 包文档响应注入守卫脚本尝试移除 `__TAURI_INTERNALS__`：**无效**（Tauri 注入属性不可配置）；
  改为**自检上报**（guest → 宿主 postMessage），宿主展示残余风险并记录诊断；隔离依赖独立 origin +
  Tauri IPC authority 对 remote origin 的拒绝（capabilities 无 remote 声明）+ 升级回归。
  详见 `P5-T26-A7-isolation.md` 追加节。

## 附录 B（2026-10-19）：协议/能力矩阵演进（G1–G4/G7 落地后）

本附录记录 F01–F16 审计（`reports/F01-F16-COVERAGE.md`）后对产品 host 的变更，均为**向后兼容**：

| 变更 | 内容 | 证据 |
| --- | --- | --- |
| G1 内容读 | `context.snapshot` result 可选 `content?/contentBytes?`（仅 `context.read`；真实 `GET /api/articles/{rel}` 原文，BOM/frontmatter/CRLF 逐字节；读不到退化旧形状） | `P5-T26-G1G2-content-io.md`（W 14/14） |
| G2 写通道 | `context.write` 加入 `ALLOWED_CAPABILITIES` + trusted/builtin（community 不授予）+ installPolicy high 风险 + Rust `ALLOWED_CAPS`；产品桥接真实 `/api/context/write`（completed/conflict/stale/failed 如实，requestId 幂等；**删除假 completed 桩**） | 同上 |
| G1/G2 capability 变更 | 产品 guest 运行期能力 = 信任等级 ∩ manifest 声明；`context.write` 为 trusted/builtin 专属 | 同上 |
| G3 打印 | `print.snapshot` 接真实打印管线（真实 PDF；pages=null 不伪造；非法/不存在文档如实错误）；打印期间主线程阻塞 → guest 心跳超时临时放宽 8s（已知限制） | `P5-T26-G3G4-print-events.md`（U+W 18/18） |
| G4 事件 | `document-saved`（revision 与后端一致）/`context-changed`/`theme-changed` 真实发射并到达 guest（HostDispatcher.emit；window 事件桥） | 同上 |
| G7 参考包 | pack A（侧栏读/打印/事件）/pack B（Dock 写/命令）参考 UI + 构建签名工具（测试私钥不入仓） | `P5-T26-G7-reference-packs.md`（W 24/24） |

**残余风险**：隐藏打印 renderer 仍 `KE_WS_PRINT_RENDER=1` env 门控；`currentEpoch()` 固定 1（epoch 失效检测未生效，
靠后端 409 兜底）；guest 仍可见 `__TAURI_INTERNALS__`（remote IPC 被拒，见 ADR-004 正文/A7 证据）；Tauri 升级需
复跑隔离/事件/打印探针。

## 附录 C（2026-10-19）：guest 编辑器命令桥（F03 覆盖解锁）

- `command.invoke` 在既有 article meta 白名单外，新增**受控编辑器命令**能力（`editor.commands.readonly`
  能力 + manifest 逐条声明，trusted/builtin 才授予）：
  - 14 条白名单：bold/italic/underline/strike/code/heading1-3/bulletList/orderedList/blockquote/codeBlock/undo/redo；
  - 协议名统一**小写 kebab**（多词：`editor.bullet-list`/`editor.ordered-list`/`editor.code-block`）以符合
    manifest `commands[].name` schema `^[a-z][a-z0-9.-]{1,80}$`；旧 camelCase 仅后端 legacy 兼容直调、不可声明；
  - 执行器由 EditorArea 注册（仅主窗口、卸载清理），未知/未就绪/失败如实错误，不暴露任意命令；
  - 证据：`P5-T26-pack-editor-cmd.md`（产品 W 26/26：9 格式命令 + 3 列表/代码块 + 撤销重做 + 负向拒绝）；
  - 残余风险：guest 可经声明命令修改当前文档内容（trusted/builtin 包、命令白名单最小化、不含插入/删除/
    选区命令）；命令名大小写/协议名规则需随 SDK 文档同步。
