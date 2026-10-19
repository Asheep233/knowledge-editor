# P5-T26 W04 证据（SDK 发布形态）：独立 `@astranota/ui-workshop-sdk` → 产品 guest 握手/snapshot — W 7/7 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建；workshop 协议 guest）
- 产物：`docs/ui-workshop/sdk/`（源码 `src/index.ts`、构建 `build.mjs`、产物 `dist/guest-sdk.js`(iife,
  全局 `KeWorkshopSDK`) + `dist/guest-sdk.mjs`(ESM)）
- 工具：`tools/run_t26_w04_sdk_probe.py`；原始结果：`evidence/T26-W04-sdk-dist-results.json`
- 证据类型：**U（SDK 自检 4/4）+ W（真实产品 7/7）**

## SDK 自检：4/4 PASS（`node docs/ui-workshop/sdk/self-test.mjs`）

| 用例 | 验证 |
| --- | --- |
| 握手成功 | acceptedFeatures/contextId/epoch 返回正确 |
| request 成功 | `context.snapshot` 返回结果 |
| 错误响应 | `E_CAPABILITY` 映射为 SdkError |
| 超时 | `E_TIMEOUT`（retryable） |

## 产品 W：7/7 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-W04S-1 安装使用发布 SDK 的签名包 | PASS |
| W-T26-W04S-2 产品 host 协议线已连接 | PASS |
| **W-T26-W04S-3 发布 SDK `autoConnect` 握手完成** | PASS（acceptedFeatures=[ui.shell,context.read]） |
| **W-T26-W04S-4 发布 SDK 经 Broker 获得真实 context.snapshot** | PASS（revision/diskHash） |
| W-T26-W04S-5 会话状态 active（能力子集） | PASS |
| W-T26-W04S-6 主进程存活 / W-T26-W04S-7 用户实例未受影响（未运行→N/A） | PASS |

## 协议契约修正（本轮发现）

- SDK 初版握手消息误用 `handshake.request`，宿主 HostDispatcher 只识别 **`type:'handshake'`** →
  修正为宿主契约（`{type:'handshake', protocolVersion, sdkVersion, requestedFeatures}`），
  自检与产品 W 均复验通过；该契约同时写入 SDK 源码注释（wire 包装 `t19-wire`、启动 `t19-guest-alive`
  → 宿主 `t19-port`）。

## 外部开发者用法

```js
// 包入口内联 dist/guest-sdk.js 后：
const conn = await KeWorkshopSDK.autoConnect({ requestedFeatures: ['ui.shell', 'context.read'] })
const snap = await conn.request('context.snapshot', { relPath: 'Articles/a.md' })
setInterval(() => conn.heartbeat(), 200)
```

## 未完成（W04 剩余）

- SDK npm/tgz 正式发布流程与版本策略（当前仓库内 `private:true` 产物 + dist）；
- 文档站/示例集/调试工具；发布密钥分发规范（ADR-003 清单）。
