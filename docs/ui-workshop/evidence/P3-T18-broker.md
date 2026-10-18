# P3-T18 证据：宿主 Broker —— 能力/上下文/命令白名单/有界代理（Core，无 UI）

- 日期：2026-10-19 · 代码（产品仓库内 Core broker，无 DOM/React 依赖）：
  - `frontend/src/core/broker/broker.ts`：`Broker` + `BrokerConnection`（connectionId/packId/packVersion/
    role/capabilities/contextId/epoch/declaredCommands）+ `BrokerBackend` 注入接口；
    - 方法→能力映射（`context.snapshot→context.read`、`context.write→context.write`、
      `print.snapshot→print.request`、`command.invoke→ui.shell`）；
    - **epoch 校验**：连接 epoch 与宿主当前 epoch 不一致/上下文关闭 → `E_STALE_CONTEXT`（不触达后端）；
    - **声明式命令白名单**：`command.invoke` 只允许 manifest.commands 声明名，未声明 → `E_FORBIDDEN`；
    - **有界代理**：单连接 `maxInflight`（`E_BUSY` retryable）、单请求 payload 上限（`E_BAD_PAYLOAD`+limit）；
    - official / trusted / guest 三档：official 全能力（可配置关闭），trusted/guest 按能力集合。
  - `protocol/types.ts` 显式升级：新增 `command.invoke` 方法（契约快照/测试同步）。
  - `frontend/src/core/broker/binding.ts`：`brokeredHandlers(broker, connection)` —— 把 Broker 接到
    协议 HostDispatcher；`protocol.capabilities` 回传受信连接信息（不泄漏未授能力）
  - `frontend/src/core/broker/broker.test.ts`（9 例）+ `binding.test.ts`（9 例）
- 证据类型：**U（Core 单测 + 源码守卫）** + **W（Windows/WebView2 恶意 guest 探针 12/12，
  见 `P3-T18-broker-probe.md`）**

## 测试结果

```text
$ npx vitest run src/core/broker src/core/protocol
Tests  37 passed (37)     # broker 9 + binding 9 + protocol 19（含 command.invoke 契约更新）
$ npx tsc -b --noEmit
exit 0
```

| 用例 | 验证语义 |
| --- | --- |
| 能力矩阵 | guest 缺 `context.write` 被拒；snapshot/print 放行 |
| official 全能力 | official 可写（可配置） |
| epoch 过期 | `E_STALE_CONTEXT`（retryable，details expected/received），不触达后端 |
| 上下文关闭 | `currentEpoch=null` → `E_STALE_CONTEXT` |
| 命令白名单 | 已声明放行；未声明 `E_FORBIDDEN`；缺 name `E_BAD_PAYLOAD` |
| payload 上限 | 超限 `E_BAD_PAYLOAD` + `limit` |
| 在途上限 | `maxInflight=1` 第二个 `E_BUSY`，释放后可继续 |
| 握手期方法 | `protocol.capabilities` 无需能力 |
| 后端异常 | 类型化错误原样冒泡（不吞） |
| DOM/React 守卫 | broker 源码无 `document.`/`window.`/react |

## 结论

- T18 的 Core 授权层成立：guest 无任意命令面（方法级能力 + 声明式命令白名单 + epoch 绑定 + 有界代理），
  错误全部类型化；与 T11 协议、T17 manifest 的能力声明一致。
- **Windows/WebView2 恶意 guest 实机探针 12/12 PASS**（`P3-T18-broker-probe.md`）：越权写入
  E_CAPABILITY、未声明命令 E_FORBIDDEN、超限 payload E_BAD_PAYLOAD、未知方法 E_UNKNOWN_METHOD、
  opaque iframe 直接调 Tauri 被拒（Origin 校验）、攻击后 host 仍健康。
- 尚未完成（T18 继续）：
  1. 把 Broker 接到 `HostDispatcher`（连接建立时注入 connection；`protocol.capabilities` 返回已授能力），
     并在 Windows/WebView2 上用真实恶意/故障测试包验证（W 证据）；
  2. **无任意 app 命令面**的浏览器侧验证：opaque iframe 侧无法触达 Tauri 命令（S1 已证），需补「guest 频道
     只暴露 broker 方法」的端到端探针 + 尝试越权调用被拒证据；
  3. 三档策略（外部/网络/部分可信）产品化与用户授权 UI（T22）；后端写口来源收紧（T09 CORS 已完成基础）。
