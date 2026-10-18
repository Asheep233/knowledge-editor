# P5-T26 W05 证据：产品 guest 协议线（Broker/Dispatcher ↔ SDK 握手 + snapshot）— W 7/7 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2 155（隔离产品构建，workshop 协议 origin）
- 工具：`tools/run_t26_protocol_probe.py`（真实产品 + 真实 SDK GuestClient 打包进签名包）
- 原始结果：`evidence/T26-W05-protocol-results.json` · 证据类型：**W（真实产品 host/guest 协议）**

## 实测结果：7/7 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-W05-1 安装签名包 | PASS |
| W-T26-W05-2 产品 host 协议线已连接（Dispatcher/Broker 启动） | PASS |
| **W-T26-W05-3 guest SDK 握手经真实协议线完成** | PASS（`handshakeAccepted=['context.read']`） |
| **W-T26-W05-4 guest 经 Broker 获得真实 context.snapshot** | PASS（revision=0 + 真实 diskHash） |
| W-T26-W05-5 会话状态 active（能力子集） | PASS |
| W-T26-W05-6 主进程存活 / W-T26-W05-7 用户实例未受影响 | PASS |

## 实现（产品 guest 协议线）

- `WorkshopGuestFrame` 启动后创建真实 `Broker` + `HostDispatcher` + `brokeredHandlers`，接
  `Connection.capabilities` 能力过滤；wire 使用 `t19-wire` JSON 线（T11 结论：MessagePort 不能传
  opaque sandbox iframe）；
- `ProductBrokerBackend`：`context.snapshot` 经真实后端 HTTP（`/api/context/snapshot`，CoreSaveBridge
  解析 context/epoch）；write/print/command 为最小实现（后续任务扩展）；
- 兼容 T19/SDK guest 启动握手（`t19-guest-alive` → 宿主回 `t19-port`）与心跳（`t19-heartbeat`）；
- 诊断：`window.__keGuestStart/__keGuestStatusLog/__keGuestResults/__keDispatcherReady`。

## 剩余（W05 未完成项）

- snapshot/subscribe 间隙、重复/乱序消息、断连重连、慢包队列、超时 `queryResult`、取消/冲突/失败
  区分等完整协议语义与压力测试（原型 T18/T11 有部分覆盖，产品级未系统验证）；
- write/print/command 产品实现与权限矩阵验证；
- guest 原生入口全任务覆盖（F01–F16）未做。
