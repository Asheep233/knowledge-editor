# P1-T11 证据：host ↔ guest 类型化协议契约（版本/能力/错误/取消/超时）

- 日期：2026-10-19 · 代码（**产品仓库内 Core 协议包，无 DOM/React**）：
  - `frontend/src/core/protocol/types.ts`：协议版本 `PROTOCOL_VERSION=1`、错误码（10 种，结构化
    `ProtocolError{code,message,retryable,details}`）、握手/请求/响应/取消/事件消息类型、
    `ProtocolMethods` 方法表（capabilities/snapshot/write/print.snapshot）、`ProtocolPort` 传输抽象、
    `PROTOCOL_CONTRACT` 契约快照（破坏性变更守卫）
  - `frontend/src/core/protocol/channel.ts`：`GuestClient`（握手/类型化 request/取消/超时/事件）、
    `HostDispatcher`（版本+能力协商/方法分发/错误码化/取消转发/事件广播）、`createInMemoryPorts`（端口模拟）
  - `frontend/src/core/protocol/protocol.contract.test.ts`：12 例契约测试
- 证据类型：**U（契约单测 + 源码守卫）**；Tauri 传输 Windows 探针尚未做（见限制）

## 测试结果

```text
$ npx vitest run src/core/protocol
Tests  12 passed (12)
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证语义 |
| --- | --- |
| 契约快照 | 版本/方法/错误码/事件/消息类型完全一致 → 破坏性变更必失败（显式评审才可更新） |
| 握手（同版本） | 能力取交集；返回 contextId/epoch（绑定 T09/T10 语义） |
| 握手（版本不兼容） | `E_VERSION`（retryable=false），不可静默降级 |
| 请求/响应 | 类型化方法往返（context.write → completed/fileDurable/revision） |
| 未知方法 | `E_UNKNOWN_METHOD`（结构化 code，不靠字符串） |
| host 业务错误 | `fail(code)` 原样返回：`E_STALE_CONTEXT` + retryable + details |
| host 异常 | `E_INTERNAL`（带 code，不泄漏裸字符串） |
| 取消 | AbortSignal → guest 收 `E_CANCELED`，host handler 收到 abort |
| 超时 | `E_TIMEOUT`（retryable）且向 host 发送 cancel，handler 被 abort |
| 事件 | `host.emit` → guest `onEvent` 收到类型化事件（theme/context-changed） |
| 畸形请求 | 缺 method → `E_BAD_PAYLOAD` 响应 |
| DOM/React 守卫 | 协议层源码（去注释后）无 `document.`/`window.`/react 依赖 |

## 结论

- T11 的「唯一类型化协议」在 Core 层落地：官方 shell 与 guest 可用同一 `GuestClient/HostDispatcher`
  与同一份类型；错误/取消/超时/版本/能力均有类型化语义；破坏性变更由 `PROTOCOL_CONTRACT` 快照拦截。
- 尚未完成（T11 继续）：
  1. **Tauri 传输最小探针（Windows）**：MessagePort/窗口 postMessage 的宿主适配器 + 真实 WebView2 握手；
  2. 端口模拟之外的传输（srcdoc iframe MessagePort）接入与包加载器（T17）；
  3. 方法表未覆盖 P3 打包/回滚命令（已预留 print.snapshot 等扩展位，新增需升版本）。
